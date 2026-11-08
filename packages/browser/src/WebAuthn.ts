/**
 * Native virtual authenticators and the credentials they hold on one Chromium page.
 *
 * Acquire a handle with `page.capability(Capability.VirtualAuthenticator)`. Credentials survive navigation;
 * another page or popup needs its own authenticator and an explicit credential copy. Copies keep separate
 * signature counters. Firefox's BiDi transport and stock WebKit return `Unsupported` at acquisition.
 *
 * @stability unstable
 * @since 0.1.0
 */
import type * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import type * as Deadline from "./Deadline.ts"
import * as Diagnostics from "./Diagnostics.ts"
import * as ReasonCause from "./internal/reasonCause.ts"
import * as Reason from "./Reason.ts"
import type * as Target from "./Target.ts"

const credentialId = Schema.Uint8Array.check(Schema.makeFilter((bytes) => bytes.length > 0 && bytes.length <= 1023, {
  expected: "1 to 1023 credential ID bytes"
}))
const userHandle = Schema.Uint8Array.check(Schema.makeFilter((bytes) => bytes.length > 0 && bytes.length <= 64, {
  expected: "1 to 64 user handle bytes"
}))

/**
 * A credential exported from or imported into a native virtual authenticator.
 *
 * **Details**
 *
 * Binary fields are bytes, not base64 strings. `privateKey` contains a redacted PKCS#8 DER private key.
 * A resident credential requires a user handle of 1 to 64 bytes. Credential IDs contain 1 to 1023 bytes;
 * `signCount` is an unsigned 32-bit integer. Adding a credential validates its shape before sending it; Chromium validates the key and its algorithm.
 * Listing returns fresh byte arrays, so changing a returned value does not change the authenticator.
 *
 * **Gotchas**
 *
 * Exported private keys grant the ability to sign as the user. Keep them secret. Copying a credential does
 * not synchronize its signature counter with its source.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const Credential = Schema.Struct({
  credentialId,
  isResidentCredential: Schema.Boolean,
  rpId: Schema.String.check(Schema.makeFilter((value) => {
    const url = URL.parse(`https://${value}`)
    return value.length > 0 && url !== null && url.hostname === value.toLowerCase() && url.host === url.hostname &&
      url.pathname === "/" && url.search === "" && url.hash === "" && url.username === "" && url.password === ""
  }, { expected: "a relying-party host name without a scheme, port or path" })),
  privateKey: Schema.Redacted(Schema.Uint8Array),
  userHandle: Schema.optional(userHandle),
  signCount: Schema.Number.check(Schema.isInt(), Schema.isBetween({ minimum: 0, maximum: 0xffff_ffff })),
  backupEligibility: Schema.optional(Schema.Boolean),
  backupState: Schema.optional(Schema.Boolean),
  userName: Schema.optional(Schema.String),
  userDisplayName: Schema.optional(Schema.String)
}).check(Schema.makeFilter((credential) => !credential.isResidentCredential || credential.userHandle !== undefined, {
  expected: "a user handle for a resident credential"
}))

/**
 * A credential held by a native virtual authenticator.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type Credential = typeof Credential.Type

/**
 * A native authenticator owned by the acquiring scope, on one page.
 *
 * **Details**
 *
 * Only one may be acquired on a page at a time; overlapping acquisition fails with `CapabilityError`.
 * Scope release removes it and restores native authenticator discovery. Retained handles then fail with
 * `TargetGone` with reason `AccessReleased`. Releasing after the page closes is harmless.
 * If cleanup cannot confirm that the virtual environment was disabled, new acquisition remains refused
 * until the page closes. The capability owns the page's virtual WebAuthn environment; do not manage it
 * through another CDP client while the scope lives.
 *
 * **Example** (Copying a passkey to another page)
 *
 * ```ts import.meta.vitest
 * import { Capability, Expect, Page } from "@usestrider/browser"
 * import { Effect } from "effect"
 *
 * const copyPasskey = Effect.fn("copyPasskey")(
 *   function*(source: Page.Page, destination: Page.Page) {
 *     const original = yield* source.capability(Capability.VirtualAuthenticator)
 *     yield* source.getByRole("button", { name: "Create passkey" }).click()
 *     yield* source.getByText("Passkey created").pipe(Expect.toBeVisible)
 *     const copy = yield* destination.capability(Capability.VirtualAuthenticator)
 *     for (const credential of yield* original.credentials) {
 *       yield* copy.addCredential(credential)
 *     }
 *     return copy
 *   }
 * )
 * ```
 *
 * **Example** (Copying a passkey to a popup)
 *
 * ```ts import.meta.vitest
 * import { Capability, Page, Popup, WebAuthn } from "@usestrider/browser"
 * import { Effect } from "effect"
 *
 * const copyToPopup = Effect.fn("copyToPopup")(
 *   function*(page: Page.Page, original: WebAuthn.VirtualAuthenticator) {
 *     const opened = yield* Popup.next(page)
 *     yield* page.getByRole("button", { name: "Open sign-in" }).click()
 *     const popup = yield* opened
 *     const copy = yield* popup.capability(Capability.VirtualAuthenticator)
 *     for (const credential of yield* original.credentials) {
 *       yield* copy.addCredential(credential)
 *     }
 *     return popup
 *   }
 * )
 * ```
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface VirtualAuthenticator {
  /**
   * Lists the stored credentials, including their redacted private keys and current signature counters.
   */
  readonly credentials: Effect.Effect<ReadonlyArray<Credential>, WebAuthnError | Target.TargetGone | Deadline.Timeout>
  /**
   * Imports a credential, including its initial signature counter; an existing ID fails with `WebAuthnError`.
   * Invalid credential data or a malformed or unsupported private key fails with `InvalidInput`, without echoing it.
   */
  readonly addCredential: (
    credential: Credential
  ) => Effect.Effect<void, WebAuthnError | Target.TargetGone | Deadline.Timeout>
  /**
   * Removes the credential with these ID bytes; an unknown ID fails with `WebAuthnError`.
   */
  readonly removeCredential: (
    credentialId: Uint8Array
  ) => Effect.Effect<void, WebAuthnError | Target.TargetGone | Deadline.Timeout>
  /**
   * Removes every credential from this authenticator.
   */
  readonly clearCredentials: Effect.Effect<void, WebAuthnError | Target.TargetGone | Deadline.Timeout>
  /**
   * Sets whether user verification succeeds for subsequent ceremonies.
   *
   * @default true
   */
  readonly setUserVerified: (
    verified: boolean
  ) => Effect.Effect<void, WebAuthnError | Target.TargetGone | Deadline.Timeout>
  /**
   * Sets whether the authenticator supplies user presence automatically.
   * Turning it off leaves ceremonies waiting for presence until their own timeout or cancellation.
   *
   * @default true
   */
  readonly setAutomaticPresenceSimulation: (
    enabled: boolean
  ) => Effect.Effect<void, WebAuthnError | Target.TargetGone | Deadline.Timeout>
}

/**
 * Schema for failures using a virtual authenticator.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const WebAuthnErrorReason = Schema.Union([Reason.InvalidInput, Reason.BackendFailure, Reason.Unsupported])

/**
 * The reasons using a virtual authenticator can fail.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type WebAuthnErrorReason = typeof WebAuthnErrorReason.Type

/**
 * Error for a credential or authenticator operation that could not complete.
 *
 * @stability unstable
 * @category errors
 * @since 0.1.0
 */
export class WebAuthnError
  extends Schema.TaggedError<WebAuthnError>("@usestrider/browser/WebAuthn/WebAuthnError")("WebAuthnError", {
    reason: WebAuthnErrorReason,
    diagnostics: Diagnostics.Diagnostics
  })
{
  override get message(): string {
    return this.reason.message
  }
  override get cause(): unknown {
    return ReasonCause.of(this.reason)
  }
}
