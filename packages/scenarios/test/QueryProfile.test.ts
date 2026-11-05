import { execFileSync } from "node:child_process"
import { describe, expect, it } from "vitest"
import {
  instrumentationTargets,
  pipeFrames,
  profileOptions,
  replaceAnchor,
  verifyCompletion,
  verifyPipeWrites
} from "../benchmark/query-profile-config.ts"

const installed = new Set<string>(instrumentationTargets)

describe("query profile arguments", () => {
  it("keeps defaults and accepts every supported mode with positive integer counts", () => {
    expect(profileOptions(["report.json"]).runs).toBe(20)
    for (
      const mode of [
        "plain",
        "instrumented",
        "trace",
        "boundary",
        "boundary-trace",
        "evaluation",
        "evaluation-instrumented"
      ]
    ) {
      expect(profileOptions(["report.json", mode, "1"], installed)).toMatchObject({ mode, runs: 1 })
    }
    expect(profileOptions(["report.json", "trace"], installed)).toMatchObject({ runs: 3, warmups: 1 })
  })

  it("rejects unknown modes instead of silently choosing a workload", () => {
    for (const mode of ["typo", "boundary-typo", "typo-trace", ""]) {
      expect(() => profileOptions(["report.json", mode], installed)).toThrow("mode")
    }
  })

  it("rejects invalid counts instead of completing with no samples", () => {
    for (const count of ["0", "-1", "1.5", "NaN", "Infinity", "", "9007199254740992"]) {
      expect(() => profileOptions(["report.json", "plain", count])).toThrow("positive integer")
    }
  })

  it("rejects missing output and unexpected positional arguments", () => {
    expect(() => profileOptions([])).toThrow("output")
    expect(() => profileOptions(["report.json", "plain", "1", "extra"])).toThrow("arguments")
  })

  it("recognizes real loader transformations without launching a browser", () => {
    const probe = `
      await import("../browser/src/internal/cdpAdapter.ts");
      await import("../browser/src/internal/evaluation.ts");
      await import("../browser/src/protocol/Transport.ts");
      await import("playwright-core");
      await import("@effect/platform-node/NodeServices");
      const { profileOptions } = await import("./benchmark/query-profile-config.ts");
      const installed = Reflect.get(globalThis, Symbol.for("strider.queryProfile.instrumentation"));
      process.stdout.write(profileOptions(["unused.json", "instrumented", "1"], installed).mode);
    `
    const value = execFileSync(process.execPath, [
      "--import",
      "./benchmark/query-profile-loader.mjs",
      "--input-type=module",
      "-e",
      probe
    ], { cwd: new URL("../", import.meta.url), encoding: "utf8", timeout: 20_000 })
    expect(value).toBe("instrumented")
  })

  it("requires every instrumentation target for instrumented modes", () => {
    for (const mode of ["instrumented", "trace", "boundary-trace", "evaluation-instrumented"]) {
      expect(() => profileOptions(["report.json", mode])).toThrow("instrumentation")
      for (const missing of instrumentationTargets) {
        expect(() =>
          profileOptions(["report.json", mode], new Set(instrumentationTargets.filter((x) => x !== missing)))
        )
          .toThrow("instrumentation")
      }
    }
    for (const mode of ["plain", "boundary"]) expect(() => profileOptions(["report.json", mode])).not.toThrow()
  })
})

describe("query profile completion", () => {
  const sample = (library: string, names: ReadonlyArray<string>) => ({
    library,
    capture: {
      wire: [
        { direction: "send" as const, at: 0, text: "{}" },
        { direction: "receive" as const, at: 1, text: "{}" }
      ],
      spans: names.map((name) => ({ name, start: 0, end: 1 }))
    }
  })
  it("rejects incomplete collections in ordinary modes too", () => {
    expect(() => verifyCompletion([], 1, false)).toThrow("Incomplete")
    expect(() => verifyCompletion([sample("strider", [])], 1, false)).not.toThrow()
  })
  it("requires actual wire and host stage captures in instrumented modes", () => {
    for (
      const [library, stages] of [
        ["strider", ["JSON.parse", "toRemoteValue", "fromRemote"]],
        ["playwright", ["pw.JSON.parse", "pw.fromRemote"]]
      ] as const
    ) {
      const valid = sample(library, stages)
      expect(() => verifyCompletion([valid], 1, true)).not.toThrow()
      expect(() => verifyCompletion([{ ...valid, capture: { ...valid.capture, wire: [] } }], 1, true))
        .toThrow("wire capture")
      for (const direction of ["send", "receive"]) {
        expect(() =>
          verifyCompletion(
            [{
              ...valid,
              capture: { ...valid.capture, wire: valid.capture.wire.filter((row) => row.direction !== direction) }
            }],
            1,
            true
          )
        ).toThrow("wire capture")
      }
      for (const missing of stages) {
        expect(() => verifyCompletion([sample(library, stages.filter((name) => name !== missing))], 1, true))
          .toThrow("stage")
      }
    }
  })
})

describe("checked pipe anchors", () => {
  it("rejects missing or repeated anchors and replaces exactly one", () => {
    expect(replaceAnchor("before SEND after", "SEND", "HOOK")).toBe("before HOOK after")
    expect(() => replaceAnchor("before after", "SEND", "HOOK")).toThrow("anchor")
    expect(() => replaceAnchor("SEND SEND", "SEND", "HOOK")).toThrow("anchor")
  })
})

describe("pipe write attribution", () => {
  const a = { id: 7, sessionId: "a", method: "Runtime.callFunctionOn", params: { value: "café" } }
  const b = { id: 7, sessionId: "b", method: "Runtime.callFunctionOn" }
  const capture = () => ({
    enqueues: [{ at: 1, text: JSON.stringify(a) }, { at: 1, text: JSON.stringify(b) }],
    writes: [{ at: 2, data: Buffer.from(JSON.stringify(a) + "\0" + JSON.stringify(b) + "\0") }],
    wire: [
      { direction: "send" as const, at: 0, text: JSON.stringify(a) },
      { direction: "send" as const, at: 0, text: JSON.stringify(b) },
      { direction: "receive" as const, at: 3, text: JSON.stringify({ id: 7, sessionId: "a", result: {} }) },
      { direction: "receive" as const, at: 3, text: JSON.stringify({ id: 7, sessionId: "b", result: {} }) }
    ]
  })
  it("correlates batched frames by command and session and preserves fragmented UTF-8", () => {
    expect(() => verifyPipeWrites(capture())).not.toThrow()
    const bytes = Buffer.from(JSON.stringify(a) + "\0")
    const split = bytes.indexOf(Buffer.from("é")) + 1
    const frames = pipeFrames([{ at: 2, data: bytes.subarray(0, split) }, { at: 3, data: bytes.subarray(split, -1) }, {
      at: 4,
      data: "\0"
    }])
    expect(frames).toEqual([{ message: a, firstWrite: 2, lastWrite: 4, writeIndices: [0, 1, 2] }])
  })
  it("rejects missing, duplicate, wrong-session and mismatched writes", () => {
    const valid = capture()
    expect(() => verifyPipeWrites({ ...valid, enqueues: [] })).toThrow("enqueue")
    expect(() => verifyPipeWrites({ ...valid, enqueues: [] }, false)).not.toThrow()
    expect(() => verifyPipeWrites({ ...valid, writes: [] })).toThrow("writes")
    expect(() => verifyPipeWrites({ ...valid, writes: [...valid.writes, ...valid.writes] })).toThrow("writes")
    expect(() =>
      verifyPipeWrites({ ...valid, writes: [{ at: 2, data: JSON.stringify(a) + "\0" + JSON.stringify(a) + "\0" }] })
    ).toThrow("duplicate")
    expect(() =>
      verifyPipeWrites({
        ...valid,
        writes: [{ at: 2, data: JSON.stringify({ ...a, method: "other" }) + "\0" + JSON.stringify(b) + "\0" }]
      })
    ).toThrow("payload")
    expect(() => pipeFrames([{ at: 2, data: JSON.stringify(a) }])).toThrow("Incomplete")
    expect(() => verifyPipeWrites({ ...valid, wire: valid.wire.filter((row) => row.direction === "send") })).toThrow(
      "reply"
    )
    expect(() => verifyPipeWrites({ ...valid, wire: [...valid.wire, valid.wire[2]!] })).toThrow("reply")
  })
  it("rejects write-before-enqueue and write-after-reply observations", () => {
    const valid = capture()
    expect(() => verifyPipeWrites({ ...valid, writes: [{ ...valid.writes[0]!, at: 0.5 }] })).toThrow("enqueue")
    expect(() => verifyPipeWrites({ ...valid, writes: [{ ...valid.writes[0]!, at: 4 }] })).toThrow("ordering")
  })
  it("observes the real NodeSink Writable.write invocation, preserving bytes and backpressure", () => {
    const probe = `
      import { Writable } from "node:stream";
      import * as Effect from "effect/Effect";
      import * as Stream from "effect/Stream";
      import * as NodeSink from "@effect/platform-node/NodeSink";
      import * as hooks from "./benchmark/query-hooks.ts";
      const input = new Uint8Array([123, 125, 0]);
      const capture = { start: 0, spans: [], wire: [], chunks: [], writes: [], enqueues: [] };
      let count = 0;
      const sink = new Writable({ highWaterMark: 1, write(bytes, encoding, callback) {
        if (capture.writes.length !== 1 || capture.writes[0].data !== input) throw new Error("Write observer absent or bytes changed");
        count++; queueMicrotask(callback);
      }});
      hooks.registerPipe(sink);
      hooks.state.active = capture;
      await Effect.runPromise(Stream.run(Stream.fromIterable([input]), NodeSink.fromWritable({ evaluate: () => sink, onError: e => e })));
      hooks.state.active = undefined;
      if (count !== 1 || capture.writes.length !== 1) throw new Error("Unexpected writes");
      process.stdout.write("observed");
    `
    expect(
      execFileSync(process.execPath, [
        "--import",
        "./benchmark/query-profile-loader.mjs",
        "--input-type=module",
        "-e",
        probe
      ], {
        cwd: new URL("../", import.meta.url),
        encoding: "utf8",
        timeout: 20_000
      })
    ).toBe("observed")
  })
})
