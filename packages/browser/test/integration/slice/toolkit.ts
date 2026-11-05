/**
 * The agent toolkit on every backend's layer, called as a model calls it: pages by name, refs from the
 * latest snapshot and locator strings, secrets substituted and never echoed, the digest of what happened since
 * the previous call, waits across calls, declared routes and dialog decisions, and failures returned as data.
 */
import { assert, describe, layer } from "@effect/vitest"
import { Browser, Deadline, Snapshot } from "@usestrider/browser"
import { BrowserToolkit, CapturePolicy } from "@usestrider/browser/ai"
import type * as Toolkit from "effect/ai/Toolkit"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import type * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Redacted from "effect/Redacted"
import * as Schema from "effect/Schema"
import * as Stream from "effect/Stream"
import * as Handles from "../../../src/internal/handles.ts"
import * as Runtime from "../../../src/internal/runtime.ts"
import { site } from "../adapter/harness.ts"
import { supports } from "./capabilities.ts"

const timeout = 60_000

// A sign-in form, a console error, a missing resource, a popup, a dialog and a fetch a route can answer
const app = `<title>shop</title>
<label>Email <input id="email"></label>
<label>Password <input id="password" type="password"></label>
<button id="go">Sign in</button>
<p id="out">signed out</p>
<button onclick="window.open('/child')">Open</button>
<button onclick="document.getElementById('asked').textContent = String(confirm('Sure?'))">Ask</button>
<p id="asked">not asked</p>
<button onclick="fetch('/api/status').then((r) => r.text()).then((t) => { document.getElementById('api').textContent = t })">Status</button>
<p id="api">no status</p>
<script>
  document.getElementById("go").onclick = () => {
    const password = document.getElementById("password").value
    document.getElementById("out").textContent = password === "hunter2"
      ? "Welcome " + document.getElementById("email").value
      : "wrong password"
    console.error("signed in, with a warning")
    fetch("/missing")
  }
</script>`

type Tools = Toolkit.WithHandler<BrowserToolkit.Tools>

/** Calls a tool as a model does, and returns its final result: the outcome and digest, or the failure. */
const call = (tools: Tools, name: BrowserToolkit.ToolName, params: Record<string, unknown>) =>
  Effect.flatMap(tools.handle(name, params as never), Stream.runLast).pipe(
    Effect.map((last) => {
      const result = Option.getOrThrow(last)
      return { failed: result.isFailure, value: result.result as any }
    })
  )

export const toolkit = (name: string, backend: Layer.Layer<Browser.Browser, unknown>) =>
  describe(`${name} toolkit`, () => {
    layer(backend, { excludeTestServices: true, timeout })((it) => {
      it.effect(
        "drives a page as a model would: names, refs, secrets, the digest and waits",
        () =>
          Effect.gen(function*() {
            const served = yield* site
            const url = `${served.origin}/fixture?html=${encodeURIComponent(app)}`
            yield* Effect.scoped(Effect.gen(function*() {
              const page = yield* Browser.newPage()
              const tools = yield* BrowserToolkit.make({
                context: page.context,
                secrets: { password: Redacted.make("hunter2") },
                capture: CapturePolicy.local
              })
              // The page opened before the toolkit is named when first listed
              const listed = yield* call(tools, "pages", {})
              assert.deepStrictEqual(listed.value.outcome.map((each: { page: string }) => each.page), ["p1"])
              const opened = yield* call(tools, "newPage", { name: "shop", url })
              assert.strictEqual(opened.value.outcome.page, "shop")
              const snapshot = yield* call(tools, "snapshot", { page: "shop" })
              const ref = /button "Sign in" \[ref=(e\d+)\]/.exec(snapshot.value.outcome)?.[1]
              assert.isDefined(ref, snapshot.value.outcome)
              yield* call(tools, "fill", { page: "shop", target: "label=Email", value: "ada@example.com" })
              const secret = yield* call(tools, "fill", { page: "shop", target: "label=Password", value: "%password%" })
              assert.isFalse(secret.failed)
              assert.notInclude(JSON.stringify(secret.value), "hunter2")
              const clicked = yield* call(tools, "click", { page: "shop", target: ref })
              const welcomed = yield* call(tools, "expect", {
                page: "shop",
                target: "css=#out",
                state: "visible",
                text: "Welcome ada@example.com"
              })
              assert.isFalse(welcomed.failed, JSON.stringify(welcomed.value))
              // What happened since: the console error and the missing resource, reported once
              // The digest has it once the browser reports it: polled here, as a model's next calls would
              const seen = [...clicked.value.sinceLast, ...welcomed.value.sinceLast]
              for (
                let attempt = 0;
                attempt < 50 && !seen.some((line) => line.includes("/missing answered 404"));
                attempt++
              ) {
                yield* Effect.sleep("100 millis")
                seen.push(...(yield* call(tools, "pages", {})).value.sinceLast)
              }
              const sinceLast = seen.join("\n")
              assert.include(sinceLast, "console error on shop: signed in, with a warning")
              assert.include(sinceLast, `/missing answered 404`)
              const again = yield* call(tools, "pages", {})
              assert.notInclude(again.value.sinceLast.join("\n"), "/missing answered 404")
              // A wait across calls, collected later
              const wait = yield* call(tools, "next", { page: "shop", event: "popup", within: "20 seconds" })
              if (yield* supports("popups.opener")) {
                assert.strictEqual(wait.value.outcome.wait, "w1")
                yield* call(tools, "click", { page: "shop", target: `role=button[name="Open"]` })
                const popup = yield* call(tools, "await", { wait: "w1" })
                assert.match(popup.value.outcome, /^popup p\d+, at .* so far$/)
              } else {
                // A backend that can't say which page opened a page refuses the wait, as data (QUIRKS.md, Q212)
                assert.isTrue(wait.failed, JSON.stringify(wait.value))
                assert.include(JSON.stringify(wait.value), "popups.opener")
              }
              // A dialog decided by a declared handler, and a route that answers a fetch
              const handler = yield* call(tools, "dialog", { page: "shop", decision: "dismiss" })
              assert.strictEqual(handler.value.outcome.registration, "r1")
              yield* call(tools, "click", { page: "shop", target: `text="Ask"` })
              yield* call(tools, "expect", { page: "shop", target: "css=#asked", state: "visible", text: "false" })
              yield* call(tools, "route", {
                page: "shop",
                pattern: "**/api/status",
                action: "fulfill",
                body: "all good",
                contentType: "text/plain"
              })
              yield* call(tools, "click", { page: "shop", target: `role=button[name="Status"]` })
              const status = yield* call(tools, "expect", {
                page: "shop",
                target: "css=#api",
                state: "visible",
                text: "all good"
              })
              assert.isFalse(status.failed, JSON.stringify(status.value))
              // Failures are data, with what to do
              const bad = yield* call(tools, "click", { page: "shop", target: "button" })
              assert.isTrue(bad.failed)
              assert.strictEqual(bad.value.error, "InvalidInput")
              const stale = yield* call(tools, "click", { page: "p1", target: ref! })
              assert.isTrue(stale.failed)
              assert.include(stale.value.message, `the ref is from shop's snapshot`)
              const nowhere = yield* call(tools, "goto", { page: "nowhere", url })
              assert.strictEqual(nowhere.value.error, "PageNotFound")
              // A %…% that names no secret, such as a mistyped name, is filled as written
              const typo = yield* call(tools, "fill", { page: "shop", target: "label=Email", value: "%token%" })
              assert.isFalse(typo.failed, JSON.stringify(typo.value))
            }))
          }),
        timeout
      )

      it.effect(
        "finds refs by text, filters history, and takes the browser's own tab with control",
        () =>
          Effect.gen(function*() {
            const served = yield* site
            const url = `${served.origin}/fixture?html=${encodeURIComponent(app)}`
            const browser = yield* Browser.Browser
            yield* Effect.scoped(Effect.gen(function*() {
              const page = yield* Browser.newPage()
              const tools = yield* BrowserToolkit.make({
                context: page.context,
                secrets: {},
                capture: CapturePolicy.local,
                browser
              })
              const opened = yield* call(tools, "newPage", { name: "shop", url })
              assert.strictEqual(opened.value.outcome.page, "shop")
              // find takes a snapshot when there is none, and returns targets
              const found = yield* call(tools, "find", { page: "shop", query: "Sign in", role: "button" })
              assert.isFalse(found.failed, JSON.stringify(found.value))
              assert.strictEqual(found.value.outcome.length, 1)
              assert.match(found.value.outcome[0].ref, /^e\d+$/)
              const clicked = yield* call(tools, "click", { page: "shop", target: found.value.outcome[0].ref })
              assert.isFalse(clicked.failed, JSON.stringify(clicked.value))
              // The click logs a console error and fetches a missing resource: history narrows to them
              yield* call(tools, "expect", {
                page: "shop",
                target: "css=#out",
                state: "visible",
                text: "wrong password"
              })
              let errors: ReadonlyArray<string> = []
              let failed: ReadonlyArray<string> = []
              for (let attempt = 0; attempt < 50 && (errors.length === 0 || failed.length === 0); attempt++) {
                errors =
                  (yield* call(tools, "history", { page: "shop", kind: "console", level: "error" })).value.outcome
                failed = (yield* call(tools, "history", { page: "shop", kind: "network", failed: true })).value.outcome
                if (errors.length === 0 || failed.length === 0) yield* Effect.sleep("100 millis")
              }
              assert.deepStrictEqual(errors, ["console error on shop: signed in, with a warning"])
              assert.isTrue(failed.some((line: string) => /^404 .*\/missing$/.test(line)), failed.join(", "))
              const warnings = yield* call(tools, "history", { page: "shop", kind: "console", level: "warning" })
              assert.deepStrictEqual(warnings.value.outcome, [])
              // The launched browser's own first tab is the browser's, outside the context (QUIRKS.md, Q141)
              const tabs = yield* call(tools, "tabs", {})
              assert.isFalse(tabs.failed, JSON.stringify(tabs.value))
              const tab = tabs.value.outcome.find((each: { tab: string }) => each.tab !== String(page.id))
              assert.isDefined(tab, JSON.stringify(tabs.value.outcome))
              const controlled = yield* call(tools, "control", { tab: tab.tab, name: "own" })
              assert.isFalse(controlled.failed, JSON.stringify(controlled.value))
              assert.strictEqual(controlled.value.outcome.page, "own")
              const went = yield* call(tools, "goto", { page: "own", url })
              assert.isFalse(went.failed, JSON.stringify(went.value))
              const released = yield* call(tools, "release", { page: "own" })
              assert.isFalse(released.failed, JSON.stringify(released.value))
              assert.strictEqual((yield* call(tools, "goto", { page: "own", url })).value.error, "PageNotFound")
              // A page the session opened isn't control's to release
              assert.strictEqual((yield* call(tools, "release", { page: "shop" })).value.error, "InvalidInput")
              // Without the browser, the model can't reach beyond its context
              const bounded = yield* BrowserToolkit.make({
                context: page.context,
                secrets: {},
                capture: CapturePolicy.local
              })
              assert.strictEqual((yield* call(bounded, "tabs", {})).value.error, "NotPermitted")
            }))
          }),
        timeout
      )

      it.effect(
        "reports validation observed during fresh and repeated refused submit clicks",
        () =>
          Effect.gen(function*() {
            const served = yield* site
            yield* Effect.scoped(Effect.gen(function*() {
              const page = yield* Browser.newPage()
              const html = `<form onsubmit="event.preventDefault(); document.body.dataset.submitted='yes'">
<label>Choice <select required><option value="">Choose</option><option>Ready</option></select></label>
<button>Send</button></form>`
              yield* page.goto(`${served.origin}/fixture?html=${encodeURIComponent(html)}`)
              const tools = yield* BrowserToolkit.make({
                context: page.context,
                secrets: {},
                capture: CapturePolicy.local
              })
              const before = yield* call(tools, "snapshot", { page: "p1" })
              assert.include(before.value.outcome, "[invalid]")
              const results = []
              for (const attempt of ["fresh", "repeated"]) {
                const result = yield* call(tools, "click", { page: "p1", target: "role=button[name=\"Send\"]" })
                assert.isFalse(result.failed)
                assert.isUndefined(yield* page.evaluateInMainWorld(() => document.body.dataset.submitted))
                results.push({ attempt, result })
              }
              for (const { attempt, result } of results) {
                assert.include(
                  result.value.sinceLast.join("\n"),
                  "p1 validation observed during click: combobox \"Choice\" validationMessage=",
                  `${attempt} refused submit click must report observed validation even when invalid state is unchanged`
                )
              }
              yield* page.getByRole("combobox").selectOption({ label: "Ready" })
              const success = yield* call(tools, "click", { page: "p1", target: "role=button[name=\"Send\"]" })
              assert.notInclude(success.value.sinceLast.join("\n"), "validation observed")
              assert.strictEqual(yield* page.evaluateInMainWorld(() => document.body.dataset.submitted), "yes")
            }))
          }),
        timeout
      )

      it.effect(
        "isolates click validation observation and applies capture policy",
        () =>
          Effect.gen(function*() {
            const served = yield* site
            yield* Effect.scoped(Effect.gen(function*() {
              const page = yield* Browser.newPage()
              const html = `<input id="field" aria-label="private-label" value="private-value">
<button onclick="field.checkValidity();field.reportValidity()">Check</button><button>Quiet</button>`
              yield* page.goto(`${served.origin}/fixture?html=${encodeURIComponent(html)}`)
              yield* page.evaluateInMainWorld(() => {
                ;(document.getElementById("field") as HTMLInputElement).setCustomValidity("private-message")
              })
              for (const capture of [CapturePolicy.strict, CapturePolicy.local]) {
                const tools = yield* BrowserToolkit.make({ context: page.context, secrets: {}, capture })
                const result = yield* call(tools, "click", { page: "p1", target: "role=button[name=\"Check\"]" })
                const lines = result.value.sinceLast.filter((line: string) => line.includes("validation observed"))
                assert.lengthOf(lines, 1)
                assert.include(lines[0], "validation observed during click: textbox")
                assert.notInclude(lines[0], "blocked")
                assert.strictEqual(
                  lines[0],
                  capture.snapshotText === "redacted"
                    ? "p1 validation observed during click: textbox validationMessage=\"•••\""
                    : "p1 validation observed during click: textbox \"private-label\" validationMessage=\"private-message\""
                )
                if (capture.snapshotText === "redacted") assert.notInclude(lines[0], "private")
                else assert.include(lines[0], "validationMessage=\"private-message\"")
                // An event outside a click must not be retained by a later observer.
                yield* page.evaluateInMainWorld(() =>
                  (document.getElementById("field") as HTMLInputElement).checkValidity()
                )
                const quiet = yield* call(tools, "click", { page: "p1", target: "role=button[name=\"Quiet\"]" })
                assert.notInclude(quiet.value.sinceLast.join("\n"), "validation observed")
              }
            }))
          }),
        timeout
      )

      it.effect(
        "observes existing open shadow roots but excludes closed roots and child frames",
        () =>
          Effect.gen(function*() {
            const served = yield* site
            yield* Effect.scoped(Effect.gen(function*() {
              const page = yield* Browser.newPage()
              const html =
                `<div id="open"></div><div id="closed"></div><iframe srcdoc='<input required aria-label="Frame">'></iframe>
<button onclick="openField.checkValidity();closedField.checkValidity();document.querySelector('iframe').contentDocument.querySelector('input').checkValidity()">Check</button>
<script>
for (const mode of ["open", "closed"]) {
  const root = document.getElementById(mode).attachShadow({ mode })
  root.innerHTML = '<input required aria-label="' + mode + '">'
  window[mode + "Field"] = root.querySelector("input")
}
</script>`
              yield* page.goto(`${served.origin}/fixture?html=${encodeURIComponent(html)}`)
              yield* page.evaluateInMainWorld(async () => {
                const frame = document.querySelector("iframe")!
                if (frame.contentDocument?.querySelector("input") === null) {
                  await new Promise<void>((resolve) => frame.addEventListener("load", () => resolve(), { once: true }))
                }
              })
              const tools = yield* BrowserToolkit.make({
                context: page.context,
                secrets: {},
                capture: CapturePolicy.local
              })
              const result = yield* call(tools, "click", { page: "p1", target: "role=button[name=\"Check\"]" })
              const lines = result.value.sinceLast.filter((line: string) => line.includes("validation observed"))
              assert.lengthOf(lines, 1)
              assert.include(lines[0], "validation observed during click: textbox \"open\"")
              assert.notInclude(lines[0], "closed")
              assert.notInclude(lines[0], "Frame")
            }))
          }),
        timeout
      )

      it.effect(
        "removes click validation listeners on success failure and interruption",
        () =>
          Effect.gen(function*() {
            const served = yield* site
            yield* Effect.scoped(Effect.gen(function*() {
              const page = yield* Browser.newPage()
              yield* page.goto(`${served.origin}/fixture?html=${encodeURIComponent("<button>Quiet</button>")}`)
              const { runtime, entry } = Handles.page(page)
              const document = yield* runtime.model.documentOf(entry.id)
              assert(Option.isSome(document))
              const realm = yield* runtime.model.adapter.realm(document.value, yield* Runtime.engineWorld(runtime))
              const evaluate = (functionDeclaration: string) =>
                runtime.model.adapter.evaluate(realm, {
                  functionDeclaration,
                  arguments: [],
                  awaitPromise: true,
                  result: "value",
                  userActivation: false
                })
              yield* evaluate(`() => {
              globalThis.activeValidationListeners = new Set()
              const add = EventTarget.prototype.addEventListener
              const remove = EventTarget.prototype.removeEventListener
              EventTarget.prototype.addEventListener = function(type, listener, options) {
                if (type === "invalid") globalThis.activeValidationListeners.add(listener)
                return add.call(this, type, listener, options)
              }
              EventTarget.prototype.removeEventListener = function(type, listener, options) {
                if (type === "invalid") globalThis.activeValidationListeners.delete(listener)
                return remove.call(this, type, listener, options)
              }
            }`)
              const active = Effect.gen(function*() {
                const result = yield* evaluate("() => globalThis.activeValidationListeners.size")
                assert(result._tag === "Value" && result.value.type === "number")
                return result.value.value
              })
              const tools = yield* BrowserToolkit.make({
                context: page.context,
                secrets: {},
                capture: CapturePolicy.local
              })
              yield* call(tools, "click", { page: "p1", target: "role=button[name=\"Quiet\"]" })
              assert.strictEqual(yield* active, 0)
              const failed = yield* call(tools, "click", { page: "p1", target: "css=#missing" }).pipe(
                Deadline.within("1 second")
              )
              assert.isTrue(failed.failed)
              assert.strictEqual(yield* active, 0)
              const pending = yield* call(tools, "click", { page: "p1", target: "css=#missing" }).pipe(Effect.forkChild)
              yield* active.pipe(Effect.repeat({ until: (count) => Number(count) > 0 }), Effect.timeout("5 seconds"))
              yield* Fiber.interrupt(pending)
              assert.strictEqual(yield* active, 0)
            }))
          }),
        timeout
      )

      it.effect(
        "keeps a click within its deadline when the page turns busy after the click",
        () =>
          Effect.gen(function*() {
            const served = yield* site
            yield* Effect.scoped(Effect.gen(function*() {
              const page = yield* Browser.newPage()
              const html =
                `<button onclick="setTimeout(() => { const end = Date.now() + 8000; while (Date.now() < end); })">Busy</button>`
              yield* page.goto(`${served.origin}/fixture?html=${encodeURIComponent(html)}`)
              const tools = yield* BrowserToolkit.make({
                context: page.context,
                secrets: {},
                capture: CapturePolicy.local
              })
              const started = Date.now()
              yield* call(tools, "click", { page: "p1", target: "role=button[name=\"Busy\"]" }).pipe(
                Deadline.within("1 second")
              )
              const elapsed = Date.now() - started
              assert.isBelow(elapsed, 4000, "the page's busy loop must not hold the click past its 1 second deadline")
            }))
          }),
        timeout
      )

      it.effect(
        "removes click validation listeners after a click that opens a dialog nothing has decided",
        () =>
          Effect.gen(function*() {
            const served = yield* site
            yield* Effect.scoped(Effect.gen(function*() {
              const page = yield* Browser.newPage()
              const html = `<button onclick="alert('Stop')">Ask</button>`
              yield* page.goto(`${served.origin}/fixture?html=${encodeURIComponent(html)}`)
              const { runtime, entry } = Handles.page(page)
              const document = yield* runtime.model.documentOf(entry.id)
              assert(Option.isSome(document))
              const realm = yield* runtime.model.adapter.realm(document.value, yield* Runtime.engineWorld(runtime))
              const evaluate = (functionDeclaration: string) =>
                runtime.model.adapter.evaluate(realm, {
                  functionDeclaration,
                  arguments: [],
                  awaitPromise: true,
                  result: "value",
                  userActivation: false
                })
              yield* evaluate(`() => {
              globalThis.activeValidationListeners = new Set()
              const add = EventTarget.prototype.addEventListener
              const remove = EventTarget.prototype.removeEventListener
              EventTarget.prototype.addEventListener = function(type, listener, options) {
                if (type === "invalid") globalThis.activeValidationListeners.add(listener)
                return add.call(this, type, listener, options)
              }
              EventTarget.prototype.removeEventListener = function(type, listener, options) {
                if (type === "invalid") globalThis.activeValidationListeners.delete(listener)
                return remove.call(this, type, listener, options)
              }
            }`)
              const tools = yield* BrowserToolkit.make({
                context: page.context,
                secrets: {},
                capture: CapturePolicy.local
              })
              yield* call(tools, "click", { page: "p1", target: "role=button[name=\"Ask\"]" }).pipe(
                Deadline.within("3 seconds")
              )
              yield* call(tools, "dialog", { page: "p1", decision: "dismiss" })
              const result = yield* evaluate("() => globalThis.activeValidationListeners.size").pipe(
                Deadline.within("5 seconds")
              )
              assert(result._tag === "Value" && result.value.type === "number")
              assert.strictEqual(result.value.value, 0, "the observer's listeners outlive the click")
            }))
          }),
        timeout
      )

      it.effect(
        "redacts custom validation messages through the snapshot tool and keeps full capture",
        () =>
          Effect.gen(function*() {
            const served = yield* site
            yield* Effect.scoped(Effect.gen(function*() {
              const page = yield* Browser.newPage()
              const html = "<label>Mail <input id=\"mail\" type=\"email\"></label>"
              yield* page.goto(`${served.origin}/fixture?html=${encodeURIComponent(html)}`)
              const message = "private \"quoted\" ] [ref=fake] \\ trailing\nprivate tail"
              yield* page.getByRole("textbox", { name: "Mail" }).fill("private-value")
              yield* page.evaluateInMainWorld((message) => {
                ;(document.getElementById("mail") as HTMLInputElement).setCustomValidity(message)
              }, message)
              const full = yield* page.snapshot()
              assert.include(full.text, `[validationMessage=${JSON.stringify(message)}]`)
              const nodes: Array<Snapshot.Node> = []
              const visit = (node: Snapshot.Node) => {
                nodes.push(node)
                node.children.forEach(visit)
              }
              visit(full.root)
              const field = nodes.find((node) => node.role.role === "textbox")!
              assert.isTrue(field.states.has("invalid"))
              assert.deepEqual(field.validationMessage, Option.some(message))
              const encoded = yield* Schema.encodeEffect(Schema.fromJsonString(Schema.toCodecJson(Snapshot.Node)))(
                full.root
              )
              assert.deepEqual(
                yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.toCodecJson(Snapshot.Node)))(encoded),
                full.root
              )
              for (const capture of [CapturePolicy.strict, CapturePolicy.local]) {
                const tools = yield* BrowserToolkit.make({ context: page.context, secrets: {}, capture })
                const result = yield* call(tools, "snapshot", { page: "p1" })
                assert.isFalse(result.failed)
                const text = result.value.outcome as string
                assert.include(text, "[invalid]")
                assert.include(text, "[ref=e1]")
                if (capture.snapshotText === "redacted") {
                  assert.include(text, "[validationMessage=\"•••\"]")
                  assert.notInclude(text, "private")
                  assert.notInclude(text, "ref=fake")
                } else {
                  assert.include(text, `[validationMessage=${JSON.stringify(message)}]`)
                }
              }
            }))
          }),
        timeout
      )

      it.effect("sends what the capture policy allows", () =>
        Effect.gen(function*() {
          const served = yield* site
          const url = `${served.origin}/fixture?html=${encodeURIComponent(app)}`
          yield* Effect.scoped(Effect.gen(function*() {
            const page = yield* Browser.newPage()
            yield* page.goto(url)
            yield* page.getByRole("button", { name: "Sign in" }).click()
            const strict = yield* BrowserToolkit.make({
              context: page.context,
              secrets: {},
              capture: CapturePolicy.strict
            })
            const screenshot = yield* call(strict, "screenshot", { page: "p1" })
            assert.isTrue(screenshot.failed)
            assert.strictEqual(screenshot.value.error, "NotPermitted")
            const history = yield* call(strict, "history", { page: "p1", kind: "console" })
            assert.deepStrictEqual(history.value.outcome, ["console error (text not sent)"])
            const local = yield* BrowserToolkit.make({
              context: page.context,
              secrets: {},
              capture: CapturePolicy.local
            })
            const shot = yield* call(local, "screenshot", { page: "p1" })
            assert.strictEqual(shot.value.outcome.mediaType, "image/png")
            assert.isAbove(shot.value.outcome.data.length, 100)
          }))
        }), timeout)
    })
  })
