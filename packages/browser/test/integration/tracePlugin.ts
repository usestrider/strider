/** Test-only source instrumentation shared by Vitest and the Node preload. No shipped source is changed. */
import * as path from "node:path"
import type { Plugin } from "vitest/config"

export const instrument = (source: string, id: string) => {
  const file = id.split("?")[0]!
  const transport = file.endsWith("/src/protocol/Transport.ts")
  const inspector = file.endsWith("/src/internal/webkitInspectorSocket.ts")
  const trace = file.endsWith("/src/internal/trace.ts")
  const engine = file.endsWith("/src/internal/engine.ts")
  const runtime = file.endsWith("/src/internal/runtime.ts")
  const operation = file.endsWith("/src/internal/operation.ts")
  const bidiInput = file.endsWith("/src/internal/bidiAdapter/input.ts")
  if (!transport && !inspector && !trace && !engine && !runtime && !operation && !bidiInput) return
  const replace = (from: string, to: string, count: number) => {
    if (source.split(from).length - 1 !== count) {
      throw new Error(`Failure trace instrumentation no longer matches ${file}: ${from}`)
    }
    source = source.replaceAll(from, to)
  }
  const helper = path.join(import.meta.dirname, "failureTrace.ts")
  source = `import { connection as __failureConnection } from ${JSON.stringify(helper)};${
    runtime || bidiInput
      ? `import { watch as __pageCallWatch } from ${
        JSON.stringify(path.join(import.meta.dirname, "pageCallProbe.ts"))
      };`
      : ""
  }${
    transport
      ? `import { viewportTap as __viewportTap } from ${
        JSON.stringify(path.join(import.meta.dirname, "viewportProbe.ts"))
      };import { pointerTap as __pointerTap } from ${
        JSON.stringify(path.join(import.meta.dirname, "pointerRecipients.ts"))
      };`
      : ""
  }${source}`
  if (engine) {
    replace(
      "const request = JSON.parse(text) as Request",
      "const request = JSON.parse(text) as Request; (request as any).__rendering ??= { events: [], omitted: 0 }",
      1
    )
    replace("const nextFrame = (timeout: number)", "const nextFrame = (timeout: number, __rendering: any)", 1)
    replace(
      "const timer = setTimer(() => resume(false), Math.max(0, timeout))",
      [
        "const observation = { clock: \"page-performance-ms\", start: now(), cap: timeout, visibility: document.visibilityState ?? null, winner: null as string | null, timer: null as number | null, callback: null as number | null, endVisibility: null as string | null };",
        "if (__rendering.events.length < 32) __rendering.events.push(observation); else __rendering.omitted++;",
        "const timer = setTimer(() => { observation.timer = now(); if (observation.winner === null) { observation.winner = \"timer\"; observation.endVisibility = document.visibilityState ?? null }; resume(false) }, Math.max(0, timeout))"
      ].join(" "),
      1
    )
    replace(
      "onFrame(() => {\n        clearTimer(timer)",
      "onFrame(() => { observation.callback = now(); if (observation.winner === null) { observation.winner = \"callback\"; observation.endVisibility = document.visibilityState ?? null };\n        clearTimer(timer)",
      1
    )
    replace("await nextFrame(left)", "await nextFrame(left, (request as any).__rendering)", 1)
    replace(
      "return JSON.stringify(await act(request))",
      "return JSON.stringify({ ...await act(request), __rendering: (request as any).__rendering })",
      1
    )
    // Page-side timing of every engine call, on the page's epoch clock: `run` carries its own in its reply; `install`
    // and `element`, whose results can't carry it, leave theirs in the realm for the next `run` reply to take. Only a
    // request the runtime sent, which carries its round, gets it: a test's own call into the engine sees its reply
    // as is.
    const pageClock = "performance.timeOrigin + performance.now()"
    const stash = (entry: string) =>
      `{ const __k = Symbol.for("strider.trace.pageCalls"); if (globalThis[__k] === undefined) Object.defineProperty(globalThis, __k, { value: { calls: [], omitted: 0 } }); const __s = globalThis[__k]; if (__s.calls.length < 64) __s.calls.push(${entry}); else __s.omitted++; }`
    replace(
      "const run = async (text: string): Promise<string> => {",
      [
        `const run = async (text: string): Promise<string> => { const start = ${pageClock}; const reply = await __untimedRun(text); const end = ${pageClock}; if (!text.includes('"__rendering":{"round":')) return reply;`,
        "const store = (globalThis as any)[Symbol.for(\"strider.trace.pageCalls\")]; const earlier = store === undefined ? [] : store.calls.splice(0); const earlierOmitted = store === undefined ? 0 : store.omitted; if (store !== undefined) store.omitted = 0;",
        "return reply.length > 2 && reply.startsWith(\"{\") && reply.endsWith(\"}\") ? reply.slice(0, -1) + ',\"__page\":' + JSON.stringify({ clock: \"page-epoch-ms\", start, end, earlier, earlierOmitted }) + \"}\" : reply };",
        "const __untimedRun = async (text: string): Promise<string> => {"
      ].join(" "),
      1
    )
    replace(
      "export const install = `function() {",
      `export const install = \`function() { const __start = ${pageClock};`,
      1
    )
    replace(
      "  return \"installed\";",
      `  ${stash(`{ call: "install", start: __start, end: ${pageClock} }`)} return "installed";`,
      1
    )
    replace(
      ": engine.element(request);",
      `: (() => { const __start = ${pageClock}; const __result = engine.element(request); let __round = null; try { __round = JSON.parse(request).__rendering?.round ?? null } catch {} ${
        stash(`{ call: "element", round: __round, start: __start, end: ${pageClock} }`)
      } return __result })();`,
      1
    )
  }
  if (runtime) {
    source = "let __roundSequence = 0;" + source
    replace(
      "call(runtime, realm, functionDeclaration, [string(encoded)], releaseResult)",
      [
        "(() => { const __trace = __failureConnection(\"engine-round\"); const parsed = JSON.parse(encoded);",
        "const metadata = { round: ++__roundSequence, operationId: id, document, realm, call: functionDeclaration === Engine.element ? \"element\" : functionDeclaration === Engine.run ? \"run\" : \"other\", op: parsed.op, cap: parsed.cap ?? null };",
        "__trace(\"engine-round-start\", { ...metadata, hostEpochMs: Date.now() });",
        "const __stop = __pageCallWatch(runtime.backend, metadata, __trace);",
        "const diagnostic = { ...metadata, events: [], omitted: 0 };",
        "return call(runtime, realm, functionDeclaration, [string(JSON.stringify({ ...parsed, __rendering: diagnostic }))], releaseResult).pipe(Effect.onExit(() => Effect.sync(__stop)), Effect.tap((reply) => Effect.sync(() => {",
        "const hostEpochMs = Date.now(); let rendering = null; let response = null; let page = null; try { const value = JSON.parse((reply as any).value.value); rendering = value.__rendering ?? null; page = value.__page ?? null; response = { tag: value._tag, reason: value.reason ?? null, checked: value.checked ?? null } } catch {}",
        "__trace(\"engine-round-reply\", { ...metadata, hostEpochMs, page, rendering, response }); }))); })()"
      ].join(" "),
      1
    )
  }
  if (bidiInput) {
    // The `contentWindow` read answers with its window and its page-side start and end, on the page's epoch clock.
    replace(
      "  const document = yield* documentOf(state, node.document)\n  const reply = yield* Kit.protocol(state.send(Script.callFunction({\n    functionDeclaration: \"(element) => element.contentWindow\",",
      [
        "  const document = yield* documentOf(state, node.document); const __trace = __failureConnection(\"content-window\"); const __call = { call: \"contentWindow\", document: node.document, context: document.navigable.bidi }; __trace(\"content-window-start\", { ...__call, hostEpochMs: Date.now() }); const __stop = __pageCallWatch(\"firefox\", __call, __trace);",
        "  const reply = yield* Kit.protocol(state.send(Script.callFunction({",
        "    functionDeclaration: \"(element) => { const start = performance.timeOrigin + performance.now(); const window = element.contentWindow; return [window, start, performance.timeOrigin + performance.now()] }\","
      ].join("\n"),
      1
    )
    replace(
      "  const context = reply.type === \"success\" && reply.result.type === \"window\" ? reply.result.value.context : undefined",
      [
        "  __stop(); const __reply = reply as any; const __items = __reply.type === \"success\" && __reply.result.type === \"array\" ? __reply.result.value : undefined;" +
        " const context = __items?.[0]?.type === \"window\" ? __items[0].value.context : undefined;" +
        " __trace(\"content-window-reply\", { ...__call, hostEpochMs: Date.now(), page: { clock: \"page-epoch-ms\", start: __items?.[1]?.value ?? null, end: __items?.[2]?.value ?? null }, window: context ?? null })"
      ].join("\n"),
      1
    )
  }
  if (operation) {
    replace(
      "adopt<T extends Deadline.Timeout>(step: T): T {",
      "adopt<T extends Deadline.Timeout>(step: T): T { (this as any).__deadlineTrace(\"host-timeout-adopt\", { operationId: this.id, stepOperationId: step.diagnostics.operationId, deadline: this.budget.at, phase: step.phase, lastClock: \"host-live-monotonic-ns\", last: step.last, hint: step.hint })",
      1
    )
    replace("return { at: enclosing.value,", "return { __deadlineSource: \"enclosing\", at: enclosing.value,", 1)
    replace("return { at: (start +", "return { __deadlineSource: \"default-budget\", at: (start +", 1)
    replace(
      "this.clock = clock",
      "this.clock = clock; (this as any).__deadlineTrace = __failureConnection(\"host-operation\"); (this as any).__deadlineTrace(\"host-deadline\", { operationId: id, operation: name, budget, source: (budget as any).__deadlineSource ?? null, now: clock.now(), clock: clock === BrowserClock.live ? \"host-live-monotonic-ns\" : \"browser-clock-monotonic-ns\" })",
      1
    )
    replace(
      "const last = Option.fromNullishOr(this.history.at(-1))",
      "const last = Option.fromNullishOr(this.history.at(-1)); (this as any).__deadlineTrace(\"host-timeout\", { operationId: this.id, operation: this.name, deadline: this.budget.at, now: this.clock.now(), phase: phase ?? this.phase(), lastClock: \"host-live-monotonic-ns\", last, hint })",
      1
    )
  }
  if (trace) {
    replace(
      "const videoFailures: Array<VideoFailure> = []",
      "const videoFailures: Array<VideoFailure> = []; const __nativeVideoTrace = __failureConnection(\"native-video\")",
      1
    )
    replace(
      "videoFailures.push(failure)",
      "(__nativeVideoTrace(\"native-video-failure\", videoFailureEvent(failure, \"strict\")), videoFailures.push(failure))",
      1
    )
  }
  if (trace) {
    replace(
      "const pendingEvent = pendingVideoEvent(page, exported)",
      "const pendingEvent = pendingVideoEvent(page, exported); __nativeVideoTrace(\"native-video-pending\", pendingEvent)",
      1
    )
  }
  if (transport || inspector) {
    replace(
      "const link = yield* Link.make",
      `const __trace = __failureConnection(${JSON.stringify(inspector ? "webkit-inspector" : "pipe-or-websocket")});${
        transport ? " const __pointer = __pointerTap(__trace); const __viewport = __viewportTap(__trace);" : ""
      } const link = yield* Link.make`,
      transport ? 2 : 1
    )
    replace(
      "const link = yield* Link.make" + (inspector ? "<Incoming>()" : "()"),
      "const link = yield* Link.make" + (inspector ? "<Incoming>()" : "()") +
        `; const __receive = link.receive; link.receive = (message) => { ${
          transport ? "if (__viewport.receive(message) || __pointer.receive(message)) return; " : ""
        }__trace("receive", message); __receive(message) }; const __lose = link.lose; link.lose = (reason) => { __trace("closed", reason); __lose(reason) }`,
      transport ? 2 : 1
    )
    if (transport) {
      replace(
        "Queue.offerUnsafe(outbox, encoder.encode(message + \"\\0\"))",
        "(__trace(\"send\", message), __pointer.send(message), __viewport.send(message), Queue.offerUnsafe(outbox, encoder.encode(message + \"\\0\")))",
        1
      )
      replace(
        "const outbox = yield* Queue.unbounded<Uint8Array, Cause.Done>()",
        "const outbox = yield* Queue.unbounded<Uint8Array, Cause.Done>(); __viewport.inject = __pointer.inject = (m: string) => { Queue.offerUnsafe(outbox, encoder.encode(m + \"\\0\")) }",
        1
      )
      replace(
        "const sendFailed = (error: Socket.SocketError) =>",
        "__viewport.inject = __pointer.inject = (m: string) => { if (opened.readyState === 1) Effect.runFork(Effect.ignore(writer.write(m))) }; const sendFailed = (error: Socket.SocketError) =>",
        1
      )
      replace(
        "writer.write(message)",
        "(__trace(\"send\", message), __pointer.send(message), __viewport.send(message), writer.write(message))",
        1
      )
    } else replace("writer.write(frame(message))", "(__trace(\"send\", message), writer.write(frame(message)))", 1)
  }
  return { code: source, map: null }
}

export const failureTracePlugin = (): Plugin => ({
  name: "integration-failure-trace",
  enforce: "pre",
  transform: instrument
})
