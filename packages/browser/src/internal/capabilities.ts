/**
 * Capabilities: features only some backends have, acquired from a page for the caller's
 * scope. Acquiring one the backend lacks fails with `Unsupported`, read from its support table, naming the
 * backends that have it.
 */
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Result from "effect/Result"
import type * as Scope from "effect/Scope"
import * as Stream from "effect/Stream"
import * as SubscriptionRef from "effect/SubscriptionRef"
import * as Capability from "../Capability.ts"
import type * as Deadline from "../Deadline.ts"
import type * as Diagnostics from "../Diagnostics.ts"
import type * as FilePath from "../FilePath.ts"
import * as Pixels from "../Pixels.ts"
import * as Reason from "../Reason.ts"
import * as Target from "../Target.ts"
import type * as Access from "./access.ts"
import type * as Adapter from "./adapter.ts"
import type * as Model from "./model.ts"
import * as Operation from "./operation.ts"
import * as Overlays from "./overlays.ts"
import * as Runtime from "./runtime.ts"
import * as VideoOptions from "./videoOptions.ts"
import * as WebAuthn from "./webauthn.ts"

/** Each capability: its support table entry, and the backends that have it. */
const known: Readonly<Record<string, { readonly entry: string; readonly backends: string }>> = {
  VirtualAuthenticator: { entry: "capability.virtualAuthenticator", backends: "Chromium native WebAuthn (CDP)" },
  AxTree: { entry: "capability.axTree", backends: "Chromium's (CDP)" },
  Screencast: { entry: "capability.screencast", backends: "Chromium's (CDP)" },
  Overlay: { entry: "capability.overlay", backends: "every browser backend" },
  Video: { entry: "capability.video", backends: "Chromium with VideoWriter, or Firefox launched by the program" }
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

/** A video of a page: its options checked, its size settled, and its file moved to `path` when it ends. */
const video = Effect.fnUntraced(function*(
  runtime: Runtime.Runtime,
  page: Model.PageEntry,
  raw: Capability.VideoOptions | undefined
) {
  const { id } = yield* Operation.record
  const refuse = (input: string, expected: string, hint: string) =>
    Effect.fail(capabilityError("Video", new Reason.InvalidInput({ input, expected, hint }), id))
  const valid = VideoOptions.validate(raw)
  if (Result.isFailure(valid)) return yield* Effect.fail(capabilityError("Video", valid.failure, id))
  const options = valid.success
  const target = options.path
  const overwrite = options.overwrite ?? true
  let directory = Option.none<string>()
  if (target !== undefined) {
    if (Option.isNone(runtime.fileSystem)) {
      return yield* Effect.fail(capabilityError(
        "Video",
        new Reason.Unsupported({
          capability: "capability.video",
          backend: runtime.backend,
          hint: "Recording to a path needs the program's FileSystem, which a launched browser's layer provides"
        }),
        id
      ))
    }
    const fs = runtime.fileSystem.value
    const parent = target.replace(/[\\/][^\\/]*$/, "") || "/"
    const kind = yield* fs.stat(parent).pipe(Effect.map((info) => info.type), Effect.orElseSucceed(() => "missing"))
    if (kind !== "Directory") return yield* refuse("path", "a file in a directory that exists", target)
    // What is at the path already, if anything: only a file can be replaced, and only when overwrite allows it
    const existing = yield* fs.stat(target).pipe(
      Effect.map((info) => Option.some(info.type)),
      // A path that can't be read, as without permission, is refused as an entry that isn't a file
      Effect.catch((error) =>
        Effect.succeed(error.reason._tag === "NotFound" ? Option.none<string>() : Option.some("Unreadable"))
      )
    )
    if (Option.isSome(existing) && existing.value !== "File") {
      return yield* refuse("path", "a file path, not a directory or other entry", target)
    }
    if (!overwrite && Option.isSome(existing)) {
      return yield* refuse("path", "a path with no file, since overwrite is false", target)
    }
    directory = Option.some(parent)
  }
  // A declared viewport is the model's, so it is read here; without one, the backend measures the window in a way a
  // navigation can't interrupt
  const declared = options.size === undefined
    ? yield* runtime.model.adapter.viewportSize(page.id).pipe(Effect.mapError(fromAdapter(runtime, "Video", id)))
    : Option.none()
  const written = yield* runtime.model.adapter.video(page.id, {
    size: options.size !== undefined
      ? Option.some(options.size)
      : Option.map(declared, VideoOptions.defaultSize),
    fps: Option.fromNullishOr(options.fps),
    directory
  }).pipe(Effect.mapError(fromAdapter(runtime, "Video", id)))
  const finished = Effect.mapError(written, fromAdapter(runtime, "Video", Operation.idNow()))
  const file = target === undefined || Option.isNone(runtime.fileSystem)
    ? finished
    : Effect.flatMap(finished, (path) => {
      const fs = runtime.fileSystem.pipe(Option.getOrThrow)
      const moved = (error: { readonly message: string }) =>
        capabilityError(
          "Video",
          new Reason.BackendFailure({
            kind: "Rejected",
            method: "FileSystem",
            hint: `The recording stays at ${path}: it couldn't be moved to ${target}: ${error.message}`
          }),
          Operation.idNow()
        )
      // A hard link fails where a file already is, so a file that appeared while recording is never replaced
      return (overwrite
        ? fs.rename(path, target)
        : fs.link(path, target).pipe(Effect.andThen(fs.remove(path)))).pipe(
          Effect.mapError(moved),
          Effect.as(target)
        )
    })
  const recording: Capability.VideoRecording = {
    file: (yield* Effect.cached(file)).pipe(Effect.map((path) => path as FilePath.Local))
  }
  return recording
})

/** A capability of a page, for the caller's scope. */
export const acquire = <H, Options = never>(
  runtime: Runtime.Runtime,
  page: Model.PageEntry,
  capability: Capability.Capability<H, "inspect" | "control", Options>,
  options?: Options | undefined,
  grant: Option.Option<Access.Grant> = Option.none()
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
      case "VirtualAuthenticator":
        return (yield* WebAuthn.acquire(runtime, page, grant)) as H
      case "Overlay":
        return (yield* Overlays.acquire(runtime, page, grant)) as H
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
      case "Video":
        return (yield* video(runtime, page, options as Capability.VideoOptions | undefined)) as H
      default: {
        const frames = yield* adapter.screencast(page.id).pipe(
          Effect.mapError(fromAdapter(runtime, capability.name, id))
        )
        const control: Capability.ScreencastControl = {
          frames: frames.pipe(
            Stream.map((frame): Capability.ScreencastFrame => ({
              at: frame.at,
              width: Pixels.Device.make(frame.width),
              height: Pixels.Device.make(frame.height),
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
