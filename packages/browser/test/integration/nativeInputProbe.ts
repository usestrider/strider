/** Temporary diagnostic capture: all protocol commands use the adapter's existing pipe session. */
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Option from "effect/Option"
import * as Stream from "effect/Stream"
import * as fs from "node:fs"
import * as IO from "../../src/cdp/IO.ts"
import * as Tracing from "../../src/cdp/Tracing.ts"
import type * as ProtocolClient from "../../src/internal/protocolClient.ts"
import * as Protocol from "../../src/protocol/Protocol.ts"

const directory = "/home/jpowers/.local/share/clutch/artifacts/ROOK-212/slice-capture"
export const beginNative = Effect.fnUntraced(function*(label: string) {
  const session =
    (globalThis as typeof globalThis & { __inputProbeSession: ProtocolClient.Session }).__inputProbeSession
  if (session === undefined) throw new Error("Missing adapter CDP session")
  const complete = yield* session.subscribe(Tracing.tracingComplete)
  const done = yield* Stream.runHead(complete).pipe(Effect.forkChild)
  yield* Tracing.start({
    transferMode: "ReturnAsStream",
    streamFormat: "json",
    streamCompression: "none",
    traceConfig: {
      recordMode: "recordUntilFull",
      enableArgumentFilter: false,
      traceBufferSizeInKb: 65536,
      includedCategories: [
        "*",
        "disabled-by-default-input",
        "disabled-by-default-devtools.timeline.inputs",
        "disabled-by-default-viz.hit_testing_flow",
        "disabled-by-default-viz.hit_testing",
        "disabled-by-default-cc.debug",
        "disabled-by-default-latencyInfo"
      ]
    }
  }).pipe(Protocol.on(session))
  return Effect.gen(function*() {
    ;(globalThis as typeof globalThis & { __inputProbeSnapshot: (label: string) => void }).__inputProbeSnapshot(label)
    yield* Tracing.end().pipe(Protocol.on(session))
    const event = yield* Fiber.join(done)
    if (Option.isNone(event) || event.value.stream === undefined) throw new Error("Missing native trace stream")
    const handle = event.value.stream
    const chunks: Array<Buffer> = []
    while (true) {
      const chunk = yield* IO.read({ handle, size: 1024 * 1024 }).pipe(Protocol.on(session))
      chunks.push(Buffer.from(chunk.data, chunk.base64Encoded ? "base64" : "utf8"))
      if (chunk.eof) break
    }
    yield* IO.close({ handle }).pipe(Protocol.on(session))
    const text = Buffer.concat(chunks).toString("utf8")
    const parsed = JSON.parse(text)
    if (!Array.isArray(parsed.traceEvents)) throw new Error("Missing native events")
    fs.writeFileSync(`${directory}/${label}.json`, text)
    fs.writeFileSync(
      `${directory}/${label}-complete.json`,
      JSON.stringify({ ...event.value, events: parsed.traceEvents.length })
    )
    console.log("NATIVE_COMPLETE", label, parsed.traceEvents.length, event.value.dataLossOccurred)
  })
})

export const recipientProbe = (label: string) =>
  `<script>(()=>{
const out=document.createElement('pre');out.id='recipient-probe';out.style.display='none';document.documentElement.append(out);
const record=value=>{out.textContent+=JSON.stringify(value)+'\\n';performance.mark('recipient-probe:'+JSON.stringify(value));};
record({label:${JSON.stringify(label)},kind:'installed',time:performance.timeOrigin,ready:document.readyState});
for(const type of ['pointerover','pointermove','pointerdown','mousedown','pointerup','mouseup','click'])
window.addEventListener(type,e=>record({label:${
    JSON.stringify(label)
  },type,trusted:e.isTrusted,target:e.target.id||e.target.nodeName,x:e.clientX,y:e.clientY,time:e.timeStamp,path:e.composedPath().map(n=>n.id||n.nodeName||'window')}),true);
})()</script>`

export const saveRecipients = (label: string, value: unknown) => {
  fs.writeFileSync(`${directory}/${label}-recipients.json`, JSON.stringify(value, null, 2), { flag: "wx" })
  console.log("RECIPIENTS", label, JSON.stringify(value))
}
