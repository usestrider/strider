/**
 * Automation domain exposes commands for automating user interactions with the browser.
 *
 * Generated from WebKit's Automation protocol, WebKitGTK 2.54.1. Don't edit: correct the model (`packages/tools/codegen/protocols/webkit-automation`) and run `pnpm codegen:protocol`.
 *
 * @stability unstable
 * @since 0.1.0
 */
import type * as Brand from "effect/Brand"
import type * as Redacted from "effect/Redacted"
import * as Schema from "effect/Schema"
import * as Protocol from "../protocol/Protocol.ts"

/**
 * This enum contains the different protocol types supported by virtual authenticators.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type AuthenticatorProtocol =
  | "ctap1_u2f"
  | "ctap2"
  | "ctap2_1"
  | (string & {})

/**
 * Schema for `AuthenticatorProtocol`: known values, and any other string.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const AuthenticatorProtocol = Schema.String as any as Schema.Codec<AuthenticatorProtocol>

/**
 * Authenticators may implement various transports for communicating with clients. This enumeration defines hints as to how clients might communicate with a particular authenticator in order to obtain an assertion for a specific credential.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type AuthenticatorTransport =
  | "usb"
  | "nfc"
  | "ble"
  | "internal"
  | (string & {})

/**
 * Schema for `AuthenticatorTransport`: known values, and any other string.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const AuthenticatorTransport = Schema.String as any as Schema.Codec<AuthenticatorTransport>

/**
 * A handle representing an open window or tab in the automation session.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface BrowsingContext {
  /**
   * Opaque handle for a browsing context (window or tab). Used as a key for window-related commands.
   */
  readonly handle: BrowsingContextHandle
  /**
   * Whether the browsing context has focus at the time the command is handled.
   */
  readonly active: boolean
  /**
   * The URL loaded by the browsing context at the time the command is handled.
   */
  readonly url: string
  /**
   * The current size of the browsing context's window.
   */
  readonly windowSize: Size
  /**
   * The current (x, y) position of the browsing context's window relative to the top-left of the screen.
   */
  readonly windowOrigin: Point
}

/**
 * Schema for `BrowsingContext`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const BrowsingContext = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    handle: BrowsingContextHandle,
    active: Schema.Boolean,
    url: Schema.String,
    windowSize: Size,
    windowOrigin: Point
  }).annotate({ identifier: "Automation.BrowsingContext" })
) as any as Schema.Codec<BrowsingContext>

/**
 * An opaque identifier for a browsing context.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type BrowsingContextHandle = Brand.Branded<
  string,
  "~@usestrider/browser/webkit-automation-protocol/Automation/BrowsingContextHandle"
>

/**
 * Schema for `BrowsingContextHandle`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const BrowsingContextHandle = /*#__PURE__*/ Schema.String.pipe(
  /*#__PURE__*/ Schema.brand("~@usestrider/browser/webkit-automation-protocol/Automation/BrowsingContextHandle")
) as any as Schema.Codec<BrowsingContextHandle>

/**
 * How a browsing context is presented by the user agent. A browsing context is considered a tab if it shares an OS-level window with another browsing context.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type BrowsingContextPresentation =
  | "Window"
  | "Tab"
  | (string & {})

/**
 * Schema for `BrowsingContextPresentation`: known values, and any other string.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const BrowsingContextPresentation = Schema.String as any as Schema.Codec<BrowsingContextPresentation>

/**
 * `Cookie`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface Cookie {
  /**
   * Cookie name.
   */
  readonly name: string
  /**
   * Cookie value.
   */
  readonly value: Redacted.Redacted<string>
  /**
   * Cookie domain. If empty, the domain is inherited from the relevant browsing context.
   */
  readonly domain: string
  /**
   * Cookie path.
   */
  readonly path: string
  /**
   * Cookie expiration in seconds since the UNIX epoch.
   */
  readonly expires: number
  /**
   * Cookie size.
   */
  readonly size: number
  /**
   * True if cookie is http-only.
   */
  readonly httpOnly: boolean
  /**
   * True if cookie is secure.
   */
  readonly secure: boolean
  /**
   * True in case of session cookie.
   */
  readonly session: boolean
  /**
   * Cookie same site policy.
   */
  readonly sameSite: CookieSameSitePolicy
}

/**
 * Schema for `Cookie`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const Cookie = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    name: Schema.String,
    value: Schema.RedactedFromValue(Schema.String),
    domain: Schema.String,
    path: Schema.String,
    expires: Schema.Number,
    size: Schema.Int,
    httpOnly: Schema.Boolean,
    secure: Schema.Boolean,
    session: Schema.Boolean,
    sameSite: CookieSameSitePolicy
  }).annotate({ identifier: "Automation.Cookie" })
) as any as Schema.Codec<Cookie, unknown>

/**
 * Enumerates values for cookies same site policy
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type CookieSameSitePolicy =
  | "None"
  | "Lax"
  | "Strict"
  | (string & {})

/**
 * Schema for `CookieSameSitePolicy`: known values, and any other string.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const CookieSameSitePolicy = Schema.String as any as Schema.Codec<CookieSameSitePolicy>

/**
 * The coordinate system in which rects, points, and sizes are to be interpreted. LayoutViewport is a legacy value and should not be used going forward.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type CoordinateSystem =
  | "Page"
  | "Viewport"
  | "LayoutViewport"
  | (string & {})

/**
 * Schema for `CoordinateSystem`: known values, and any other string.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const CoordinateSystem = Schema.String as any as Schema.Codec<CoordinateSystem>

/**
 * This enum contains predefined error messages that can be used to signal a well-defined error condition, such as a missing implementation, unknown window handle, and so forth. The backend signals one of these errors by using it as a prefix of the commands's error message (the errorString argument in generated C++ backend dispatchers). This will be reported to the frontend as a protocol error with a JSON-RPC error code of 'ServerError'. It is up to the frontend whether and how to deal with errors.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type ErrorMessage =
  | "InternalError"
  | "Timeout"
  | "JavaScriptError"
  | "JavaScriptTimeout"
  | "WindowNotFound"
  | "FrameNotFound"
  | "NodeNotFound"
  | "InvalidNodeIdentifier"
  | "InvalidElementState"
  | "NoJavaScriptDialog"
  | "NotImplemented"
  | "MissingParameter"
  | "InvalidParameter"
  | "InvalidSelector"
  | "ElementNotInteractable"
  | "ElementNotSelectable"
  | "ScreenshotError"
  | "UnexpectedAlertOpen"
  | "TargetOutOfBounds"
  | "UnableToLoadExtension"
  | "UnableToUnloadExtension"
  | "NoSuchExtension"
  | "NoSuchUserContext"
  | "NoSuchScript"
  | (string & {})

/**
 * Schema for `ErrorMessage`: known values, and any other string.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ErrorMessage = Schema.String as any as Schema.Codec<ErrorMessage>

/**
 * An opaque identifier for a frame in a page.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type FrameHandle = Brand.Branded<
  string,
  "~@usestrider/browser/webkit-automation-protocol/Automation/FrameHandle"
>

/**
 * Schema for `FrameHandle`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const FrameHandle = /*#__PURE__*/ Schema.String.pipe(
  /*#__PURE__*/ Schema.brand("~@usestrider/browser/webkit-automation-protocol/Automation/FrameHandle")
) as any as Schema.Codec<FrameHandle>

/**
 * `InputSource`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface InputSource {
  /**
   * A unique identifier for this input source.
   */
  readonly sourceId: string
  /**
   * The type of this input source. This affects what input source state fields are valid for this input source.
   */
  readonly sourceType: InputSourceType
}

/**
 * Schema for `InputSource`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const InputSource = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    sourceId: Schema.String,
    sourceType: InputSourceType
  }).annotate({ identifier: "Automation.InputSource" })
) as any as Schema.Codec<InputSource>

/**
 * A new state for a specific input source. All state-related fields are optional and must be applicable to the InputSource referenced by 'sourceId'. If no state-related fields are specified, the state is assumed to remain the same as in the previous step (i.e., 'sustained').
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface InputSourceState {
  /**
   * The input source whose state is described by this object.
   */
  readonly sourceId: string
  /**
   * For 'keyboard' input sources, specifies a character key that has 'pressed' state. Unmentioned character keys are assumed to have a 'released' state.
   */
  readonly pressedCharKey?: string | undefined
  /**
   * For 'keyboard' input sources, specifies virtual keys that have a 'pressed' state. Unmentioned virtual keys are assumed to have a 'released' state.
   */
  readonly pressedVirtualKeys?: ReadonlyArray<VirtualKey> | undefined
  /**
   * For 'mouse' input sources, specifies which mouse button has a 'pressed' state. Unmentioned mouse buttons are assumed to have a 'released' state. For 'touch' input sources, passing MouseButton::Left denotes a touch-down state.
   */
  readonly pressedButton?: MouseButton | undefined
  /**
   * For 'mouse' input sources, specifies which type of interaction took place. If unmentioned and the interaction cannot be determined through other heuristics, the state is dropped.
   */
  readonly mouseInteraction?: MouseInteraction | undefined
  /**
   * For 'mouse' or 'wheel' input sources, specifies the origin type of a mouse move transition. Defaults to 'Viewport' if omitted.
   */
  readonly origin?: MouseMoveOrigin | undefined
  /**
   * The handle of the element to use as origin when origin type is 'Element'.
   */
  readonly nodeHandle?: NodeHandle | undefined
  /**
   * For 'mouse', 'wheel' or 'touch' input sources, specifies a location in view coordinates to which the input source should transition. Transitioning to this state may interpolate intemediate input source states to better simulate real user movements and gestures.
   */
  readonly location?: Point | undefined
  /**
   * For 'wheel' input sources, specifies a scroll delta.
   */
  readonly delta?: Size | undefined
  /**
   * The minimum number of milliseconds that must elapse while the relevant input source transitions to this state.
   */
  readonly duration?: number | undefined
}

/**
 * Schema for `InputSourceState`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const InputSourceState = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    sourceId: Schema.String,
    pressedCharKey: Schema.optional(Schema.String),
    pressedVirtualKeys: Schema.optional(Schema.Array(VirtualKey)),
    pressedButton: Schema.optional(MouseButton),
    mouseInteraction: Schema.optional(MouseInteraction),
    origin: Schema.optional(MouseMoveOrigin),
    nodeHandle: Schema.optional(NodeHandle),
    location: Schema.optional(Point),
    delta: Schema.optional(Size),
    duration: Schema.optional(Schema.Int)
  }).annotate({ identifier: "Automation.InputSourceState" })
) as any as Schema.Codec<InputSourceState>

/**
 * The type of an input source. This determines which state properties are applicable to the input source. The 'Null' input source type has no properties, only a duration. This can extend the effective wait for a tick.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type InputSourceType =
  | "Null"
  | "Mouse"
  | "Keyboard"
  | "Touch"
  | "Wheel"
  | "Pen"
  | (string & {})

/**
 * Schema for `InputSourceType`: known values, and any other string.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const InputSourceType = Schema.String as any as Schema.Codec<InputSourceType>

/**
 * A set of input source states to which all applicable input sources must transition before further steps may be processed. If an input source does not have a corresponding state in a step, its state assumed to be 'released' for that step.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface InteractionStep {
  /**
   * A list of new input states for input sources that must transition during this step. Source state transitions that cannot be performed concurrently (i.e., touch gestures) are performed sequentially in the order they are listed.
   */
  readonly states?: ReadonlyArray<InputSourceState> | undefined
}

/**
 * Schema for `InteractionStep`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const InteractionStep = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    states: Schema.optional(Schema.Array(InputSourceState))
  }).annotate({ identifier: "Automation.InteractionStep" })
) as any as Schema.Codec<InteractionStep>

/**
 * Enumerates different key modifiers that can remain pressed during other mouse/touch interactions.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type KeyModifier =
  | "CapsLock"
  | "Control"
  | "Shift"
  | "Meta"
  | "Alt"
  | (string & {})

/**
 * Schema for `KeyModifier`: known values, and any other string.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const KeyModifier = Schema.String as any as Schema.Codec<KeyModifier>

/**
 * A single step in a key sequence. A step can contain a key up/down of a virtual key, or a sequence of Unicode code points that are delivered to the page at grapheme cluster boundaries. Either a 'key' or 'text' property must be specified.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface KeyboardInteraction {
  /**
   * The type of interaction to be performed by a step.
   */
  readonly type: KeyboardInteractionType
  /**
   * A virtual key to be used to perform the specified interaction.
   */
  readonly key?: VirtualKey | undefined
  /**
   * A unicode string to be delivered to the page. The sequence of key events is determined by splitting the string at grapheme cluster boundaries.
   */
  readonly text?: string | undefined
}

/**
 * Schema for `KeyboardInteraction`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const KeyboardInteraction = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    type: KeyboardInteractionType,
    key: Schema.optional(VirtualKey),
    text: Schema.optional(Schema.String)
  }).annotate({ identifier: "Automation.KeyboardInteraction" })
) as any as Schema.Codec<KeyboardInteraction>

/**
 * Enumerates different ways of interacting with a keyboard device. 'InsertByKey' implies that a separate KeyDown and KeyUp event are produced for each combining character sequence, regardless of the actual keystrokes required to produce the character sequence.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type KeyboardInteractionType =
  | "KeyPress"
  | "KeyRelease"
  | "InsertByKey"
  | (string & {})

/**
 * Schema for `KeyboardInteractionType`: known values, and any other string.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const KeyboardInteractionType = Schema.String as any as Schema.Codec<KeyboardInteractionType>

/**
 * Enumerates different mouse buttons that can be used.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type MouseButton =
  | "None"
  | "Left"
  | "Middle"
  | "Right"
  | "Back"
  | "Forward"
  | (string & {})

/**
 * Schema for `MouseButton`: known values, and any other string.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const MouseButton = Schema.String as any as Schema.Codec<MouseButton>

/**
 * Enumerates different ways of interacting with a mouse cursor.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type MouseInteraction =
  | "Move"
  | "Down"
  | "Up"
  | "SingleClick"
  | "DoubleClick"
  | (string & {})

/**
 * Schema for `MouseInteraction`: known values, and any other string.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const MouseInteraction = Schema.String as any as Schema.Codec<MouseInteraction>

/**
 * Enumerates different origin types that can be used in mouse move interactions.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type MouseMoveOrigin =
  | "Viewport"
  | "Pointer"
  | "Element"
  | (string & {})

/**
 * Schema for `MouseMoveOrigin`: known values, and any other string.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const MouseMoveOrigin = Schema.String as any as Schema.Codec<MouseMoveOrigin>

/**
 * An opaque identifier for a node in a page.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type NodeHandle = Brand.Branded<string, "~@usestrider/browser/webkit-automation-protocol/Automation/NodeHandle">

/**
 * Schema for `NodeHandle`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const NodeHandle = /*#__PURE__*/ Schema.String.pipe(
  /*#__PURE__*/ Schema.brand("~@usestrider/browser/webkit-automation-protocol/Automation/NodeHandle")
) as any as Schema.Codec<NodeHandle>

/**
 * Enumerates different page load strategies.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type PageLoadStrategy =
  | "None"
  | "Eager"
  | "Normal"
  | (string & {})

/**
 * Schema for `PageLoadStrategy`: known values, and any other string.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const PageLoadStrategy = Schema.String as any as Schema.Codec<PageLoadStrategy>

/**
 * Values represent the concept of a permission state.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type PermissionState =
  | "granted"
  | "denied"
  | "prompt"
  | (string & {})

/**
 * Schema for `PermissionState`: known values, and any other string.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const PermissionState = Schema.String as any as Schema.Codec<PermissionState>

/**
 * `Point`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface Point {
  readonly x: number
  readonly y: number
}

/**
 * Schema for `Point`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const Point = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    x: Schema.Number,
    y: Schema.Number
  }).annotate({ identifier: "Automation.Point" })
) as any as Schema.Codec<Point>

/**
 * `Rect`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface Rect {
  readonly origin: Point
  readonly size: Size
}

/**
 * Schema for `Rect`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const Rect = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    origin: Point,
    size: Size
  }).annotate({ identifier: "Automation.Rect" })
) as any as Schema.Codec<Rect>

/**
 * Enumerates different permissions that must be obtained in order to use privileged APIs.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type SessionPermission =
  | "GetUserMedia"
  | (string & {})

/**
 * Schema for `SessionPermission`: known values, and any other string.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SessionPermission = Schema.String as any as Schema.Codec<SessionPermission>

/**
 * `SessionPermissionData`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface SessionPermissionData {
  readonly permission: SessionPermission
  readonly value: boolean
}

/**
 * Schema for `SessionPermissionData`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SessionPermissionData = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    permission: SessionPermission,
    value: Schema.Boolean
  }).annotate({ identifier: "Automation.SessionPermissionData" })
) as any as Schema.Codec<SessionPermissionData>

/**
 * `Size`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface Size {
  readonly width: number
  readonly height: number
}

/**
 * Schema for `Size`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const Size = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    width: Schema.Number,
    height: Schema.Number
  }).annotate({ identifier: "Automation.Size" })
) as any as Schema.Codec<Size>

/**
 * Parameters used when creating a virtual authenticator
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface VirtualAuthenticatorConfiguration {
  /**
   * The protocol of the authenticator
   */
  readonly protocol: AuthenticatorProtocol
  /**
   * The transport of the protocol
   */
  readonly transport: AuthenticatorTransport
  /**
   * If the authenticator has a resident key
   */
  readonly hasResidentKey?: boolean | undefined
  /**
   * If the authenticator supports user verification
   */
  readonly hasUserVerification?: boolean | undefined
  /**
   * If the virtual authenticator should consent to requests
   */
  readonly isUserConsenting?: boolean | undefined
  /**
   * If user verification requests should succeeed
   */
  readonly isUserVerified?: boolean | undefined
  /**
   * An array containing extension identifiers
   */
  readonly extensions?: ReadonlyArray<string> | undefined
  /**
   * Up to 3 User Verification Method entries
   */
  readonly uvm?: ReadonlyArray<number> | undefined
}

/**
 * Schema for `VirtualAuthenticatorConfiguration`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const VirtualAuthenticatorConfiguration = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    protocol: AuthenticatorProtocol,
    transport: AuthenticatorTransport,
    hasResidentKey: Schema.optional(Schema.Boolean),
    hasUserVerification: Schema.optional(Schema.Boolean),
    isUserConsenting: Schema.optional(Schema.Boolean),
    isUserVerified: Schema.optional(Schema.Boolean),
    extensions: Schema.optional(Schema.Array(Schema.String)),
    uvm: Schema.optional(Schema.Array(Schema.Int))
  }).annotate({ identifier: "Automation.VirtualAuthenticatorConfiguration" })
) as any as Schema.Codec<VirtualAuthenticatorConfiguration>

/**
 * A credential object used for virtual authenticators.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface VirtualAuthenticatorCredential {
  /**
   * The Credential ID encoded using Base64url Encoding.
   */
  readonly credentialId: string
  /**
   * If set to true, a client-side discoverable credential is created. If set to false, a server-side credential is created instead.
   */
  readonly isResidentCredential: boolean
  /**
   * The Relying Party ID the credential is scoped to.
   */
  readonly rpId: string
  /**
   * An asymmetric key package containing a single private key per [RFC5958], encoded using Base64url Encoding.
   */
  readonly privateKey: string
  /**
   * The userHandle associated to the credential encoded using Base64url Encoding. This property may not be defined.
   */
  readonly userHandle?: string | undefined
  /**
   * The initial value for a signature counter associated to the public key credential source.
   */
  readonly signCount: number
  /**
   * The large, per-credential blob associated to the public key credential source, encoded using Base64url Encoding. This property may not be defined.
   */
  readonly largeBlob?: string | undefined
}

/**
 * Schema for `VirtualAuthenticatorCredential`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const VirtualAuthenticatorCredential = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    credentialId: Schema.String,
    isResidentCredential: Schema.Boolean,
    rpId: Schema.String,
    privateKey: Schema.String,
    userHandle: Schema.optional(Schema.String),
    signCount: Schema.Int,
    largeBlob: Schema.optional(Schema.String)
  }).annotate({ identifier: "Automation.VirtualAuthenticatorCredential" })
) as any as Schema.Codec<VirtualAuthenticatorCredential>

/**
 * Enumerates different platform-independent virtual keys on a physical keyboard whose input via keyboard may or may not produce characters.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type VirtualKey =
  | "Shift"
  | "ShiftRight"
  | "Control"
  | "ControlRight"
  | "Alternate"
  | "AlternateRight"
  | "Meta"
  | "MetaRight"
  | "Command"
  | "CommandRight"
  | "Cancel"
  | "Help"
  | "Backspace"
  | "Tab"
  | "Clear"
  | "Enter"
  | "Pause"
  | "Escape"
  | "PageUp"
  | "PageUpRight"
  | "PageDown"
  | "PageDownRight"
  | "End"
  | "EndRight"
  | "Home"
  | "HomeRight"
  | "LeftArrow"
  | "LeftArrowRight"
  | "UpArrow"
  | "UpArrowRight"
  | "RightArrow"
  | "RightArrowRight"
  | "DownArrow"
  | "DownArrowRight"
  | "Insert"
  | "InsertRight"
  | "Delete"
  | "DeleteRight"
  | "Space"
  | "Semicolon"
  | "Equals"
  | "Return"
  | "NumberPad0"
  | "NumberPad1"
  | "NumberPad2"
  | "NumberPad3"
  | "NumberPad4"
  | "NumberPad5"
  | "NumberPad6"
  | "NumberPad7"
  | "NumberPad8"
  | "NumberPad9"
  | "NumberPadMultiply"
  | "NumberPadAdd"
  | "NumberPadSeparator"
  | "NumberPadSubtract"
  | "NumberPadDecimal"
  | "NumberPadDivide"
  | "Function1"
  | "Function2"
  | "Function3"
  | "Function4"
  | "Function5"
  | "Function6"
  | "Function7"
  | "Function8"
  | "Function9"
  | "Function10"
  | "Function11"
  | "Function12"
  | (string & {})

/**
 * Schema for `VirtualKey`: known values, and any other string.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const VirtualKey = Schema.String as any as Schema.Codec<VirtualKey>

/**
 * The format of the resource used to load the web extension.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type WebExtensionResourceOptions =
  | "Path"
  | "ArchivePath"
  | "Base64"
  | (string & {})

/**
 * Schema for `WebExtensionResourceOptions`: known values, and any other string.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const WebExtensionResourceOptions = Schema.String as any as Schema.Codec<WebExtensionResourceOptions>

/**
 * Accepts a JavaScript alert, confirm, or prompt dialog currently showing in a browsing context. Equivalent to clicking the 'OK' button.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface AcceptCurrentJavaScriptDialogParams {
  /**
   * The handle for the browsing context.
   */
  readonly browsingContextHandle: BrowsingContextHandle
}

/**
 * Schema for `AcceptCurrentJavaScriptDialogParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const AcceptCurrentJavaScriptDialogParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    browsingContextHandle: BrowsingContextHandle
  }).annotate({ identifier: "Automation.AcceptCurrentJavaScriptDialogParams" })
) as any as Schema.Codec<AcceptCurrentJavaScriptDialogParams>

/**
 * Add a cookie to cookie storage for the specified browsing context.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface AddSingleCookieParams {
  /**
   * The handle for the browsing context.
   */
  readonly browsingContextHandle: BrowsingContextHandle
  /**
   * The cookie that should be added to storage.
   */
  readonly cookie: Cookie
}

/**
 * Schema for `AddSingleCookieParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const AddSingleCookieParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    browsingContextHandle: BrowsingContextHandle,
    cookie: Cookie
  }).annotate({ identifier: "Automation.AddSingleCookieParams" })
) as any as Schema.Codec<AddSingleCookieParams, unknown>

/**
 * Adds a virtual web authentication authenticator for the specified browsing context.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface AddVirtualAuthenticatorParams {
  /**
   * The handle for the browsing context.
   */
  readonly browsingContextHandle: BrowsingContextHandle
  /**
   * The configuration for the virtual authenticator to be created.
   */
  readonly authenticator: VirtualAuthenticatorConfiguration
}

/**
 * Schema for `AddVirtualAuthenticatorParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const AddVirtualAuthenticatorParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    browsingContextHandle: BrowsingContextHandle,
    authenticator: VirtualAuthenticatorConfiguration
  }).annotate({ identifier: "Automation.AddVirtualAuthenticatorParams" })
) as any as Schema.Codec<AddVirtualAuthenticatorParams>

/**
 * Adds a virtual web authentication authenticator for the specified browsing context.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface AddVirtualAuthenticatorResult {
  /**
   * The authenticatorId of the created authenticator
   */
  readonly authenticatorId: string
}

/**
 * Schema for `AddVirtualAuthenticatorResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const AddVirtualAuthenticatorResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    authenticatorId: Schema.String
  }).annotate({ identifier: "Automation.AddVirtualAuthenticatorResult" })
) as any as Schema.Codec<AddVirtualAuthenticatorResult>

/**
 * Add a credential to a specified virutal authenticator for the specified browsing context
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface AddVirtualAuthenticatorCredentialParams {
  /**
   * The handle for the browsing context.
   */
  readonly browsingContextHandle: BrowsingContextHandle
  /**
   * The virtual authenticator id to add the credential to.
   */
  readonly authenticatorId: string
  /**
   * The parameters of the credential to add.
   */
  readonly credential: VirtualAuthenticatorCredential
}

/**
 * Schema for `AddVirtualAuthenticatorCredentialParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const AddVirtualAuthenticatorCredentialParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    browsingContextHandle: BrowsingContextHandle,
    authenticatorId: Schema.String,
    credential: VirtualAuthenticatorCredential
  }).annotate({ identifier: "Automation.AddVirtualAuthenticatorCredentialParams" })
) as any as Schema.Codec<AddVirtualAuthenticatorCredentialParams>

/**
 * Relay a WebDriver Bidi message from the automation session to be processed by the client. Only in builds compiled with `ENABLE(WEBDRIVER_BIDI)`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface BidiMessageSentParams {
  /**
   * A Bidi message sent by WebKit to the client, encoded as a UTF-8 JSON literal.
   */
  readonly message: string
}

/**
 * Schema for `BidiMessageSentParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const BidiMessageSentParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    message: Schema.String
  }).annotate({ identifier: "Automation.BidiMessageSentParams" })
) as any as Schema.Codec<BidiMessageSentParams>

/**
 * Fired when the specified browsing context has navigated or closed. Existing element references from the browsing context are no longer valid.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface BrowsingContextClearedParams {
  readonly browsingContextHandle: BrowsingContextHandle
}

/**
 * Schema for `BrowsingContextClearedParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const BrowsingContextClearedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    browsingContextHandle: BrowsingContextHandle
  }).annotate({ identifier: "Automation.BrowsingContextClearedParams" })
) as any as Schema.Codec<BrowsingContextClearedParams>

/**
 * Cancel an active interaction sequence that is currently in progress.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface CancelInteractionSequenceParams {
  /**
   * The browsing context to be interacted with.
   */
  readonly handle: BrowsingContextHandle
  /**
   * The handle for the frame passed to performInteractionSequence. The main frame is used if this parameter empty string or excluded.
   */
  readonly frameHandle?: FrameHandle | undefined
}

/**
 * Schema for `CancelInteractionSequenceParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const CancelInteractionSequenceParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    handle: BrowsingContextHandle,
    frameHandle: Schema.optional(FrameHandle)
  }).annotate({ identifier: "Automation.CancelInteractionSequenceParams" })
) as any as Schema.Codec<CancelInteractionSequenceParams>

/**
 * Try to close the specified browsing context. This can trigger an unload prompt and thereafter succeed or fail.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface CloseBrowsingContextParams {
  /**
   * The handle for the browsing context that should be closed.
   */
  readonly handle: BrowsingContextHandle
}

/**
 * Schema for `CloseBrowsingContextParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const CloseBrowsingContextParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    handle: BrowsingContextHandle
  }).annotate({ identifier: "Automation.CloseBrowsingContextParams" })
) as any as Schema.Codec<CloseBrowsingContextParams>

/**
 * Computes the layout for an element.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface ComputeElementLayoutParams {
  /**
   * The handle for the browsing context the frame is located.
   */
  readonly browsingContextHandle: BrowsingContextHandle
  /**
   * The handle for the frame that contains the element.
   */
  readonly frameHandle: FrameHandle
  /**
   * The handle of the element to use.
   */
  readonly nodeHandle: NodeHandle
  /**
   * If the element should be scrolled into view before computing its layout.
   */
  readonly scrollIntoViewIfNeeded?: boolean | undefined
  /**
   * The coordinate system to use for rect and point results.
   */
  readonly coordinateSystem: CoordinateSystem
}

/**
 * Schema for `ComputeElementLayoutParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ComputeElementLayoutParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    browsingContextHandle: BrowsingContextHandle,
    frameHandle: FrameHandle,
    nodeHandle: NodeHandle,
    scrollIntoViewIfNeeded: Schema.optional(Schema.Boolean),
    coordinateSystem: CoordinateSystem
  }).annotate({ identifier: "Automation.ComputeElementLayoutParams" })
) as any as Schema.Codec<ComputeElementLayoutParams>

/**
 * Computes the layout for an element.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface ComputeElementLayoutResult {
  /**
   * The layout rect for the requested element. Values are converted to the requested coordinate system.
   */
  readonly rect: Rect
  /**
   * The in-view center point for the requested element. Values are converted to the requested coordinate system.
   */
  readonly inViewCenterPoint?: Point | undefined
  /**
   * If the in-view center point of the requested element is obscured by another element.
   */
  readonly isObscured: boolean
}

/**
 * Schema for `ComputeElementLayoutResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ComputeElementLayoutResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    rect: Rect,
    inViewCenterPoint: Schema.optional(Point),
    isObscured: Schema.Boolean
  }).annotate({ identifier: "Automation.ComputeElementLayoutResult" })
) as any as Schema.Codec<ComputeElementLayoutResult>

/**
 * Opens a new browsing context in the automation session and makes it the active browsing context for user interaction. This command creates a browsing context in a new window rather than adding a tab to an existing window.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface CreateBrowsingContextParams {
  /**
   * A hint for the desired presentation of new browsing context (new tab or new window).
   */
  readonly presentationHint?: BrowsingContextPresentation | undefined
}

/**
 * Schema for `CreateBrowsingContextParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const CreateBrowsingContextParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    presentationHint: Schema.optional(BrowsingContextPresentation)
  }).annotate({ identifier: "Automation.CreateBrowsingContextParams" })
) as any as Schema.Codec<CreateBrowsingContextParams>

/**
 * Opens a new browsing context in the automation session and makes it the active browsing context for user interaction. This command creates a browsing context in a new window rather than adding a tab to an existing window.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface CreateBrowsingContextResult {
  /**
   * An opaque handle for the newly created browsing context.
   */
  readonly handle: BrowsingContextHandle
  /**
   * How the browser presented the new browsing context (new tab or new window).
   */
  readonly presentation: BrowsingContextPresentation
}

/**
 * Schema for `CreateBrowsingContextResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const CreateBrowsingContextResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    handle: BrowsingContextHandle,
    presentation: BrowsingContextPresentation
  }).annotate({ identifier: "Automation.CreateBrowsingContextResult" })
) as any as Schema.Codec<CreateBrowsingContextResult>

/**
 * Delete all cookies that are visible to the specified browsing context.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface DeleteAllCookiesParams {
  /**
   * The handle for the browsing context.
   */
  readonly browsingContextHandle: BrowsingContextHandle
}

/**
 * Schema for `DeleteAllCookiesParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const DeleteAllCookiesParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    browsingContextHandle: BrowsingContextHandle
  }).annotate({ identifier: "Automation.DeleteAllCookiesParams" })
) as any as Schema.Codec<DeleteAllCookiesParams>

/**
 * Deletes a cookie with the given name if visible to the specified browsing context.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface DeleteSingleCookieParams {
  /**
   * The handle for the browsing context.
   */
  readonly browsingContextHandle: BrowsingContextHandle
  /**
   * Name of the cookie to remove.
   */
  readonly cookieName: string
}

/**
 * Schema for `DeleteSingleCookieParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const DeleteSingleCookieParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    browsingContextHandle: BrowsingContextHandle,
    cookieName: Schema.String
  }).annotate({ identifier: "Automation.DeleteSingleCookieParams" })
) as any as Schema.Codec<DeleteSingleCookieParams>

/**
 * Dismisses a JavaScript alert, confirm, or prompt dialog currently showing in a browsing context. Equivalent to clicking the 'Cancel' button.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface DismissCurrentJavaScriptDialogParams {
  /**
   * The handle for the browsing context.
   */
  readonly browsingContextHandle: BrowsingContextHandle
}

/**
 * Schema for `DismissCurrentJavaScriptDialogParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const DismissCurrentJavaScriptDialogParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    browsingContextHandle: BrowsingContextHandle
  }).annotate({ identifier: "Automation.DismissCurrentJavaScriptDialogParams" })
) as any as Schema.Codec<DismissCurrentJavaScriptDialogParams>

/**
 * Evaluates a script function in a browsing context and calls it with the supplied arguments.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface EvaluateJavaScriptFunctionParams {
  /**
   * The handle for the browsing context the script should be evaluated.
   */
  readonly browsingContextHandle: BrowsingContextHandle
  /**
   * The handle for the frame the script should be evaluated. The main frame is used if this parameter empty string or excluded.
   */
  readonly frameHandle?: FrameHandle | undefined
  /**
   * The script to evaluate in the browsing context. It must be a function result.
   */
  readonly function: string
  /**
   * The arguments to pass to the function when called. They will be parsed as JSON before calling the function.
   */
  readonly arguments: ReadonlyArray<string>
  /**
   * The function expects a callback function as the last argument. It is expected to call this callback with a result.
   */
  readonly expectsImplicitCallbackArgument?: boolean | undefined
  /**
   * Force a user gesture when the script is evaluated. Defaults to false if omitted.
   */
  readonly forceUserGesture?: boolean | undefined
  /**
   * The timeout in milliseconds that the implicit callback is expected to be called in, otherwise a <code>JavaScriptTimeout</code> error is returned.
   */
  readonly callbackTimeout?: number | undefined
}

/**
 * Schema for `EvaluateJavaScriptFunctionParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const EvaluateJavaScriptFunctionParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    browsingContextHandle: BrowsingContextHandle,
    frameHandle: Schema.optional(FrameHandle),
    function: Schema.String,
    arguments: Schema.Array(Schema.String),
    expectsImplicitCallbackArgument: Schema.optional(Schema.Boolean),
    forceUserGesture: Schema.optional(Schema.Boolean),
    callbackTimeout: Schema.optional(Schema.Number)
  }).annotate({ identifier: "Automation.EvaluateJavaScriptFunctionParams" })
) as any as Schema.Codec<EvaluateJavaScriptFunctionParams>

/**
 * Evaluates a script function in a browsing context and calls it with the supplied arguments.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface EvaluateJavaScriptFunctionResult {
  /**
   * The result returned by the called function. It is JSON encoded after the function returns or calls the callback.
   */
  readonly result: string
}

/**
 * Schema for `EvaluateJavaScriptFunctionResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const EvaluateJavaScriptFunctionResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    result: Schema.String
  }).annotate({ identifier: "Automation.EvaluateJavaScriptFunctionResult" })
) as any as Schema.Codec<EvaluateJavaScriptFunctionResult>

/**
 * Fired when a file chooser for a file input element is dismissed by selecting files or cancelling.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface FileChooserDismissedParams {
  /**
   * The handle for the browsing context.
   */
  readonly browsingContextHandle: BrowsingContextHandle
  /**
   * If true, file selection was cancelled due to an error. For example, this could occur if a file's MIME type cannot be handled by WebKit.
   */
  readonly selectionCancelled: boolean
  /**
   * A list of file names that were successfully selected for upload.
   */
  readonly selectedFiles?: ReadonlyArray<string> | undefined
}

/**
 * Schema for `FileChooserDismissedParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const FileChooserDismissedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    browsingContextHandle: BrowsingContextHandle,
    selectionCancelled: Schema.Boolean,
    selectedFiles: Schema.optional(Schema.Array(Schema.String))
  }).annotate({ identifier: "Automation.FileChooserDismissedParams" })
) as any as Schema.Codec<FileChooserDismissedParams>

/**
 * generate a test report for the specified browsing context
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface GenerateTestReportParams {
  /**
   * The handle for the browsing context.
   */
  readonly browsingContextHandle: BrowsingContextHandle
  /**
   * The body message for the generated test report.
   */
  readonly message: string
  /**
   * The group value to use when sending a test report.
   */
  readonly group: string
}

/**
 * Schema for `GenerateTestReportParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const GenerateTestReportParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    browsingContextHandle: BrowsingContextHandle,
    message: Schema.String,
    group: Schema.String
  }).annotate({ identifier: "Automation.GenerateTestReportParams" })
) as any as Schema.Codec<GenerateTestReportParams>

/**
 * Returns all cookies visible to the specified browsing context.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface GetAllCookiesParams {
  /**
   * The handle for the browsing context.
   */
  readonly browsingContextHandle: BrowsingContextHandle
}

/**
 * Schema for `GetAllCookiesParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const GetAllCookiesParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    browsingContextHandle: BrowsingContextHandle
  }).annotate({ identifier: "Automation.GetAllCookiesParams" })
) as any as Schema.Codec<GetAllCookiesParams>

/**
 * Returns all cookies visible to the specified browsing context.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface GetAllCookiesResult {
  /**
   * Array of cookie objects.
   */
  readonly cookies: ReadonlyArray<Cookie>
}

/**
 * Schema for `GetAllCookiesResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const GetAllCookiesResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    cookies: Schema.Array(Cookie)
  }).annotate({ identifier: "Automation.GetAllCookiesResult" })
) as any as Schema.Codec<GetAllCookiesResult, unknown>

/**
 * Fetches information about the specified browsing context.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface GetBrowsingContextParams {
  /**
   * The handle for the browsing context.
   */
  readonly handle: BrowsingContextHandle
}

/**
 * Schema for `GetBrowsingContextParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const GetBrowsingContextParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    handle: BrowsingContextHandle
  }).annotate({ identifier: "Automation.GetBrowsingContextParams" })
) as any as Schema.Codec<GetBrowsingContextParams>

/**
 * Fetches information about the specified browsing context.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface GetBrowsingContextResult {
  /**
   * The browsing context available to the session.
   */
  readonly context: BrowsingContext
}

/**
 * Schema for `GetBrowsingContextResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const GetBrowsingContextResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    context: BrowsingContext
  }).annotate({ identifier: "Automation.GetBrowsingContextResult" })
) as any as Schema.Codec<GetBrowsingContextResult>

/**
 * Fetches information about all open browsing contexts (windows and tabs) in the automation session.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface GetBrowsingContextsResult {
  /**
   * All known browsing contexts available to the session.
   */
  readonly contexts: ReadonlyArray<BrowsingContext>
}

/**
 * Schema for `GetBrowsingContextsResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const GetBrowsingContextsResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    contexts: Schema.Array(BrowsingContext)
  }).annotate({ identifier: "Automation.GetBrowsingContextsResult" })
) as any as Schema.Codec<GetBrowsingContextsResult>

/**
 * Get the Accessible Name and Description Computation computed accessible name of the element.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface GetComputedLabelParams {
  /**
   * The handle for the browsing context.
   */
  readonly browsingContextHandle: BrowsingContextHandle
  /**
   * The handle for the frame that contains the element. The main frame is used if this parameter is empty string.
   */
  readonly frameHandle: FrameHandle
  /**
   * The handle of the element to get the label of.
   */
  readonly nodeHandle: NodeHandle
}

/**
 * Schema for `GetComputedLabelParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const GetComputedLabelParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    browsingContextHandle: BrowsingContextHandle,
    frameHandle: FrameHandle,
    nodeHandle: NodeHandle
  }).annotate({ identifier: "Automation.GetComputedLabelParams" })
) as any as Schema.Codec<GetComputedLabelParams>

/**
 * Get the Accessible Name and Description Computation computed accessible name of the element.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface GetComputedLabelResult {
  /**
   * The computed label for the element.
   */
  readonly label: string
}

/**
 * Schema for `GetComputedLabelResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const GetComputedLabelResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    label: Schema.String
  }).annotate({ identifier: "Automation.GetComputedLabelResult" })
) as any as Schema.Codec<GetComputedLabelResult>

/**
 * Get the computed WAI-ARIA role of the element.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface GetComputedRoleParams {
  /**
   * The handle for the browsing context.
   */
  readonly browsingContextHandle: BrowsingContextHandle
  /**
   * The handle for the frame that contains the element. The main frame is used if this parameter is empty string.
   */
  readonly frameHandle: FrameHandle
  /**
   * The handle of the element to get the role of.
   */
  readonly nodeHandle: NodeHandle
}

/**
 * Schema for `GetComputedRoleParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const GetComputedRoleParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    browsingContextHandle: BrowsingContextHandle,
    frameHandle: FrameHandle,
    nodeHandle: NodeHandle
  }).annotate({ identifier: "Automation.GetComputedRoleParams" })
) as any as Schema.Codec<GetComputedRoleParams>

/**
 * Get the computed WAI-ARIA role of the element.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface GetComputedRoleResult {
  /**
   * The computed WAI-ARIA role of the element.
   */
  readonly role: string
}

/**
 * Schema for `GetComputedRoleResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const GetComputedRoleResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    role: Schema.String
  }).annotate({ identifier: "Automation.GetComputedRoleResult" })
) as any as Schema.Codec<GetComputedRoleResult>

/**
 * Returns the state of all session permissions, which control whether privileged Web APIs can be used. Permissions are applied to all browsing contexts associated with the automation session.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface GetSessionPermissionsResult {
  /**
   * Array of available session permissions and their values.
   */
  readonly permissions: ReadonlyArray<SessionPermissionData>
}

/**
 * Schema for `GetSessionPermissionsResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const GetSessionPermissionsResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    permissions: Schema.Array(SessionPermissionData)
  }).annotate({ identifier: "Automation.GetSessionPermissionsResult" })
) as any as Schema.Codec<GetSessionPermissionsResult>

/**
 * Get all credentials for a given virtual authenticator for the specified browsing context
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface GetVirtualAuthenticatorCredentialsParams {
  /**
   * The handle for the browsing context.
   */
  readonly browsingContextHandle: BrowsingContextHandle
  /**
   * The virtual authenticator id to fetch all credentials for.
   */
  readonly authenticatorId: string
}

/**
 * Schema for `GetVirtualAuthenticatorCredentialsParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const GetVirtualAuthenticatorCredentialsParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    browsingContextHandle: BrowsingContextHandle,
    authenticatorId: Schema.String
  }).annotate({ identifier: "Automation.GetVirtualAuthenticatorCredentialsParams" })
) as any as Schema.Codec<GetVirtualAuthenticatorCredentialsParams>

/**
 * Get all credentials for a given virtual authenticator for the specified browsing context
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface GetVirtualAuthenticatorCredentialsResult {
  /**
   * Array of credentials for given virtual authenticator
   */
  readonly credentials: ReadonlyArray<VirtualAuthenticatorCredential>
}

/**
 * Schema for `GetVirtualAuthenticatorCredentialsResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const GetVirtualAuthenticatorCredentialsResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    credentials: Schema.Array(VirtualAuthenticatorCredential)
  }).annotate({ identifier: "Automation.GetVirtualAuthenticatorCredentialsResult" })
) as any as Schema.Codec<GetVirtualAuthenticatorCredentialsResult>

/**
 * Navigates a browsing context to go back one page in history.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface GoBackInBrowsingContextParams {
  /**
   * The handle for the browsing context that should be navigated.
   */
  readonly handle: BrowsingContextHandle
  /**
   * The page load strategy to use when determining when navigation is complete.
   */
  readonly pageLoadStrategy?: PageLoadStrategy | undefined
  /**
   * The timeout in milliseconds that the navigation is expected to be completed in, otherwise a <code>Timeout</code> error is returned.
   */
  readonly pageLoadTimeout?: number | undefined
}

/**
 * Schema for `GoBackInBrowsingContextParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const GoBackInBrowsingContextParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    handle: BrowsingContextHandle,
    pageLoadStrategy: Schema.optional(PageLoadStrategy),
    pageLoadTimeout: Schema.optional(Schema.Number)
  }).annotate({ identifier: "Automation.GoBackInBrowsingContextParams" })
) as any as Schema.Codec<GoBackInBrowsingContextParams>

/**
 * Navigates a browsing context to got forward one page in history.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface GoForwardInBrowsingContextParams {
  /**
   * The handle for the browsing context that should be navigated.
   */
  readonly handle: BrowsingContextHandle
  /**
   * The page load strategy to use when determining when navigation is complete.
   */
  readonly pageLoadStrategy?: PageLoadStrategy | undefined
  /**
   * The timeout in milliseconds that the navigation is expected to be completed in, otherwise a <code>Timeout</code> error is returned.
   */
  readonly pageLoadTimeout?: number | undefined
}

/**
 * Schema for `GoForwardInBrowsingContextParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const GoForwardInBrowsingContextParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    handle: BrowsingContextHandle,
    pageLoadStrategy: Schema.optional(PageLoadStrategy),
    pageLoadTimeout: Schema.optional(Schema.Number)
  }).annotate({ identifier: "Automation.GoForwardInBrowsingContextParams" })
) as any as Schema.Codec<GoForwardInBrowsingContextParams>

/**
 * Causes the window of the specified browsing context to be hidden/minimized/iconified. This command implicitly exits fullscreen mode.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface HideWindowOfBrowsingContextParams {
  /**
   * The handle for the browsing context whose window should be hidden.
   */
  readonly handle: BrowsingContextHandle
}

/**
 * Schema for `HideWindowOfBrowsingContextParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const HideWindowOfBrowsingContextParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    handle: BrowsingContextHandle
  }).annotate({ identifier: "Automation.HideWindowOfBrowsingContextParams" })
) as any as Schema.Codec<HideWindowOfBrowsingContextParams>

/**
 * Inspect the specified browsing context using Web Inspector. Only in builds compiled with `defined(WTF_PLATFORM_MAC) && WTF_PLATFORM_MAC`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface InspectBrowsingContextParams {
  /**
   * The handle for the browsing context that should be inspected.
   */
  readonly handle: BrowsingContextHandle
  /**
   * If this option is present and set to true, the Web Inspector will automatically start a timeline recording of the specified browsing context once it is attached. Note that this disables the debugger for the duration of the recording.
   */
  readonly enableAutoCapturing?: boolean | undefined
}

/**
 * Schema for `InspectBrowsingContextParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const InspectBrowsingContextParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    handle: BrowsingContextHandle,
    enableAutoCapturing: Schema.optional(Schema.Boolean)
  }).annotate({ identifier: "Automation.InspectBrowsingContextParams" })
) as any as Schema.Codec<InspectBrowsingContextParams>

/**
 * Checks if a browsing context is showing a JavaScript alert, confirm, or prompt dialog.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface IsShowingJavaScriptDialogParams {
  /**
   * The handle for the browsing context.
   */
  readonly browsingContextHandle: BrowsingContextHandle
}

/**
 * Schema for `IsShowingJavaScriptDialogParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const IsShowingJavaScriptDialogParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    browsingContextHandle: BrowsingContextHandle
  }).annotate({ identifier: "Automation.IsShowingJavaScriptDialogParams" })
) as any as Schema.Codec<IsShowingJavaScriptDialogParams>

/**
 * Checks if a browsing context is showing a JavaScript alert, confirm, or prompt dialog.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface IsShowingJavaScriptDialogResult {
  /**
   * If the browsing context is showing a JavaScript dialog or not.
   */
  readonly result: boolean
}

/**
 * Schema for `IsShowingJavaScriptDialogResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const IsShowingJavaScriptDialogResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    result: Schema.Boolean
  }).annotate({ identifier: "Automation.IsShowingJavaScriptDialogResult" })
) as any as Schema.Codec<IsShowingJavaScriptDialogResult>

/**
 * Loads a web extension in the automation session. Only in builds compiled with `defined(WTF_PLATFORM_MAC) && WTF_PLATFORM_MAC`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface LoadWebExtensionParams {
  /**
   * A hint for the resource format used to load the extension.
   */
  readonly type: WebExtensionResourceOptions
  /**
   * One of the following: the path to the extension, the path to the extension's archive, or the base 64 encoded data of the extension's archive.
   */
  readonly value: string
}

/**
 * Schema for `LoadWebExtensionParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const LoadWebExtensionParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    type: WebExtensionResourceOptions,
    value: Schema.String
  }).annotate({ identifier: "Automation.LoadWebExtensionParams" })
) as any as Schema.Codec<LoadWebExtensionParams>

/**
 * Loads a web extension in the automation session. Only in builds compiled with `defined(WTF_PLATFORM_MAC) && WTF_PLATFORM_MAC`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface LoadWebExtensionResult {
  /**
   * The unique identifier of the extension.
   */
  readonly extension: string
}

/**
 * Schema for `LoadWebExtensionResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const LoadWebExtensionResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    extension: Schema.String
  }).annotate({ identifier: "Automation.LoadWebExtensionResult" })
) as any as Schema.Codec<LoadWebExtensionResult>

/**
 * Causes the window of the specified browsing context to be maximized. This command implicitly exits fullscreen mode.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface MaximizeWindowOfBrowsingContextParams {
  /**
   * The handle for the browsing context whose window should be maximized.
   */
  readonly handle: BrowsingContextHandle
}

/**
 * Schema for `MaximizeWindowOfBrowsingContextParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const MaximizeWindowOfBrowsingContextParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    handle: BrowsingContextHandle
  }).annotate({ identifier: "Automation.MaximizeWindowOfBrowsingContextParams" })
) as any as Schema.Codec<MaximizeWindowOfBrowsingContextParams>

/**
 * Returns the text displayed in a JavaScript alert, confirm, or prompt dialog currently showing in a browsing context.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface MessageOfCurrentJavaScriptDialogParams {
  /**
   * The handle for the browsing context.
   */
  readonly browsingContextHandle: BrowsingContextHandle
}

/**
 * Schema for `MessageOfCurrentJavaScriptDialogParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const MessageOfCurrentJavaScriptDialogParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    browsingContextHandle: BrowsingContextHandle
  }).annotate({ identifier: "Automation.MessageOfCurrentJavaScriptDialogParams" })
) as any as Schema.Codec<MessageOfCurrentJavaScriptDialogParams>

/**
 * Returns the text displayed in a JavaScript alert, confirm, or prompt dialog currently showing in a browsing context.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface MessageOfCurrentJavaScriptDialogResult {
  /**
   * Text being displayed in the current JavaScript dialog.
   */
  readonly message: string
}

/**
 * Schema for `MessageOfCurrentJavaScriptDialogResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const MessageOfCurrentJavaScriptDialogResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    message: Schema.String
  }).annotate({ identifier: "Automation.MessageOfCurrentJavaScriptDialogResult" })
) as any as Schema.Codec<MessageOfCurrentJavaScriptDialogResult>

/**
 * Navigates a browsing context to a specified URL.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface NavigateBrowsingContextParams {
  /**
   * The handle for the browsing context that should be navigated.
   */
  readonly handle: BrowsingContextHandle
  /**
   * The URL to load in the browsing context.
   */
  readonly url: string
  /**
   * The page load strategy to use when determining when navigation is complete.
   */
  readonly pageLoadStrategy?: PageLoadStrategy | undefined
  /**
   * The timeout in milliseconds that the navigation is expected to be completed in, otherwise a <code>Timeout</code> error is returned.
   */
  readonly pageLoadTimeout?: number | undefined
}

/**
 * Schema for `NavigateBrowsingContextParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const NavigateBrowsingContextParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    handle: BrowsingContextHandle,
    url: Schema.String,
    pageLoadStrategy: Schema.optional(PageLoadStrategy),
    pageLoadTimeout: Schema.optional(Schema.Number)
  }).annotate({ identifier: "Automation.NavigateBrowsingContextParams" })
) as any as Schema.Codec<NavigateBrowsingContextParams>

/**
 * Perform a named command by delegating to the automation session client application.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface PerformApplicationCommandParams {
  /**
   * The handle for the targeted browsing context.
   */
  readonly browsingContextHandle: BrowsingContextHandle
  /**
   * The name of the command to perform.
   */
  readonly commandName: string
  /**
   * JSON-encoded command arguments.
   */
  readonly arguments: string
}

/**
 * Schema for `PerformApplicationCommandParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const PerformApplicationCommandParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    browsingContextHandle: BrowsingContextHandle,
    commandName: Schema.String,
    arguments: Schema.String
  }).annotate({ identifier: "Automation.PerformApplicationCommandParams" })
) as any as Schema.Codec<PerformApplicationCommandParams>

/**
 * Perform a named command by delegating to the automation session client application.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface PerformApplicationCommandResult {
  /**
   * JSON-encoded command result.
   */
  readonly result: string
}

/**
 * Schema for `PerformApplicationCommandResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const PerformApplicationCommandResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    result: Schema.String
  }).annotate({ identifier: "Automation.PerformApplicationCommandResult" })
) as any as Schema.Codec<PerformApplicationCommandResult>

/**
 * Perform multiple simulated interactions over time using a list of input sources and a list of steps, where each step specifies a state for each input source at the time that step is performed.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface PerformInteractionSequenceParams {
  /**
   * The browsing context to be interacted with.
   */
  readonly handle: BrowsingContextHandle
  /**
   * The handle for the frame in which to search for the elements in case of an 'Element' type MouseMoveOrigin. The main frame is used if this parameter empty string or excluded.
   */
  readonly frameHandle?: FrameHandle | undefined
  /**
   * All input sources that are used to perform this interaction sequence.
   */
  readonly inputSources: ReadonlyArray<InputSource>
  /**
   * A list of steps that are executed in order.
   */
  readonly steps: ReadonlyArray<InteractionStep>
}

/**
 * Schema for `PerformInteractionSequenceParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const PerformInteractionSequenceParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    handle: BrowsingContextHandle,
    frameHandle: Schema.optional(FrameHandle),
    inputSources: Schema.Array(InputSource),
    steps: Schema.Array(InteractionStep)
  }).annotate({ identifier: "Automation.PerformInteractionSequenceParams" })
) as any as Schema.Codec<PerformInteractionSequenceParams>

/**
 * Simulates delivering the results of pressing one or more keyboard keys together or successively.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface PerformKeyboardInteractionsParams {
  /**
   * The handle for the browsing context which should receive key.
   */
  readonly handle: BrowsingContextHandle
  /**
   * An ordered list of key sequences to be delivered using native key events.
   */
  readonly interactions: ReadonlyArray<KeyboardInteraction>
}

/**
 * Schema for `PerformKeyboardInteractionsParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const PerformKeyboardInteractionsParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    handle: BrowsingContextHandle,
    interactions: Schema.Array(KeyboardInteraction)
  }).annotate({ identifier: "Automation.PerformKeyboardInteractionsParams" })
) as any as Schema.Codec<PerformKeyboardInteractionsParams>

/**
 * Simulates interaction with a mouse cursor.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface PerformMouseInteractionParams {
  /**
   * The browsing context to be interacted with.
   */
  readonly handle: BrowsingContextHandle
  /**
   * The requested position for the mouse cursor, specified in viewport coordinates.
   */
  readonly position: Point
  /**
   * The button to use to perform the interaction. This parameter only has an effect for the <code>Down</code>, <code>Up</code>, <code>Click</code>, and <code>DoubleClick</code> mouse interactions.
   */
  readonly button: MouseButton
  /**
   * The type of interaction to be performed with the mouse cursor.
   */
  readonly interaction: MouseInteraction
  /**
   * Key modifiers to be active during the mouse interaction.
   */
  readonly modifiers: ReadonlyArray<KeyModifier>
}

/**
 * Schema for `PerformMouseInteractionParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const PerformMouseInteractionParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    handle: BrowsingContextHandle,
    position: Point,
    button: MouseButton,
    interaction: MouseInteraction,
    modifiers: Schema.Array(KeyModifier)
  }).annotate({ identifier: "Automation.PerformMouseInteractionParams" })
) as any as Schema.Codec<PerformMouseInteractionParams>

/**
 * Simulates interaction with a mouse cursor.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface PerformMouseInteractionResult {
  /**
   * The updated position of the mouse cursor, specified in viewport coordinates.
   */
  readonly position: Point
}

/**
 * Schema for `PerformMouseInteractionResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const PerformMouseInteractionResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    position: Point
  }).annotate({ identifier: "Automation.PerformMouseInteractionResult" })
) as any as Schema.Codec<PerformMouseInteractionResult>

/**
 * Relay a WebDriver Bidi message from the client to be processed by the automation session. Only in builds compiled with `ENABLE(WEBDRIVER_BIDI)`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface ProcessBidiMessageParams {
  /**
   * A Bidi message sent by the client to WebKit, encoded as a UTF-8 JSON literal.
   */
  readonly message: string
}

/**
 * Schema for `ProcessBidiMessageParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ProcessBidiMessageParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    message: Schema.String
  }).annotate({ identifier: "Automation.ProcessBidiMessageParams" })
) as any as Schema.Codec<ProcessBidiMessageParams>

/**
 * Relay a Web Inspector backend message from a browsing context's Inspector controller back to the client. Only in builds compiled with `ENABLE(REMOTE_INSPECTOR)`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface ReceiveInspectorMessageParams {
  /**
   * The handle for the browsing context whose Inspector controller emitted the message.
   */
  readonly browsingContextHandle: BrowsingContextHandle
  /**
   * An Inspector backend message sent by WebKit to the client, encoded as a UTF-8 JSON literal.
   */
  readonly message: string
}

/**
 * Schema for `ReceiveInspectorMessageParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ReceiveInspectorMessageParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    browsingContextHandle: BrowsingContextHandle,
    message: Schema.String
  }).annotate({ identifier: "Automation.ReceiveInspectorMessageParams" })
) as any as Schema.Codec<ReceiveInspectorMessageParams>

/**
 * Reloads the current page in a browsing context.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface ReloadBrowsingContextParams {
  /**
   * The handle for the browsing context that should be reloaded.
   */
  readonly handle: BrowsingContextHandle
  /**
   * The page load strategy to use when determining when navigation is complete.
   */
  readonly pageLoadStrategy?: PageLoadStrategy | undefined
  /**
   * The timeout in milliseconds that the navigation is expected to be completed in, otherwise a <code>Timeout</code> error is returned.
   */
  readonly pageLoadTimeout?: number | undefined
}

/**
 * Schema for `ReloadBrowsingContextParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ReloadBrowsingContextParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    handle: BrowsingContextHandle,
    pageLoadStrategy: Schema.optional(PageLoadStrategy),
    pageLoadTimeout: Schema.optional(Schema.Number)
  }).annotate({ identifier: "Automation.ReloadBrowsingContextParams" })
) as any as Schema.Codec<ReloadBrowsingContextParams>

/**
 * Remove all credentials from a given virtual authenticatior for the specified browsing context
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface RemoveAllVirtualAuthenticatorCredentialsParams {
  /**
   * The handle for the browsing context.
   */
  readonly browsingContextHandle: BrowsingContextHandle
  /**
   * The virtual authenticator id to fetch all credentials for.
   */
  readonly authenticatorId: string
}

/**
 * Schema for `RemoveAllVirtualAuthenticatorCredentialsParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const RemoveAllVirtualAuthenticatorCredentialsParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    browsingContextHandle: BrowsingContextHandle,
    authenticatorId: Schema.String
  }).annotate({ identifier: "Automation.RemoveAllVirtualAuthenticatorCredentialsParams" })
) as any as Schema.Codec<RemoveAllVirtualAuthenticatorCredentialsParams>

/**
 * Removes a virtual web authentication authenticator for the specified browsing context.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface RemoveVirtualAuthenticatorParams {
  /**
   * The handle for the browsing context.
   */
  readonly browsingContextHandle: BrowsingContextHandle
  /**
   * The virtual authenticator id to remove.
   */
  readonly authenticatorId: string
}

/**
 * Schema for `RemoveVirtualAuthenticatorParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const RemoveVirtualAuthenticatorParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    browsingContextHandle: BrowsingContextHandle,
    authenticatorId: Schema.String
  }).annotate({ identifier: "Automation.RemoveVirtualAuthenticatorParams" })
) as any as Schema.Codec<RemoveVirtualAuthenticatorParams>

/**
 * Remove a credential from a virtual authenticator for the specified browsing context
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface RemoveVirtualAuthenticatorCredentialParams {
  /**
   * The handle for the browsing context.
   */
  readonly browsingContextHandle: BrowsingContextHandle
  /**
   * The virtual authenticator id to fetch all credentials for.
   */
  readonly authenticatorId: string
  /**
   * The credentialId of the credential to remove from the virtual authenticator
   */
  readonly credentialId: string
}

/**
 * Schema for `RemoveVirtualAuthenticatorCredentialParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const RemoveVirtualAuthenticatorCredentialParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    browsingContextHandle: BrowsingContextHandle,
    authenticatorId: Schema.String,
    credentialId: Schema.String
  }).annotate({ identifier: "Automation.RemoveVirtualAuthenticatorCredentialParams" })
) as any as Schema.Codec<RemoveVirtualAuthenticatorCredentialParams>

/**
 * Validates that the specified browsing context exists. Command fails with <code>WindowNotFound</code> or <code>FrameNotFound</code> if the browsing context is invalid. Does not depend on user prompt handler behaviors.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface ResolveBrowsingContextParams {
  /**
   * The handle for the browsing context that should be made focused.
   */
  readonly browsingContextHandle: BrowsingContextHandle
  /**
   * The handle for the frame that should be focused. Defaults to the main frame if omitted.
   */
  readonly frameHandle?: FrameHandle | undefined
}

/**
 * Schema for `ResolveBrowsingContextParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ResolveBrowsingContextParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    browsingContextHandle: BrowsingContextHandle,
    frameHandle: Schema.optional(FrameHandle)
  }).annotate({ identifier: "Automation.ResolveBrowsingContextParams" })
) as any as Schema.Codec<ResolveBrowsingContextParams>

/**
 * Determines the <code>FrameHandle</code> based on the ordinal, name or node handle of a child frame.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface ResolveChildFrameHandleParams {
  /**
   * The handle for the browsing context in which to search for the frame.
   */
  readonly browsingContextHandle: BrowsingContextHandle
  /**
   * The handle for the frame in which to search for the frame. The main frame is used if this parameter empty string or excluded.
   */
  readonly frameHandle?: FrameHandle | undefined
  /**
   * The ordinal of the child frame to resolve as a <code>FrameHandle</code>. This is analogous to 'window.frames[ordinal]' in JavaScript.
   */
  readonly ordinal?: number | undefined
  /**
   * The name of the child frame to resolve as a <code>FrameHandle</code>. This is analogous to 'window.frames[name]' in JavaScript.
   */
  readonly name?: string | undefined
  /**
   * The handle of the child frame owner element to resolve as a <code>FrameHandle</code>.
   */
  readonly nodeHandle?: NodeHandle | undefined
}

/**
 * Schema for `ResolveChildFrameHandleParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ResolveChildFrameHandleParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    browsingContextHandle: BrowsingContextHandle,
    frameHandle: Schema.optional(FrameHandle),
    ordinal: Schema.optional(Schema.Int),
    name: Schema.optional(Schema.String),
    nodeHandle: Schema.optional(NodeHandle)
  }).annotate({ identifier: "Automation.ResolveChildFrameHandleParams" })
) as any as Schema.Codec<ResolveChildFrameHandleParams>

/**
 * Determines the <code>FrameHandle</code> based on the ordinal, name or node handle of a child frame.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface ResolveChildFrameHandleResult {
  /**
   * The <code>FrameHandle</code> for the requested frame.
   */
  readonly result: FrameHandle
}

/**
 * Schema for `ResolveChildFrameHandleResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ResolveChildFrameHandleResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    result: FrameHandle
  }).annotate({ identifier: "Automation.ResolveChildFrameHandleResult" })
) as any as Schema.Codec<ResolveChildFrameHandleResult>

/**
 * Determines the <code>FrameHandle</code> for the parent frame of the supplied <code>FrameHandle</code>.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface ResolveParentFrameHandleParams {
  /**
   * The handle for the browsing context the frame is located.
   */
  readonly browsingContextHandle: BrowsingContextHandle
  /**
   * The handle for the frame that should resolve its parent frame.
   */
  readonly frameHandle: FrameHandle
}

/**
 * Schema for `ResolveParentFrameHandleParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ResolveParentFrameHandleParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    browsingContextHandle: BrowsingContextHandle,
    frameHandle: FrameHandle
  }).annotate({ identifier: "Automation.ResolveParentFrameHandleParams" })
) as any as Schema.Codec<ResolveParentFrameHandleParams>

/**
 * Determines the <code>FrameHandle</code> for the parent frame of the supplied <code>FrameHandle</code>.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface ResolveParentFrameHandleResult {
  /**
   * The <code>FrameHandle</code> for the requested frame.
   */
  readonly result: FrameHandle
}

/**
 * Schema for `ResolveParentFrameHandleResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ResolveParentFrameHandleResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    result: FrameHandle
  }).annotate({ identifier: "Automation.ResolveParentFrameHandleResult" })
) as any as Schema.Codec<ResolveParentFrameHandleResult>

/**
 * Selects the given option element. In case of container with multiple options enabled, the element selectedness is toggled.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface SelectOptionElementParams {
  /**
   * The handle for the browsing context.
   */
  readonly browsingContextHandle: BrowsingContextHandle
  /**
   * The handle for the frame that contains the element.
   */
  readonly frameHandle: FrameHandle
  /**
   * The handle of the element to use.
   */
  readonly nodeHandle: NodeHandle
}

/**
 * Schema for `SelectOptionElementParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SelectOptionElementParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    browsingContextHandle: BrowsingContextHandle,
    frameHandle: FrameHandle,
    nodeHandle: NodeHandle
  }).annotate({ identifier: "Automation.SelectOptionElementParams" })
) as any as Schema.Codec<SelectOptionElementParams>

/**
 * Relay a Web Inspector backend message from the client into the given browsing context's Inspector controller. Available when the session is configured to permit Inspector-protocol testing over the Automation transport. Only in builds compiled with `ENABLE(REMOTE_INSPECTOR)`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface SendInspectorMessageParams {
  /**
   * The handle for the browsing context whose Inspector controller should receive the message.
   */
  readonly browsingContextHandle: BrowsingContextHandle
  /**
   * An Inspector backend message sent by the client to WebKit, encoded as a UTF-8 JSON literal.
   */
  readonly message: string
}

/**
 * Schema for `SendInspectorMessageParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SendInspectorMessageParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    browsingContextHandle: BrowsingContextHandle,
    message: Schema.String
  }).annotate({ identifier: "Automation.SendInspectorMessageParams" })
) as any as Schema.Codec<SendInspectorMessageParams>

/**
 * Sets the choosen files for the given input file upload element.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface SetFilesForInputFileUploadParams {
  /**
   * The handle for the browsing context.
   */
  readonly browsingContextHandle: BrowsingContextHandle
  /**
   * The handle for the frame that contains the input element.
   */
  readonly frameHandle: FrameHandle
  /**
   * The handle of the input element.
   */
  readonly nodeHandle: NodeHandle
  /**
   * Absolute paths to the choosen files.
   */
  readonly filenames: ReadonlyArray<string>
}

/**
 * Schema for `SetFilesForInputFileUploadParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SetFilesForInputFileUploadParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    browsingContextHandle: BrowsingContextHandle,
    frameHandle: FrameHandle,
    nodeHandle: NodeHandle,
    filenames: Schema.Array(Schema.String)
  }).annotate({ identifier: "Automation.SetFilesForInputFileUploadParams" })
) as any as Schema.Codec<SetFilesForInputFileUploadParams>

/**
 * Sets the files to be selected when a file input type element becomes active in a browsing context.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface SetFilesToSelectForFileUploadParams {
  /**
   * The handle for the browsing context.
   */
  readonly browsingContextHandle: BrowsingContextHandle
  /**
   * Absolute paths to the files that should be selected.
   */
  readonly filenames: ReadonlyArray<string>
  /**
   * An array of Base64-encoded binary data for each file to be selected. If this property is provided, it is assumed that 'filenames' are not real file paths on the session host's filesystem, and this binary data will be used instead.
   */
  readonly fileContents?: ReadonlyArray<string> | undefined
}

/**
 * Schema for `SetFilesToSelectForFileUploadParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SetFilesToSelectForFileUploadParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    browsingContextHandle: BrowsingContextHandle,
    filenames: Schema.Array(Schema.String),
    fileContents: Schema.optional(Schema.Array(Schema.String))
  }).annotate({ identifier: "Automation.SetFilesToSelectForFileUploadParams" })
) as any as Schema.Codec<SetFilesToSelectForFileUploadParams>

/**
 * Attempts to set the state of session permissions, which control whether privileged Web APIs can be used. Permissions that are not understood are ignored. Permissions are applied to all browsing contexts associated with the automation session.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface SetSessionPermissionsParams {
  /**
   * Array of session permissions to set, if they are available.
   */
  readonly permissions: ReadonlyArray<SessionPermissionData>
}

/**
 * Schema for `SetSessionPermissionsParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SetSessionPermissionsParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    permissions: Schema.Array(SessionPermissionData)
  }).annotate({ identifier: "Automation.SetSessionPermissionsParams" })
) as any as Schema.Codec<SetSessionPermissionsParams>

/**
 * Simulates user modification of a PermissionDescriptor's permission status for storage-access.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface SetStorageAccessPermissionStateParams {
  /**
   * The handle for the targeted browsing context.
   */
  readonly browsingContextHandle: BrowsingContextHandle
  /**
   * The handle for the frame to set storage access permission for.
   */
  readonly frameHandle: FrameHandle
  /**
   * The new state to be applied to the permission.
   */
  readonly state: PermissionState
}

/**
 * Schema for `SetStorageAccessPermissionStateParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SetStorageAccessPermissionStateParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    browsingContextHandle: BrowsingContextHandle,
    frameHandle: FrameHandle,
    state: PermissionState
  }).annotate({ identifier: "Automation.SetStorageAccessPermissionStateParams" })
) as any as Schema.Codec<SetStorageAccessPermissionStateParams>

/**
 * Modifies the storage access policy for the specified browsing context.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface SetStorageAccessPolicyParams {
  /**
   * The handle for the browsing context.
   */
  readonly browsingContextHandle: BrowsingContextHandle
  /**
   * Whether to block third-party cookie storage access.
   */
  readonly blocked: boolean
}

/**
 * Schema for `SetStorageAccessPolicyParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SetStorageAccessPolicyParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    browsingContextHandle: BrowsingContextHandle,
    blocked: Schema.Boolean
  }).annotate({ identifier: "Automation.SetStorageAccessPolicyParams" })
) as any as Schema.Codec<SetStorageAccessPolicyParams>

/**
 * Sets the user entered value in a JavaScript prompt dialog currently showing in a browsing context.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface SetUserInputForCurrentJavaScriptPromptParams {
  /**
   * The handle for the browsing context.
   */
  readonly browsingContextHandle: BrowsingContextHandle
  /**
   * The text to enter in the prompt.
   */
  readonly userInput: string
}

/**
 * Schema for `SetUserInputForCurrentJavaScriptPromptParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SetUserInputForCurrentJavaScriptPromptParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    browsingContextHandle: BrowsingContextHandle,
    userInput: Schema.String
  }).annotate({ identifier: "Automation.SetUserInputForCurrentJavaScriptPromptParams" })
) as any as Schema.Codec<SetUserInputForCurrentJavaScriptPromptParams>

/**
 * set isUserVerified property for a given virtual authenticator for the specified browsing context
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface SetVirtualAuthenticatorUserVerifiedParams {
  /**
   * The handle for the browsing context.
   */
  readonly browsingContextHandle: BrowsingContextHandle
  /**
   * The virtual authenticator id to fetch all credentials for.
   */
  readonly authenticatorId: string
  /**
   * The isUserVerified value to set on the given virtual authenticator
   */
  readonly isUserVerified: boolean
}

/**
 * Schema for `SetVirtualAuthenticatorUserVerifiedParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SetVirtualAuthenticatorUserVerifiedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    browsingContextHandle: BrowsingContextHandle,
    authenticatorId: Schema.String,
    isUserVerified: Schema.Boolean
  }).annotate({ identifier: "Automation.SetVirtualAuthenticatorUserVerifiedParams" })
) as any as Schema.Codec<SetVirtualAuthenticatorUserVerifiedParams>

/**
 * Moves and/or resizes the window of the specified top-level browsing context to the specified position and size. Both position and size may be omitted. This command implicitly exits fullscreen and restores the window (if previously hidden), then optionally sets the window frame.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface SetWindowFrameOfBrowsingContextParams {
  /**
   * The handle for the browsing context to be resized.
   */
  readonly handle: BrowsingContextHandle
  /**
   * The new origin for the browsing context's window. The position is interpreted in screen coordinate space, relative to the upper left corner of the screen.
   */
  readonly origin?: Point | undefined
  /**
   * The new size for the browsing context's window. The size is interpreted in screen pixels.
   */
  readonly size?: Size | undefined
}

/**
 * Schema for `SetWindowFrameOfBrowsingContextParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SetWindowFrameOfBrowsingContextParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    handle: BrowsingContextHandle,
    origin: Schema.optional(Point),
    size: Schema.optional(Size)
  }).annotate({ identifier: "Automation.SetWindowFrameOfBrowsingContextParams" })
) as any as Schema.Codec<SetWindowFrameOfBrowsingContextParams>

/**
 * Activates the specified browsing context and optional frame, which gives them focus (causing the 'focus' DOM event to fire, and 'blur' DOM event to fire for the previous browsing context and frame).
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface SwitchToBrowsingContextParams {
  /**
   * The handle for the browsing context that should be made focused.
   */
  readonly browsingContextHandle: BrowsingContextHandle
  /**
   * The handle for the frame that should be focused. Defaults to the main frame if omitted.
   */
  readonly frameHandle?: FrameHandle | undefined
}

/**
 * Schema for `SwitchToBrowsingContextParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SwitchToBrowsingContextParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    browsingContextHandle: BrowsingContextHandle,
    frameHandle: Schema.optional(FrameHandle)
  }).annotate({ identifier: "Automation.SwitchToBrowsingContextParams" })
) as any as Schema.Codec<SwitchToBrowsingContextParams>

/**
 * Take a screenshot of the current page or given element in a browsing context.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface TakeScreenshotParams {
  /**
   * The handle for the browsing context to take a screenshot of.
   */
  readonly handle: BrowsingContextHandle
  /**
   * The handle for the frame that contains the element. The main frame is used if this parameter is empty string or excluded.
   */
  readonly frameHandle?: FrameHandle | undefined
  /**
   * The handle of the element to take a screenshot of. The browsing context document element is used if this parameter is excluded.
   */
  readonly nodeHandle?: NodeHandle | undefined
  /**
   * If the element should be scrolled into view before taking the screenshot.
   */
  readonly scrollIntoViewIfNeeded?: boolean | undefined
  /**
   * Whether a screenshot of the entire page should be clipped to the visual viewport. A value of 'false' preserves behavior for legacy protocol screenshots.
   */
  readonly clipToViewport?: boolean | undefined
}

/**
 * Schema for `TakeScreenshotParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const TakeScreenshotParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    handle: BrowsingContextHandle,
    frameHandle: Schema.optional(FrameHandle),
    nodeHandle: Schema.optional(NodeHandle),
    scrollIntoViewIfNeeded: Schema.optional(Schema.Boolean),
    clipToViewport: Schema.optional(Schema.Boolean)
  }).annotate({ identifier: "Automation.TakeScreenshotParams" })
) as any as Schema.Codec<TakeScreenshotParams>

/**
 * Take a screenshot of the current page or given element in a browsing context.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface TakeScreenshotResult {
  /**
   * Base64-encoded image data (PNG).
   */
  readonly data: string
}

/**
 * Schema for `TakeScreenshotResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const TakeScreenshotResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    data: Schema.String
  }).annotate({ identifier: "Automation.TakeScreenshotResult" })
) as any as Schema.Codec<TakeScreenshotResult>

/**
 * Unloads a web extension in the automation session. Only in builds compiled with `defined(WTF_PLATFORM_MAC) && WTF_PLATFORM_MAC`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface UnloadWebExtensionParams {
  /**
   * The identifier of the extension to unload.
   */
  readonly identifier: string
}

/**
 * Schema for `UnloadWebExtensionParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const UnloadWebExtensionParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    identifier: Schema.String
  }).annotate({ identifier: "Automation.UnloadWebExtensionParams" })
) as any as Schema.Codec<UnloadWebExtensionParams>

/**
 * Wait for pending navigation to complete.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface WaitForNavigationToCompleteParams {
  /**
   * The handle for the browsing context in which wait for pending navigation to complete.
   */
  readonly browsingContextHandle: BrowsingContextHandle
  /**
   * The handle for the frame in which wait for pending navigation to complete. The main frame is used if this parameter empty string or excluded.
   */
  readonly frameHandle?: FrameHandle | undefined
  /**
   * The page load strategy to use when determining when navigation is complete.
   */
  readonly pageLoadStrategy?: PageLoadStrategy | undefined
  /**
   * The timeout in milliseconds that the navigation is expected to be completed in, otherwise a <code>Timeout</code> error is returned.
   */
  readonly pageLoadTimeout?: number | undefined
}

/**
 * Schema for `WaitForNavigationToCompleteParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const WaitForNavigationToCompleteParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    browsingContextHandle: BrowsingContextHandle,
    frameHandle: Schema.optional(FrameHandle),
    pageLoadStrategy: Schema.optional(PageLoadStrategy),
    pageLoadTimeout: Schema.optional(Schema.Number)
  }).annotate({ identifier: "Automation.WaitForNavigationToCompleteParams" })
) as any as Schema.Codec<WaitForNavigationToCompleteParams>

/**
 * Accepts a JavaScript alert, confirm, or prompt dialog currently showing in a browsing context. Equivalent to clicking the 'OK' button.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const acceptCurrentJavaScriptDialog: Protocol.CommandDef<
  "Automation.acceptCurrentJavaScriptDialog",
  AcceptCurrentJavaScriptDialogParams,
  void
> = /*#__PURE__*/ Protocol.command(
  "Automation.acceptCurrentJavaScriptDialog",
  AcceptCurrentJavaScriptDialogParams,
  undefined,
  { status: "stable" }
)

/**
 * Add a cookie to cookie storage for the specified browsing context.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const addSingleCookie: Protocol.CommandDef<"Automation.addSingleCookie", AddSingleCookieParams, void> =
  /*#__PURE__*/ Protocol.command(
    "Automation.addSingleCookie",
    AddSingleCookieParams,
    undefined,
    { status: "stable" }
  )

/**
 * Adds a virtual web authentication authenticator for the specified browsing context.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const addVirtualAuthenticator: Protocol.CommandDef<
  "Automation.addVirtualAuthenticator",
  AddVirtualAuthenticatorParams,
  AddVirtualAuthenticatorResult
> = /*#__PURE__*/ Protocol.command(
  "Automation.addVirtualAuthenticator",
  AddVirtualAuthenticatorParams,
  AddVirtualAuthenticatorResult,
  { status: "stable" }
)

/**
 * Add a credential to a specified virutal authenticator for the specified browsing context
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const addVirtualAuthenticatorCredential: Protocol.CommandDef<
  "Automation.addVirtualAuthenticatorCredential",
  AddVirtualAuthenticatorCredentialParams,
  void
> = /*#__PURE__*/ Protocol.command(
  "Automation.addVirtualAuthenticatorCredential",
  AddVirtualAuthenticatorCredentialParams,
  undefined,
  { status: "stable" }
)

/**
 * Cancel an active interaction sequence that is currently in progress.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const cancelInteractionSequence: Protocol.CommandDef<
  "Automation.cancelInteractionSequence",
  CancelInteractionSequenceParams,
  void
> = /*#__PURE__*/ Protocol.command(
  "Automation.cancelInteractionSequence",
  CancelInteractionSequenceParams,
  undefined,
  { status: "stable" }
)

/**
 * Try to close the specified browsing context. This can trigger an unload prompt and thereafter succeed or fail.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const closeBrowsingContext: Protocol.CommandDef<
  "Automation.closeBrowsingContext",
  CloseBrowsingContextParams,
  void
> = /*#__PURE__*/ Protocol.command(
  "Automation.closeBrowsingContext",
  CloseBrowsingContextParams,
  undefined,
  { status: "stable" }
)

/**
 * Computes the layout for an element.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const computeElementLayout: Protocol.CommandDef<
  "Automation.computeElementLayout",
  ComputeElementLayoutParams,
  ComputeElementLayoutResult
> = /*#__PURE__*/ Protocol.command(
  "Automation.computeElementLayout",
  ComputeElementLayoutParams,
  ComputeElementLayoutResult,
  { status: "stable" }
)

/**
 * Opens a new browsing context in the automation session and makes it the active browsing context for user interaction. This command creates a browsing context in a new window rather than adding a tab to an existing window.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const createBrowsingContext: Protocol.CommandDef<
  "Automation.createBrowsingContext",
  CreateBrowsingContextParams,
  CreateBrowsingContextResult
> = /*#__PURE__*/ Protocol.command(
  "Automation.createBrowsingContext",
  CreateBrowsingContextParams,
  CreateBrowsingContextResult,
  {
    status: "stable",
    createsResource: true,
    release: [{ method: "Automation.closeBrowsingContext", param: "handle", from: "/handle" }]
  }
)

/**
 * Delete all cookies that are visible to the specified browsing context.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const deleteAllCookies: Protocol.CommandDef<"Automation.deleteAllCookies", DeleteAllCookiesParams, void> =
  /*#__PURE__*/ Protocol.command(
    "Automation.deleteAllCookies",
    DeleteAllCookiesParams,
    undefined,
    { status: "stable" }
  )

/**
 * Closes the automation session. Deletion of browsing contexts is handled by separate previous closeBrowsingContext commands.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const deleteSession: Protocol.CommandDef<"Automation.deleteSession", void, void> = /*#__PURE__*/ Protocol
  .command(
    "Automation.deleteSession",
    undefined,
    undefined,
    { status: "stable" }
  )

/**
 * Deletes a cookie with the given name if visible to the specified browsing context.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const deleteSingleCookie: Protocol.CommandDef<"Automation.deleteSingleCookie", DeleteSingleCookieParams, void> =
  /*#__PURE__*/ Protocol.command(
    "Automation.deleteSingleCookie",
    DeleteSingleCookieParams,
    undefined,
    { status: "stable" }
  )

/**
 * Dismisses a JavaScript alert, confirm, or prompt dialog currently showing in a browsing context. Equivalent to clicking the 'Cancel' button.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const dismissCurrentJavaScriptDialog: Protocol.CommandDef<
  "Automation.dismissCurrentJavaScriptDialog",
  DismissCurrentJavaScriptDialogParams,
  void
> = /*#__PURE__*/ Protocol.command(
  "Automation.dismissCurrentJavaScriptDialog",
  DismissCurrentJavaScriptDialogParams,
  undefined,
  { status: "stable" }
)

/**
 * Emit script.realmCreated events for currently active realms in the automation session. Only in builds compiled with `ENABLE(WEBDRIVER_BIDI)`.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const emitActiveBidiScriptRealmCreatedEvents: Protocol.CommandDef<
  "Automation.emitActiveBidiScriptRealmCreatedEvents",
  void,
  void
> = /*#__PURE__*/ Protocol.command(
  "Automation.emitActiveBidiScriptRealmCreatedEvents",
  undefined,
  undefined,
  { status: "stable" }
)

/**
 * Evaluates a script function in a browsing context and calls it with the supplied arguments.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const evaluateJavaScriptFunction: Protocol.CommandDef<
  "Automation.evaluateJavaScriptFunction",
  EvaluateJavaScriptFunctionParams,
  EvaluateJavaScriptFunctionResult
> = /*#__PURE__*/ Protocol.command(
  "Automation.evaluateJavaScriptFunction",
  EvaluateJavaScriptFunctionParams,
  EvaluateJavaScriptFunctionResult,
  { status: "stable" }
)

/**
 * generate a test report for the specified browsing context
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const generateTestReport: Protocol.CommandDef<"Automation.generateTestReport", GenerateTestReportParams, void> =
  /*#__PURE__*/ Protocol.command(
    "Automation.generateTestReport",
    GenerateTestReportParams,
    undefined,
    { status: "stable" }
  )

/**
 * Returns all cookies visible to the specified browsing context.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const getAllCookies: Protocol.CommandDef<"Automation.getAllCookies", GetAllCookiesParams, GetAllCookiesResult> =
  /*#__PURE__*/ Protocol.command(
    "Automation.getAllCookies",
    GetAllCookiesParams,
    GetAllCookiesResult,
    { status: "stable" }
  )

/**
 * Fetches information about the specified browsing context.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const getBrowsingContext: Protocol.CommandDef<
  "Automation.getBrowsingContext",
  GetBrowsingContextParams,
  GetBrowsingContextResult
> = /*#__PURE__*/ Protocol.command(
  "Automation.getBrowsingContext",
  GetBrowsingContextParams,
  GetBrowsingContextResult,
  { status: "stable" }
)

/**
 * Fetches information about all open browsing contexts (windows and tabs) in the automation session.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const getBrowsingContexts: Protocol.CommandDef<
  "Automation.getBrowsingContexts",
  void,
  GetBrowsingContextsResult
> = /*#__PURE__*/ Protocol.command(
  "Automation.getBrowsingContexts",
  undefined,
  GetBrowsingContextsResult,
  { status: "stable" }
)

/**
 * Get the Accessible Name and Description Computation computed accessible name of the element.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const getComputedLabel: Protocol.CommandDef<
  "Automation.getComputedLabel",
  GetComputedLabelParams,
  GetComputedLabelResult
> = /*#__PURE__*/ Protocol.command(
  "Automation.getComputedLabel",
  GetComputedLabelParams,
  GetComputedLabelResult,
  { status: "stable" }
)

/**
 * Get the computed WAI-ARIA role of the element.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const getComputedRole: Protocol.CommandDef<
  "Automation.getComputedRole",
  GetComputedRoleParams,
  GetComputedRoleResult
> = /*#__PURE__*/ Protocol.command(
  "Automation.getComputedRole",
  GetComputedRoleParams,
  GetComputedRoleResult,
  { status: "stable" }
)

/**
 * Returns the state of all session permissions, which control whether privileged Web APIs can be used. Permissions are applied to all browsing contexts associated with the automation session.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const getSessionPermissions: Protocol.CommandDef<
  "Automation.getSessionPermissions",
  void,
  GetSessionPermissionsResult
> = /*#__PURE__*/ Protocol.command(
  "Automation.getSessionPermissions",
  undefined,
  GetSessionPermissionsResult,
  { status: "stable" }
)

/**
 * Get all credentials for a given virtual authenticator for the specified browsing context
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const getVirtualAuthenticatorCredentials: Protocol.CommandDef<
  "Automation.getVirtualAuthenticatorCredentials",
  GetVirtualAuthenticatorCredentialsParams,
  GetVirtualAuthenticatorCredentialsResult
> = /*#__PURE__*/ Protocol.command(
  "Automation.getVirtualAuthenticatorCredentials",
  GetVirtualAuthenticatorCredentialsParams,
  GetVirtualAuthenticatorCredentialsResult,
  { status: "stable" }
)

/**
 * Navigates a browsing context to go back one page in history.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const goBackInBrowsingContext: Protocol.CommandDef<
  "Automation.goBackInBrowsingContext",
  GoBackInBrowsingContextParams,
  void
> = /*#__PURE__*/ Protocol.command(
  "Automation.goBackInBrowsingContext",
  GoBackInBrowsingContextParams,
  undefined,
  { status: "stable" }
)

/**
 * Navigates a browsing context to got forward one page in history.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const goForwardInBrowsingContext: Protocol.CommandDef<
  "Automation.goForwardInBrowsingContext",
  GoForwardInBrowsingContextParams,
  void
> = /*#__PURE__*/ Protocol.command(
  "Automation.goForwardInBrowsingContext",
  GoForwardInBrowsingContextParams,
  undefined,
  { status: "stable" }
)

/**
 * Causes the window of the specified browsing context to be hidden/minimized/iconified. This command implicitly exits fullscreen mode.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const hideWindowOfBrowsingContext: Protocol.CommandDef<
  "Automation.hideWindowOfBrowsingContext",
  HideWindowOfBrowsingContextParams,
  void
> = /*#__PURE__*/ Protocol.command(
  "Automation.hideWindowOfBrowsingContext",
  HideWindowOfBrowsingContextParams,
  undefined,
  { status: "stable" }
)

/**
 * Inspect the specified browsing context using Web Inspector. Only in builds compiled with `defined(WTF_PLATFORM_MAC) && WTF_PLATFORM_MAC`.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const inspectBrowsingContext: Protocol.CommandDef<
  "Automation.inspectBrowsingContext",
  InspectBrowsingContextParams,
  void
> = /*#__PURE__*/ Protocol.command(
  "Automation.inspectBrowsingContext",
  InspectBrowsingContextParams,
  undefined,
  { status: "stable" }
)

/**
 * Checks if a browsing context is showing a JavaScript alert, confirm, or prompt dialog.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const isShowingJavaScriptDialog: Protocol.CommandDef<
  "Automation.isShowingJavaScriptDialog",
  IsShowingJavaScriptDialogParams,
  IsShowingJavaScriptDialogResult
> = /*#__PURE__*/ Protocol.command(
  "Automation.isShowingJavaScriptDialog",
  IsShowingJavaScriptDialogParams,
  IsShowingJavaScriptDialogResult,
  { status: "stable" }
)

/**
 * Loads a web extension in the automation session. Only in builds compiled with `defined(WTF_PLATFORM_MAC) && WTF_PLATFORM_MAC`.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const loadWebExtension: Protocol.CommandDef<
  "Automation.loadWebExtension",
  LoadWebExtensionParams,
  LoadWebExtensionResult
> = /*#__PURE__*/ Protocol.command(
  "Automation.loadWebExtension",
  LoadWebExtensionParams,
  LoadWebExtensionResult,
  { status: "stable" }
)

/**
 * Causes the window of the specified browsing context to be maximized. This command implicitly exits fullscreen mode.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const maximizeWindowOfBrowsingContext: Protocol.CommandDef<
  "Automation.maximizeWindowOfBrowsingContext",
  MaximizeWindowOfBrowsingContextParams,
  void
> = /*#__PURE__*/ Protocol.command(
  "Automation.maximizeWindowOfBrowsingContext",
  MaximizeWindowOfBrowsingContextParams,
  undefined,
  { status: "stable" }
)

/**
 * Returns the text displayed in a JavaScript alert, confirm, or prompt dialog currently showing in a browsing context.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const messageOfCurrentJavaScriptDialog: Protocol.CommandDef<
  "Automation.messageOfCurrentJavaScriptDialog",
  MessageOfCurrentJavaScriptDialogParams,
  MessageOfCurrentJavaScriptDialogResult
> = /*#__PURE__*/ Protocol.command(
  "Automation.messageOfCurrentJavaScriptDialog",
  MessageOfCurrentJavaScriptDialogParams,
  MessageOfCurrentJavaScriptDialogResult,
  { status: "stable" }
)

/**
 * Navigates a browsing context to a specified URL.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const navigateBrowsingContext: Protocol.CommandDef<
  "Automation.navigateBrowsingContext",
  NavigateBrowsingContextParams,
  void
> = /*#__PURE__*/ Protocol.command(
  "Automation.navigateBrowsingContext",
  NavigateBrowsingContextParams,
  undefined,
  { status: "stable" }
)

/**
 * Perform a named command by delegating to the automation session client application.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const performApplicationCommand: Protocol.CommandDef<
  "Automation.performApplicationCommand",
  PerformApplicationCommandParams,
  PerformApplicationCommandResult
> = /*#__PURE__*/ Protocol.command(
  "Automation.performApplicationCommand",
  PerformApplicationCommandParams,
  PerformApplicationCommandResult,
  { status: "stable" }
)

/**
 * Perform multiple simulated interactions over time using a list of input sources and a list of steps, where each step specifies a state for each input source at the time that step is performed.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const performInteractionSequence: Protocol.CommandDef<
  "Automation.performInteractionSequence",
  PerformInteractionSequenceParams,
  void
> = /*#__PURE__*/ Protocol.command(
  "Automation.performInteractionSequence",
  PerformInteractionSequenceParams,
  undefined,
  { status: "stable" }
)

/**
 * Simulates delivering the results of pressing one or more keyboard keys together or successively.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const performKeyboardInteractions: Protocol.CommandDef<
  "Automation.performKeyboardInteractions",
  PerformKeyboardInteractionsParams,
  void
> = /*#__PURE__*/ Protocol.command(
  "Automation.performKeyboardInteractions",
  PerformKeyboardInteractionsParams,
  undefined,
  { status: "stable" }
)

/**
 * Simulates interaction with a mouse cursor.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const performMouseInteraction: Protocol.CommandDef<
  "Automation.performMouseInteraction",
  PerformMouseInteractionParams,
  PerformMouseInteractionResult
> = /*#__PURE__*/ Protocol.command(
  "Automation.performMouseInteraction",
  PerformMouseInteractionParams,
  PerformMouseInteractionResult,
  { status: "stable" }
)

/**
 * Relay a WebDriver Bidi message from the client to be processed by the automation session. Only in builds compiled with `ENABLE(WEBDRIVER_BIDI)`.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const processBidiMessage: Protocol.CommandDef<"Automation.processBidiMessage", ProcessBidiMessageParams, void> =
  /*#__PURE__*/ Protocol.command(
    "Automation.processBidiMessage",
    ProcessBidiMessageParams,
    undefined,
    { status: "stable" }
  )

/**
 * Reloads the current page in a browsing context.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const reloadBrowsingContext: Protocol.CommandDef<
  "Automation.reloadBrowsingContext",
  ReloadBrowsingContextParams,
  void
> = /*#__PURE__*/ Protocol.command(
  "Automation.reloadBrowsingContext",
  ReloadBrowsingContextParams,
  undefined,
  { status: "stable" }
)

/**
 * Remove all credentials from a given virtual authenticatior for the specified browsing context
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const removeAllVirtualAuthenticatorCredentials: Protocol.CommandDef<
  "Automation.removeAllVirtualAuthenticatorCredentials",
  RemoveAllVirtualAuthenticatorCredentialsParams,
  void
> = /*#__PURE__*/ Protocol.command(
  "Automation.removeAllVirtualAuthenticatorCredentials",
  RemoveAllVirtualAuthenticatorCredentialsParams,
  undefined,
  { status: "stable" }
)

/**
 * Removes a virtual web authentication authenticator for the specified browsing context.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const removeVirtualAuthenticator: Protocol.CommandDef<
  "Automation.removeVirtualAuthenticator",
  RemoveVirtualAuthenticatorParams,
  void
> = /*#__PURE__*/ Protocol.command(
  "Automation.removeVirtualAuthenticator",
  RemoveVirtualAuthenticatorParams,
  undefined,
  { status: "stable" }
)

/**
 * Remove a credential from a virtual authenticator for the specified browsing context
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const removeVirtualAuthenticatorCredential: Protocol.CommandDef<
  "Automation.removeVirtualAuthenticatorCredential",
  RemoveVirtualAuthenticatorCredentialParams,
  void
> = /*#__PURE__*/ Protocol.command(
  "Automation.removeVirtualAuthenticatorCredential",
  RemoveVirtualAuthenticatorCredentialParams,
  undefined,
  { status: "stable" }
)

/**
 * Validates that the specified browsing context exists. Command fails with <code>WindowNotFound</code> or <code>FrameNotFound</code> if the browsing context is invalid. Does not depend on user prompt handler behaviors.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const resolveBrowsingContext: Protocol.CommandDef<
  "Automation.resolveBrowsingContext",
  ResolveBrowsingContextParams,
  void
> = /*#__PURE__*/ Protocol.command(
  "Automation.resolveBrowsingContext",
  ResolveBrowsingContextParams,
  undefined,
  { status: "stable" }
)

/**
 * Determines the <code>FrameHandle</code> based on the ordinal, name or node handle of a child frame.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const resolveChildFrameHandle: Protocol.CommandDef<
  "Automation.resolveChildFrameHandle",
  ResolveChildFrameHandleParams,
  ResolveChildFrameHandleResult
> = /*#__PURE__*/ Protocol.command(
  "Automation.resolveChildFrameHandle",
  ResolveChildFrameHandleParams,
  ResolveChildFrameHandleResult,
  { status: "stable" }
)

/**
 * Determines the <code>FrameHandle</code> for the parent frame of the supplied <code>FrameHandle</code>.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const resolveParentFrameHandle: Protocol.CommandDef<
  "Automation.resolveParentFrameHandle",
  ResolveParentFrameHandleParams,
  ResolveParentFrameHandleResult
> = /*#__PURE__*/ Protocol.command(
  "Automation.resolveParentFrameHandle",
  ResolveParentFrameHandleParams,
  ResolveParentFrameHandleResult,
  { status: "stable" }
)

/**
 * Selects the given option element. In case of container with multiple options enabled, the element selectedness is toggled.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const selectOptionElement: Protocol.CommandDef<
  "Automation.selectOptionElement",
  SelectOptionElementParams,
  void
> = /*#__PURE__*/ Protocol.command(
  "Automation.selectOptionElement",
  SelectOptionElementParams,
  undefined,
  { status: "stable" }
)

/**
 * Relay a Web Inspector backend message from the client into the given browsing context's Inspector controller. Available when the session is configured to permit Inspector-protocol testing over the Automation transport. Only in builds compiled with `ENABLE(REMOTE_INSPECTOR)`.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const sendInspectorMessage: Protocol.CommandDef<
  "Automation.sendInspectorMessage",
  SendInspectorMessageParams,
  void
> = /*#__PURE__*/ Protocol.command(
  "Automation.sendInspectorMessage",
  SendInspectorMessageParams,
  undefined,
  { status: "stable" }
)

/**
 * Sets the choosen files for the given input file upload element.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const setFilesForInputFileUpload: Protocol.CommandDef<
  "Automation.setFilesForInputFileUpload",
  SetFilesForInputFileUploadParams,
  void
> = /*#__PURE__*/ Protocol.command(
  "Automation.setFilesForInputFileUpload",
  SetFilesForInputFileUploadParams,
  undefined,
  { status: "stable" }
)

/**
 * Sets the files to be selected when a file input type element becomes active in a browsing context.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const setFilesToSelectForFileUpload: Protocol.CommandDef<
  "Automation.setFilesToSelectForFileUpload",
  SetFilesToSelectForFileUploadParams,
  void
> = /*#__PURE__*/ Protocol.command(
  "Automation.setFilesToSelectForFileUpload",
  SetFilesToSelectForFileUploadParams,
  undefined,
  { status: "stable" }
)

/**
 * Attempts to set the state of session permissions, which control whether privileged Web APIs can be used. Permissions that are not understood are ignored. Permissions are applied to all browsing contexts associated with the automation session.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const setSessionPermissions: Protocol.CommandDef<
  "Automation.setSessionPermissions",
  SetSessionPermissionsParams,
  void
> = /*#__PURE__*/ Protocol.command(
  "Automation.setSessionPermissions",
  SetSessionPermissionsParams,
  undefined,
  { status: "stable" }
)

/**
 * Simulates user modification of a PermissionDescriptor's permission status for storage-access.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const setStorageAccessPermissionState: Protocol.CommandDef<
  "Automation.setStorageAccessPermissionState",
  SetStorageAccessPermissionStateParams,
  void
> = /*#__PURE__*/ Protocol.command(
  "Automation.setStorageAccessPermissionState",
  SetStorageAccessPermissionStateParams,
  undefined,
  { status: "stable" }
)

/**
 * Modifies the storage access policy for the specified browsing context.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const setStorageAccessPolicy: Protocol.CommandDef<
  "Automation.setStorageAccessPolicy",
  SetStorageAccessPolicyParams,
  void
> = /*#__PURE__*/ Protocol.command(
  "Automation.setStorageAccessPolicy",
  SetStorageAccessPolicyParams,
  undefined,
  { status: "stable" }
)

/**
 * Sets the user entered value in a JavaScript prompt dialog currently showing in a browsing context.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const setUserInputForCurrentJavaScriptPrompt: Protocol.CommandDef<
  "Automation.setUserInputForCurrentJavaScriptPrompt",
  SetUserInputForCurrentJavaScriptPromptParams,
  void
> = /*#__PURE__*/ Protocol.command(
  "Automation.setUserInputForCurrentJavaScriptPrompt",
  SetUserInputForCurrentJavaScriptPromptParams,
  undefined,
  { status: "stable" }
)

/**
 * set isUserVerified property for a given virtual authenticator for the specified browsing context
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const setVirtualAuthenticatorUserVerified: Protocol.CommandDef<
  "Automation.setVirtualAuthenticatorUserVerified",
  SetVirtualAuthenticatorUserVerifiedParams,
  void
> = /*#__PURE__*/ Protocol.command(
  "Automation.setVirtualAuthenticatorUserVerified",
  SetVirtualAuthenticatorUserVerifiedParams,
  undefined,
  { status: "stable" }
)

/**
 * Moves and/or resizes the window of the specified top-level browsing context to the specified position and size. Both position and size may be omitted. This command implicitly exits fullscreen and restores the window (if previously hidden), then optionally sets the window frame.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const setWindowFrameOfBrowsingContext: Protocol.CommandDef<
  "Automation.setWindowFrameOfBrowsingContext",
  SetWindowFrameOfBrowsingContextParams,
  void
> = /*#__PURE__*/ Protocol.command(
  "Automation.setWindowFrameOfBrowsingContext",
  SetWindowFrameOfBrowsingContextParams,
  undefined,
  { status: "stable" }
)

/**
 * Activates the specified browsing context and optional frame, which gives them focus (causing the 'focus' DOM event to fire, and 'blur' DOM event to fire for the previous browsing context and frame).
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const switchToBrowsingContext: Protocol.CommandDef<
  "Automation.switchToBrowsingContext",
  SwitchToBrowsingContextParams,
  void
> = /*#__PURE__*/ Protocol.command(
  "Automation.switchToBrowsingContext",
  SwitchToBrowsingContextParams,
  undefined,
  { status: "stable" }
)

/**
 * Take a screenshot of the current page or given element in a browsing context.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const takeScreenshot: Protocol.CommandDef<
  "Automation.takeScreenshot",
  TakeScreenshotParams,
  TakeScreenshotResult
> = /*#__PURE__*/ Protocol.command(
  "Automation.takeScreenshot",
  TakeScreenshotParams,
  TakeScreenshotResult,
  { status: "stable" }
)

/**
 * Unloads a web extension in the automation session. Only in builds compiled with `defined(WTF_PLATFORM_MAC) && WTF_PLATFORM_MAC`.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const unloadWebExtension: Protocol.CommandDef<"Automation.unloadWebExtension", UnloadWebExtensionParams, void> =
  /*#__PURE__*/ Protocol.command(
    "Automation.unloadWebExtension",
    UnloadWebExtensionParams,
    undefined,
    { status: "stable" }
  )

/**
 * Wait for pending navigation to complete.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const waitForNavigationToComplete: Protocol.CommandDef<
  "Automation.waitForNavigationToComplete",
  WaitForNavigationToCompleteParams,
  void
> = /*#__PURE__*/ Protocol.command(
  "Automation.waitForNavigationToComplete",
  WaitForNavigationToCompleteParams,
  undefined,
  { status: "stable" }
)

/**
 * Relay a WebDriver Bidi message from the automation session to be processed by the client. Only in builds compiled with `ENABLE(WEBDRIVER_BIDI)`.
 *
 * @stability unstable
 * @category events
 * @since 0.1.0
 */
export const bidiMessageSent: Protocol.EventDef<"Automation.bidiMessageSent", BidiMessageSentParams> =
  /*#__PURE__*/ Protocol.event(
    "Automation.bidiMessageSent",
    BidiMessageSentParams,
    { status: "stable" }
  )

/**
 * Fired when the specified browsing context has navigated or closed. Existing element references from the browsing context are no longer valid.
 *
 * @stability unstable
 * @category events
 * @since 0.1.0
 */
export const browsingContextCleared: Protocol.EventDef<
  "Automation.browsingContextCleared",
  BrowsingContextClearedParams
> = /*#__PURE__*/ Protocol.event(
  "Automation.browsingContextCleared",
  BrowsingContextClearedParams,
  { status: "stable" }
)

/**
 * Fired when a file chooser for a file input element is dismissed by selecting files or cancelling.
 *
 * @stability unstable
 * @category events
 * @since 0.1.0
 */
export const fileChooserDismissed: Protocol.EventDef<"Automation.fileChooserDismissed", FileChooserDismissedParams> =
  /*#__PURE__*/ Protocol.event(
    "Automation.fileChooserDismissed",
    FileChooserDismissedParams,
    { status: "stable" }
  )

/**
 * Relay a Web Inspector backend message from a browsing context's Inspector controller back to the client. Only in builds compiled with `ENABLE(REMOTE_INSPECTOR)`.
 *
 * @stability unstable
 * @category events
 * @since 0.1.0
 */
export const receiveInspectorMessage: Protocol.EventDef<
  "Automation.receiveInspectorMessage",
  ReceiveInspectorMessageParams
> = /*#__PURE__*/ Protocol.event(
  "Automation.receiveInspectorMessage",
  ReceiveInspectorMessageParams,
  { status: "stable" }
)
