/**
 * Elements a caller adds to a document, such as a script tag, appended from the document's main world and
 * settled by the element's own events. Nothing is installed before the call, and nothing is left after it.
 *
 * - **A resource from a URL** settles on the element's `load` or `error`. An enforced `securitypolicyviolation`
 *   whose `blockedURI` is exactly the resolved URL, stripped as CSP strips a URL it reports (no fragment, username,
 *   or password), tells a refusal by the page's policy apart from a load failure; every backend dispatches it
 *   before the `error` event.
 * - **Inline JavaScript** runs, when the policy allows it, inside the append, and its text is the caller's. The
 *   policy decides during the append too, but every engine dispatches the element's `securitypolicyviolation`
 *   later, as a task, so the call needs a signal the engine orders before a second call reads the element's
 *   violation:
 *   - Chromium and WebKit write the refusal to the console as they decide it, so it is among the events sent
 *     before the append's reply, which an operation handles before it returns. The entries are collected only
 *     for the call. Chromium's entry suggests the refused text's SHA-256, which ties it to this element (not the
 *     hashes its quoted policy allows); WebKit's names no script and carries no stack, only the document's URL at
 *     line 0, so an inline refusal that something else causes during the call, such as a script this one adds,
 *     is taken as this element's, and the call waits for this element's violation until its deadline.
 *   - Firefox dispatches the event in a runnable on the main thread, queued during the append
 *     (`nsCSPContext::AsyncReportViolation`), and the next command reaches the content process as a later
 *     message on the same thread, so the second call runs after the event.
 * - **An inline stylesheet** settles on its `load` or `error`, or on an enforced `securitypolicyviolation` whose target
 *   is the element: the policy refuses it in the append, and the violation comes as a task, before the `error` that
 *   Chromium and WebKit fire after it; Firefox fires no `error` after it, so the violation settles the call there.
 * - **A module** is accepted or refused in the append as a classic script is, and the call returns then: without
 *   changing its text nothing tells when it has run, since it has no `load` event and top-level `await` can hold
 *   it.
 * - **Where** is the document's `<head>`, or its root element when it has none. A document the browser has committed
 *   before its parser made a root element, as one `goto` returns into while the response's body is still coming,
 *   has neither: the element waits, in the page, for the parser to add the root, since an element appended to the
 *   Document node would become its root and leave the parser no `<html>` or `<body>` to build. The operation's
 *   deadline bounds the wait.
 * - **The outcome** is the element, or a string naming a failure: a primitive, so it leaves no remote object.
 * - **Report-only policies** dispatch violations too, with the disposition `report`; they refuse nothing.
 */
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Option from "effect/Option"
import * as Scope from "effect/Scope"
import type * as Deadline from "../Deadline.ts"
import type * as JSHandle from "../JSHandle.ts"
import * as Reason from "../Reason.ts"
import type * as ScriptTag from "../ScriptTag.ts"
import type * as StyleTag from "../StyleTag.ts"
import type * as Target from "../Target.ts"
import type * as Adapter from "./adapter.ts"
import * as Evaluation from "./evaluation.ts"
import * as Events from "./events.ts"
import * as FunctionSource from "./functionSource.ts"
import type * as Model from "./model.ts"
import * as Operation from "./operation.ts"
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
  /** The attribute the URL is set as: a script's `src`, a stylesheet link's `href`. */
  readonly urlAttribute: "src" | "href"
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
  if ("url" in source) {
    return { tag: "script", attributes, url: source.url, urlAttribute: "src", text: null, settles } satisfies Spec
  }
  const text = "source" in source ? source.source : yield* Effect.map(
    readPath(runtime, source.path),
    ({ path, text }) => `${text}\n//# sourceURL=${path.replace(/\n/g, "")}`
  )
  return { tag: "script", attributes, url: null, urlAttribute: "src", text, settles } satisfies Spec
})

/**
 * A stylesheet's spec: a `<link rel="stylesheet">` for a URL, otherwise a `<style>`; a path is read now and named
 * by a `sourceURL` comment.
 */
export const style = Effect.fnUntraced(function*(runtime: Runtime.Runtime, source: StyleTag.Source) {
  if ("url" in source) {
    return {
      tag: "link",
      attributes: [["rel", "stylesheet"]],
      url: source.url,
      urlAttribute: "href",
      text: null,
      settles: true
    } satisfies Spec
  }
  const text = "source" in source ? source.source : yield* Effect.map(
    readPath(runtime, source.path),
    ({ path, text }) => `${text}\n/*# sourceURL=${path.replace(/\n/g, "").replaceAll("*/", "*%2F")} */`
  )
  return { tag: "style", attributes: [], url: null, urlAttribute: "href", text, settles: true } satisfies Spec
})

/**
 * Runs in the document's main world: appends an element from a URL, an inline stylesheet, or one the browser doesn't
 * run, and settles.
 */
function insertElement(spec: Spec): Promise<Element | string> {
  return new Promise((resolve) => {
    const element = document.createElement(spec.tag)
    for (const [name, value] of spec.attributes) element.setAttribute(name, value)
    const href = spec.url === null ? null : new URL(spec.url, document.baseURI).href
    // The URL as a violation reports it: CSP strips the fragment, the username, and the password
    let reported: string | null = null
    if (href !== null) {
      const stripped = new URL(href)
      stripped.hash = ""
      stripped.username = ""
      stripped.password = ""
      reported = stripped.href
    }
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
    if (spec.settles) {
      listen(document, "securitypolicyviolation", (event) => {
        const violation = event as SecurityPolicyViolationEvent
        if (violation.disposition === "report") return
        // A URL's violation is dispatched at the document and names it; an inline element's is dispatched at it
        if (href === null ? violation.target !== element : violation.blockedURI !== reported) return
        refusal = JSON.stringify({
          _tag: "Refused",
          directive: violation.effectiveDirective || violation.violatedDirective,
          blocked: violation.blockedURI
        })
        // Firefox fires no error after refusing an inline stylesheet
        if (href === null) settle(refusal)
      })
      listen(element, "load", () => settle(element))
      listen(element, "error", () => settle(refusal ?? JSON.stringify({ _tag: "Failed", url: href ?? "" })))
    }
    if (spec.url !== null) element.setAttribute(spec.urlAttribute, spec.url)
    if (spec.text !== null) element.textContent = spec.text
    const append = (parent: Element) => {
      parent.append(element)
      if (!spec.settles) settle(element)
    }
    const parent = document.head ?? document.documentElement
    if (parent !== null) return append(parent)
    // Committed before the parser made a root element: the element waits for it rather than becoming the root
    const observer = new MutationObserver(() => {
      const parent = document.head ?? document.documentElement
      if (parent === null) return
      observer.disconnect()
      append(parent)
    })
    observer.observe(document, { childList: true })
  })
}

/** What an inline element's two calls share. */
interface Inline {
  readonly element: Element
  seen: string | null
  readonly refusal: Promise<string>
  readonly stop: () => void
}

/**
 * Runs in the document's main world: appends inline JavaScript, which runs in the append if the policy allows it,
 * once the document has a root element.
 */
async function appendInline(spec: Spec): Promise<Inline> {
  // Committed before the parser made a root element: the element waits for it rather than becoming the root
  const parent = document.head ?? document.documentElement ?? await new Promise<Element>((resolve) => {
    const observer = new MutationObserver(() => {
      const parent = document.head ?? document.documentElement
      if (parent === null) return
      observer.disconnect()
      resolve(parent)
    })
    observer.observe(document, { childList: true })
  })
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
  parent.append(element)
  return state
}

/** Runs in the document's main world: removes the listener of a wait that ended without settling. */
function stopInline(this: void, state: Inline) {
  state.stop()
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
        hint:
          "The element's error event fired: unreachable, an error status, or not a script or stylesheet; it stays in the document"
      })
  }
}

/** The base64 SHA-256 of a script's text, as CSP hashes it. */
const sha256 = (text: string) =>
  Effect.promise(() => globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))).pipe(
    Effect.map((digest) => btoa(String.fromCharCode(...new Uint8Array(digest))))
  )

/**
 * The SHA-256 Chromium names for the inline script it refused, from its console entry: the hash it suggests in
 * "Either the 'unsafe-inline' keyword, a hash ('sha256-…'), or a nonce", not one the quoted policy allows. A
 * report-only policy's entries begin `[Report Only]` and refuse nothing.
 */
export const chromiumRefusal = (text: string): string | undefined =>
  text.startsWith("[Report Only]") || !text.startsWith("Executing inline script violates")
    ? undefined
    : /Either the 'unsafe-inline' keyword, a hash \('sha256-([A-Za-z0-9+/]+=*)'\)/.exec(text)?.[1]

/**
 * Whether a console entry is WebKit's refusal of an inline script. It names no script, and its location is the
 * document's start, so it can't say which inline script was refused.
 */
export const webKitRefusal = (text: string): boolean =>
  text.startsWith(
    "Refused to execute a script because its hash, its nonce, or 'unsafe-inline' does not appear in the script-src directive"
  )

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
    if (spec.tag !== "script" || spec.url !== null || !spec.settles) {
      return yield* settled(yield* call(insertElement, [spec], true))
    }
    const protocol = runtime.model.adapter.info.protocol
    const matches = protocol === "bidi"
      ? undefined
      : protocol === "cdp"
      ? Effect.map(sha256(spec.text ?? ""), (hash) => (text: string) => chromiumRefusal(text) === hash)
      : Effect.succeed(webKitRefusal)
    const caller = yield* Effect.scope
    // The console collection and the shared state live for the call; the element belongs to the caller's scope
    return yield* Effect.scoped(Effect.gen(function*() {
      const refused = matches === undefined ? undefined : yield* matches
      // Taken before the append, so every entry the browser sent before answering it is read
      const entries = refused === undefined
        ? undefined
        : yield* Events.collect(
          page.events.console,
          (entry) => entry.value.level === "error" && refused(entry.value.text)
        )
      const state = yield* Effect.flatMap(
        call(appendInline, [spec], true),
        (value) => Evaluation.own<unknown>(runtime, realm, value, Option.none())
      )
      // The first read returns what the collection holds, overflow or not: only a page that ended fails it
      const reported = entries === undefined ? false : (yield* entries.pipe(
        Effect.catch((error) =>
          error._tag === "TargetGone" ? Effect.fail<Failure>({ _tag: "Gone", error }) : Effect.die(error)
        )
      )).length > 0
      const value = yield* call(settleInline, [state, reported], false).pipe(
        Scope.provide(caller),
        Effect.onExit((exit) => Exit.isSuccess(exit) ? Effect.void : stop(runtime, realm, state))
      )
      return yield* settled(value).pipe(Scope.provide(caller))
    }))
  })

/** Removes an inline element's listener when its wait ended without settling, as by a deadline. */
const stop = (runtime: Runtime.Runtime, realm: Target.RealmId, state: JSHandle.JSHandle<unknown>) =>
  Operation.detached(
    Effect.flatMap(Evaluation.toLocal([state], realm), (values) =>
      runtime.model.adapter.evaluate(realm, {
        functionDeclaration: FunctionSource.declaration(stopInline),
        arguments: values,
        awaitPromise: false,
        result: "value",
        userActivation: false
      }))
  ).pipe(Effect.ignore)

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
