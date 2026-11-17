/**
 * Elements a caller adds to a document, such as a script tag: one main-world call that appends the element and
 * settles on its own events. Nothing is installed before the call, and nothing is left after it.
 *
 * - **A resource from a URL** settles on the element's `load` or `error`. A `securitypolicyviolation` for the same
 *   URL tells a refusal by the page's policy apart from a load failure; every backend dispatches it before the
 *   `error` event.
 * - **Inline JavaScript** has no `load` event, a module's included, so its text ends with a call to a global named
 *   for this call alone, removed as the call settles. The page's `error` event means it ran and threw. A refusal
 *   dispatches `securitypolicyviolation` at the element itself, after the append.
 * - **The outcome** is the element, or a string naming a failure: a primitive, so it leaves no remote object.
 */
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import type * as Scope from "effect/Scope"
import type * as Deadline from "../Deadline.ts"
import type * as JSHandle from "../JSHandle.ts"
import * as Reason from "../Reason.ts"
import type * as ScriptTag from "../ScriptTag.ts"
import type * as Target from "../Target.ts"
import * as Evaluation from "./evaluation.ts"
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
  /** The global the text calls once it has run, or null when there's no inline JavaScript. */
  readonly marker: string | null
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

/** A script element's spec: a path is read now, and inline JavaScript is followed by its marker's call. */
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
  if ("url" in source) {
    return { tag: "script", attributes, url: source.url, text: null, settles, marker: null } satisfies Spec
  }
  const [text, sourceUrl] = "source" in source ? [source.source, ""] : yield* Effect.map(
    readPath(runtime, source.path),
    ({ path, text }) => [text, `\n//# sourceURL=${path.replace(/\n/g, "")}`] as const
  )
  if (!settles) return { tag: "script", attributes, url: null, text, settles, marker: null } satisfies Spec
  const marker = `__strider_ran_${globalThis.crypto.randomUUID().replace(/-/g, "")}`
  return {
    tag: "script",
    attributes,
    url: null,
    text: `${text}\n;globalThis[${JSON.stringify(marker)}]?.()${sourceUrl}`,
    settles,
    marker
  } satisfies Spec
})

/** Runs in the document's main world: appends the element, and settles on its own events. */
function insertElement(spec: Spec): Promise<Element | string> {
  return new Promise((resolve) => {
    const element = document.createElement(spec.tag)
    for (const [name, value] of spec.attributes) element.setAttribute(name, value)
    const href = spec.url === null ? null : new URL(spec.url, document.baseURI).href
    const removals: Array<() => void> = []
    let refusal: string | null = null
    let settled = false
    const settle = (outcome: Element | string) => {
      if (settled) return
      settled = true
      for (const remove of removals) remove()
      if (spec.marker !== null) Reflect.deleteProperty(globalThis, spec.marker)
      resolve(outcome)
    }
    const listen = (target: EventTarget, type: string, listener: (event: Event) => void) => {
      target.addEventListener(type, listener, true)
      removals.push(() => target.removeEventListener(type, listener, true))
    }
    listen(document, "securitypolicyviolation", (event) => {
      const violation = event as SecurityPolicyViolationEvent
      if (violation.target !== element && (href === null || violation.blockedURI !== href)) return
      refusal = JSON.stringify({
        _tag: "Refused",
        directive: violation.effectiveDirective || violation.violatedDirective,
        blocked: violation.blockedURI
      })
      if (spec.url === null) settle(refusal)
    })
    if (spec.url !== null && spec.settles) {
      listen(element, "load", () => settle(element))
      listen(element, "error", () => settle(refusal ?? JSON.stringify({ _tag: "Failed", url: href })))
    }
    if (spec.marker !== null) {
      Object.defineProperty(globalThis, spec.marker, { configurable: true, value: () => settle(element) })
      // It ran and threw, or didn't parse: the page reports that as its own error
      listen(window, "error", (event) => {
        if (event instanceof ErrorEvent) settle(element)
      })
    }
    if (spec.url !== null) element.setAttribute("src", spec.url)
    if (spec.text !== null) element.textContent = spec.text
    ;(document.head ?? document.documentElement ?? document).append(element)
    if (!spec.settles) settle(element)
  })
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

/** Adds the element in a main-world realm, as the operation's dispatch: the element, owned by the scope. */
export const insert = <A>(
  runtime: Runtime.Runtime,
  realm: Target.RealmId,
  page: Model.PageEntry,
  spec: Spec,
  record: Operation.Record
): Effect.Effect<JSHandle.JSHandle<A>, Failure, Scope.Scope> =>
  Effect.gen(function*() {
    const values = yield* Evaluation.toLocal([spec], realm)
    const group = yield* Evaluation.groupFor(runtime, realm, "handle")
    const value = yield* Evaluation.call(runtime, {
      dispatch: record,
      realm,
      functionDeclaration: FunctionSource.declaration(insertElement),
      arguments: values,
      result: "handle",
      group,
      userActivation: false,
      page: Option.some(page),
      at: record.budget.at,
      id: record.id
    })
    if (value.type === "string") return yield* Effect.fail(outcome(value.value))
    return yield* Evaluation.own<A>(runtime, realm, value, Option.some(page))
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
