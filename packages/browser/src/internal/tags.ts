/**
 * Elements a caller adds to a document, such as a script tag, appended from the document's main world and
 * settled by the element's own events. Nothing is installed before the call, and nothing is left after it.
 *
 * - **A resource from a URL** settles on the element's `load` or `error`. An enforced `securitypolicyviolation`
 *   whose `blockedURI` is the URL tells a refusal by the page's policy apart from a load failure; every backend
 *   dispatches it before the `error` event.
 * - **Inline JavaScript** runs, when the policy allows it, inside the append, and its text is the caller's. The
 *   policy decides during the append too, but every engine dispatches the element's `securitypolicyviolation`
 *   later, as a task, so the call needs a signal the engine orders before a second call reads the element's
 *   violation:
 *   - Chromium and WebKit write the refusal to the console as they decide it, so it is among the events sent
 *     before the append's reply, which an operation handles before it returns. Chromium's entry names the
 *     refused text's SHA-256, which ties it to this element; WebKit's names none, so any inline refusal the
 *     page's own scripts cause during the call is taken as this element's.
 *   - Firefox dispatches the event in a runnable on the main thread, queued during the append
 *     (`nsCSPContext::AsyncReportViolation`), and the next command reaches the content process as a later
 *     message on the same thread, so the second call runs after the event.
 * - **A module** is accepted or refused in the append as a classic script is, and the call returns then: without
 *   changing its text nothing tells when it has run, since it has no `load` event and top-level `await` can hold
 *   it.
 * - **The outcome** is the element, or a string naming a failure: a primitive, so it leaves no remote object.
 * - **Report-only policies** dispatch violations too, with the disposition `report`; they refuse nothing.
 */
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import type * as Scope from "effect/Scope"
import type * as Deadline from "../Deadline.ts"
import type * as JSHandle from "../JSHandle.ts"
import * as Reason from "../Reason.ts"
import type * as ScriptTag from "../ScriptTag.ts"
import type * as Target from "../Target.ts"
import type * as Adapter from "./adapter.ts"
import * as Evaluation from "./evaluation.ts"
import * as Events from "./events.ts"
import * as FunctionSource from "./functionSource.ts"
import type * as Model from "./model.ts"
import type * as Operation from "./operation.ts"
import type * as Runtime from "./runtime.ts"

/** Why adding an element failed, before a module names the operation in its own error. */
export type Failure =
  | Evaluation.Failure
  | { readonly _tag: "Reason"; readonly reason: Reason.ResourceFailed | Reason.RefusedByPolicy | Reason.InvalidInput }

/** The element to add, as the in-page function reads it. */
export interface Spec {
  readonly tag: string
  readonly attributes: ReadonlyArray<readonly [string, string]>
  readonly url: string | null
  readonly text: string | null
  /** Whether the browser runs or loads it, so the call waits for that. */
  readonly settles: boolean
}

/** The `type`s a script element runs as JavaScript: none, a module, or a JavaScript MIME type. */
const javaScriptTypes = new Set([
  "",
  "module",
  "application/ecmascript",
  "application/javascript",
  "application/x-ecmascript",
  "application/x-javascript",
  "text/ecmascript",
  "text/javascript",
  "text/javascript1.0",
  "text/javascript1.1",
  "text/javascript1.2",
  "text/javascript1.3",
  "text/javascript1.4",
  "text/javascript1.5",
  "text/jscript",
  "text/livescript",
  "text/x-ecmascript",
  "text/x-javascript"
])

/** A file's text, read now: what `{ path }` names. */
export const readPath = Effect.fnUntraced(function*(runtime: Runtime.Runtime, file: string) {
  if (Option.isNone(runtime.fileSystem) || Option.isNone(runtime.path)) {
    return yield* Effect.fail(
      new Reason.InvalidInput({
        input: "path",
        expected: "a file, where the layer has no FileSystem to read a path with",
        hint: "Provide a FileSystem and Path to the layer, or pass { source }"
      })
    )
  }
  const path = runtime.path.value.resolve(file)
  const text = yield* runtime.fileSystem.value.readFileString(path).pipe(
    Effect.mapError((error) =>
      new Reason.InvalidInput({ input: "path", expected: "a readable file", hint: `${path}: ${error.message}` })
    )
  )
  return { path, text }
})

/** A script element's spec: a path is read now and named by a `sourceURL` comment, as other tools name it. */
export const script = Effect.fnUntraced(function*(
  runtime: Runtime.Runtime,
  source: ScriptTag.Source,
  options: ScriptTag.Options | undefined
) {
  const type = options?.type
  const attributes: Array<readonly [string, string]> = []
  if (type !== undefined) attributes.push(["type", type])
  if (options?.id !== undefined) attributes.push(["id", options.id])
  const settles = javaScriptTypes.has((type ?? "").trim().toLowerCase())
  if ("url" in source) return { tag: "script", attributes, url: source.url, text: null, settles } satisfies Spec
  const text = "source" in source ? source.source : yield* Effect.map(
    readPath(runtime, source.path),
    ({ path, text }) => `${text}\n//# sourceURL=${path.replace(/\n/g, "")}`
  )
  return { tag: "script", attributes, url: null, text, settles } satisfies Spec
})

/** Runs in the document's main world: appends an element from a URL, or one the browser doesn't run, and settles. */
function insertElement(spec: Spec): Promise<Element | string> {
  return new Promise((resolve) => {
    const element = document.createElement(spec.tag)
    for (const [name, value] of spec.attributes) element.setAttribute(name, value)
    const href = spec.url === null ? null : new URL(spec.url, document.baseURI).href
    const removals: Array<() => void> = []
    let refusal: string | null = null
    const settle = (outcome: Element | string) => {
      for (const remove of removals.splice(0)) remove()
      resolve(outcome)
    }
    const listen = (target: EventTarget, type: string, listener: (event: Event) => void) => {
      target.addEventListener(type, listener, true)
      removals.push(() => target.removeEventListener(type, listener, true))
    }
    if (spec.url !== null && spec.settles) {
      listen(document, "securitypolicyviolation", (event) => {
        const violation = event as SecurityPolicyViolationEvent
        if (violation.disposition === "report" || violation.blockedURI !== href) return
        refusal = JSON.stringify({
          _tag: "Refused",
          directive: violation.effectiveDirective || violation.violatedDirective,
          blocked: violation.blockedURI
        })
      })
      listen(element, "load", () => settle(element))
      listen(element, "error", () => settle(refusal ?? JSON.stringify({ _tag: "Failed", url: href })))
    }
    if (spec.url !== null) element.setAttribute("src", spec.url)
    if (spec.text !== null) element.textContent = spec.text
    ;(document.head ?? document.documentElement ?? document).append(element)
    if (!spec.settles) settle(element)
  })
}

/** What an inline element's two calls share. */
interface Inline {
  readonly element: Element
  seen: string | null
  readonly refusal: Promise<string>
  readonly stop: () => void
}

/** Runs in the document's main world: appends inline JavaScript, which runs now if the policy allows it. */
function appendInline(spec: Spec): Inline {
  const element = document.createElement(spec.tag)
  for (const [name, value] of spec.attributes) element.setAttribute(name, value)
  let refuse = (_: string) => {}
  const state: Inline = {
    element,
    seen: null,
    refusal: new Promise<string>((resolve) => refuse = resolve),
    stop: () => document.removeEventListener("securitypolicyviolation", listener, true)
  }
  const listener = (event: Event) => {
    const violation = event as SecurityPolicyViolationEvent
    if (violation.target !== element || violation.disposition === "report") return
    state.seen = JSON.stringify({
      _tag: "Refused",
      directive: violation.effectiveDirective || violation.violatedDirective,
      blocked: violation.blockedURI
    })
    refuse(state.seen)
  }
  document.addEventListener("securitypolicyviolation", listener, true)
  element.textContent = spec.text
  ;(document.head ?? document.documentElement ?? document).append(element)
  return state
}

/** Runs after `appendInline`: the element, or its refusal, waiting for the violation the browser reported. */
function settleInline(state: Inline, reported: boolean): Element | string | Promise<string> {
  const done = <A>(outcome: A) => {
    state.stop()
    return outcome
  }
  if (state.seen !== null) return done(state.seen)
  return reported ? state.refusal.then(done) : done(state.element)
}

const outcome = (text: string): Failure => {
  const parsed = JSON.parse(text) as
    | { readonly _tag: "Refused"; readonly directive: string; readonly blocked: string }
    | { readonly _tag: "Failed"; readonly url: string }
  return {
    _tag: "Reason",
    reason: parsed._tag === "Refused"
      ? new Reason.RefusedByPolicy({
        directive: parsed.directive,
        blocked: parsed.blocked,
        hint: "The page's Content-Security-Policy refused it; the element stays in the document"
      })
      : new Reason.ResourceFailed({
        url: parsed.url,
        hint: "The element's error event fired: unreachable, an error status, or not a script; it stays in the document"
      })
  }
}

/** The base64 SHA-256 of a script's text, as CSP hashes it. */
const sha256 = (text: string) =>
  Effect.promise(() => globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))).pipe(
    Effect.map((digest) => btoa(String.fromCharCode(...new Uint8Array(digest))))
  )

/**
 * Whether a console entry is the browser's refusal of an inline script, as Chromium and WebKit word it; Chromium's
 * must name the text's hash. A report-only policy's entries begin `[Report Only]`.
 */
const refusalEntry = (protocol: string, hash: string) => (text: string) =>
  !text.startsWith("[Report Only]") && (protocol === "cdp"
    ? text.includes("inline script") && text.includes(`'sha256-${hash}'`)
    : text.startsWith("Refused to execute a script because its hash, its nonce, or 'unsafe-inline'"))

/** Adds the element in a main-world realm, as the operation's dispatch: the element, owned by the scope. */
export const insert = <A>(
  runtime: Runtime.Runtime,
  realm: Target.RealmId,
  page: Model.PageEntry,
  spec: Spec,
  record: Operation.Record
): Effect.Effect<JSHandle.JSHandle<A>, Failure, Scope.Scope> =>
  Effect.gen(function*() {
    const call = Effect.fnUntraced(function*(fn: Function, args: ReadonlyArray<unknown>, dispatch: boolean) {
      const values = yield* Evaluation.toLocal(args, realm)
      const group = yield* Evaluation.groupFor(runtime, realm, "handle")
      return yield* Evaluation.call(runtime, {
        ...(dispatch ? { dispatch: record } : {}),
        realm,
        functionDeclaration: FunctionSource.declaration(fn),
        arguments: values,
        result: "handle",
        group,
        userActivation: false,
        page: Option.some(page),
        at: record.budget.at,
        id: record.id
      })
    })
    const settled = (value: Adapter.RemoteValue) =>
      value.type === "string"
        ? Effect.fail(outcome(value.value))
        : Evaluation.own<A>(runtime, realm, value, Option.some(page))
    if (spec.url !== null || !spec.settles) return yield* settled(yield* call(insertElement, [spec], true))
    const protocol = runtime.model.adapter.info.protocol
    const matches = protocol === "bidi" ? undefined : refusalEntry(protocol, yield* sha256(spec.text ?? ""))
    // Taken before the append, so every entry the browser sent before answering it is read
    const entries = matches === undefined
      ? undefined
      : yield* Events.collect(
        page.events.console,
        (entry) => entry.value.level === "error" && matches(entry.value.text)
      )
    const state = yield* Effect.flatMap(
      call(appendInline, [spec], true),
      (value) => Evaluation.own<unknown>(runtime, realm, value, Option.none())
    )
    const reported = entries === undefined ? false : (yield* Effect.orElseSucceed(entries, () => [])).length > 0
    const value = yield* call(settleInline, [state, reported], false)
    yield* state.release
    return yield* settled(value)
  })

/** A failure as the operation's error: `Gone` and `Deadline` as every evaluation's, a reason named by `error`. */
export const fail = <E>(
  record: Operation.Record,
  error: (reason: Exclude<Failure, { readonly _tag: "Gone" | "Deadline" }>["reason"]) => E
) =>
(failure: Failure): E | Target.TargetGone | Deadline.Timeout =>
  failure._tag === "Gone"
    ? failure.error
    : failure._tag === "Deadline"
    ? record.timeout(Option.some(
      record.dispatch._tag === "MayHaveBeenSent"
        ? "The document didn't answer before the deadline; the element may still be loading"
        : "The page had no document to add the element to before the deadline"
    ))
    : error(failure.reason)
