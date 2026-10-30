/**
 * Capabilities: features only some backends have, acquired from a page for the caller's
 * scope. Acquiring one the backend lacks fails with `Unsupported`, read from its support table, naming the
 * backends that have it.
 */
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import type * as Scope from "effect/Scope"
import * as Stream from "effect/Stream"
import * as SubscriptionRef from "effect/SubscriptionRef"
import * as Capability from "../Capability.ts"
import type * as Deadline from "../Deadline.ts"
import type * as Diagnostics from "../Diagnostics.ts"
import type * as FilePath from "../FilePath.ts"
import type * as Pixels from "../Pixels.ts"
import * as Reason from "../Reason.ts"
import * as Target from "../Target.ts"
import type * as Adapter from "./adapter.ts"
import type * as Model from "./model.ts"
import * as Operation from "./operation.ts"
import * as Runtime from "./runtime.ts"

/** Each capability: its support table entry, and the backends that have it. */
const known: Readonly<Record<string, { readonly entry: string; readonly backends: string }>> = {
  AxTree: { entry: "capability.axTree", backends: "Chromium's (CDP)" },
  Screencast: { entry: "capability.screencast", backends: "Chromium's (CDP)" },
  Video: { entry: "capability.video", backends: "Firefox's, launched by the program" }
}

const capabilityError = (capability: string, reason: Capability.CapabilityErrorReason, id: Diagnostics.OperationId) =>
  new Capability.CapabilityError({ capability, reason, diagnostics: Operation.diagnostics(id) })

/** An adapter failure, as a capability's: the page's end, or the capability's error. */
const fromAdapter = (runtime: Runtime.Runtime, capability: string, id: Diagnostics.OperationId) =>
(
  error: Adapter.AdapterError | Deadline.Timeout
): Capability.CapabilityError | Target.TargetGone | Deadline.Timeout => {
  const mapped = Operation.fromAdapter(error, id, runtime.backend)
  return mapped._tag !== "Reason" ? mapped.error : capabilityError(capability, mapped.reason, id)
}

/** The page's end, as a `TargetGone`. */
const gone = (page: Model.PageEntry, reason: Target.CloseReason, id: Diagnostics.OperationId) =>
  new Target.TargetGone({ target: { _tag: "Page", id: page.id }, reason, diagnostics: Operation.diagnostics(id) })

/** A capability of a page, for the caller's scope. */
export const acquire = <H>(
  runtime: Runtime.Runtime,
  page: Model.PageEntry,
  capability: Capability.Capability<H>
): Effect.Effect<H, Capability.CapabilityError | Target.TargetGone | Deadline.Timeout, Scope.Scope> =>
  Effect.gen(function*() {
    const { id } = yield* Operation.record
    const which = known[capability.name]
    if (which === undefined) {
      return yield* Effect.fail(capabilityError(
        capability.name,
        new Reason.Unsupported({
          capability: capability.name,
          backend: runtime.backend,
          hint: "This version of the library doesn't know it"
        }),
        id
      ))
    }
    const closed = yield* Deferred.poll(page.closed)
    if (Option.isSome(closed)) return yield* Effect.fail(gone(page, yield* closed.value, id))
    const table = yield* SubscriptionRef.get(runtime.model.adapter.capabilities)
    const entry = table.entries.find((each) => each.name === which.entry)
    if (entry !== undefined && entry.status === "unsupported") {
      return yield* Effect.fail(capabilityError(
        capability.name,
        new Reason.Unsupported({
          capability: which.entry,
          backend: runtime.backend,
          hint: `${[...entry.limitations, `it is ${which.backends}`].join("; ")}`
        }),
        id
      ))
    }
    const adapter = runtime.model.adapter
    const attributes = { "browser.page.id": page.id, "browser.capability": capability.name }
    switch (capability.name) {
      case "AxTree": {
        const reader: Capability.AxTreeReader = {
          read: Effect.flatMap(Operation.record, ({ id }) =>
            adapter.accessibilityTree(page.id).pipe(
              Effect.mapError(fromAdapter(runtime, capability.name, id)),
              Effect.raceFirst(Runtime.pageEnded(page))
            )).pipe(Operation.named("Capability.AxTree.read", { attributes }))
        }
        return reader as H
      }
      case "Video": {
        const file = yield* adapter.video(page.id).pipe(Effect.mapError(fromAdapter(runtime, capability.name, id)))
        const recording: Capability.VideoRecording = {
          file: file.pipe(
            Effect.map((path) => path as FilePath.Local),
            Effect.mapError(fromAdapter(runtime, capability.name, Operation.idNow()))
          )
        }
        return recording as H
      }
      default: {
        const frames = yield* adapter.screencast(page.id).pipe(
          Effect.mapError(fromAdapter(runtime, capability.name, id))
        )
        const control: Capability.ScreencastControl = {
          frames: frames.pipe(
            Stream.map((frame): Capability.ScreencastFrame => ({
              at: frame.at,
              width: frame.width as Pixels.Device,
              height: frame.height as Pixels.Device,
              jpeg: frame.jpeg
            })),
            // The stream ends with the page: its session's end, as the page's
            Stream.catch((error) =>
              Stream.fromEffect(Effect.flatMap(Deferred.poll(page.closed), (closed) =>
                Option.isSome(closed)
                  ? Effect.flatMap(closed.value, (reason) => Effect.fail(gone(page, reason, Operation.idNow())))
                  : Effect.die(error)))
            ),
            Stream.interruptWhen(Runtime.pageEnded(page))
          )
        }
        return control as H
      }
    }
  }).pipe(Operation.named("Page.capability", {
    attributes: { "browser.page.id": page.id, "browser.capability": capability.name }
  }))
