import { execFileSync } from "node:child_process"
import { describe, expect, it } from "vitest"
import {
  instrumentationTargets,
  profileOptions,
  replaceAnchor,
  verifyCompletion
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
