/**
 * The drift test (PROTOCOL.md, Drift test), without a browser: traffic recorded from each supported browser
 * (`test/fixtures/traffic/`, recorded by `test/integration/record.ts`) must decode through the generated codecs,
 * and every recorded error reply must classify as it did when it was recorded. A regeneration that drops or
 * tightens a member a browser sends, or a table edit that reclassifies a reply, fails here; a browser that
 * changes what it sends fails the integration tests, and is recorded again.
 *
 * A method with no generated definition fails, unless the coverage report says it was excluded by policy:
 * Chromium 155 still sends deprecated events nothing subscribes to, which are never decoded. Stock WebKit's
 * fixture holds two protocols' traffic, its pages' inspector and its Automation target's, each
 * decoded through its own.
 */
import { assert, describe, it } from "@effect/vitest"
import * as Bidi from "@usestrider/browser/bidi-protocol"
import * as Cdp from "@usestrider/browser/cdp"
import * as WebKitAutomation from "@usestrider/browser/webkit-automation-protocol"
import * as WebKitStock from "@usestrider/browser/webkit-stock-protocol"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import * as fs from "node:fs"
import * as BidiWire from "../src/internal/bidiWire.ts"
import * as CdpWire from "../src/internal/cdpWire.ts"
import * as ProtocolClient from "../src/internal/protocolClient.ts"
import * as WebKitWire from "../src/internal/webkitWire.ts"
import type * as Protocol from "../src/protocol/Protocol.ts"
import { type Entry, fixtures } from "./integration/record.ts"

type Definitions = {
  readonly commands: ReadonlyMap<string, Protocol.CommandDef<string, unknown, unknown>>
  readonly events: ReadonlyMap<string, Protocol.EventDef<string, unknown>>
}

/** Every command and event the generated barrels declare, by method. */
const definitions = (barrels: ReadonlyArray<object>): Definitions => {
  const commands = new Map<string, Protocol.CommandDef<string, unknown, unknown>>()
  const events = new Map<string, Protocol.EventDef<string, unknown>>()
  for (const module of barrels.flatMap((barrel) => Object.values(barrel)) as ReadonlyArray<Record<string, unknown>>) {
    for (const value of Object.values(module)) {
      if (typeof value === "function" && "method" in value && "Result" in value) {
        const command = value as unknown as Protocol.CommandDef<string, unknown, unknown>
        commands.set(command.method, command)
      } else if (typeof value === "object" && value !== null && "method" in value && "Params" in value) {
        const event = value as Protocol.EventDef<string, unknown>
        events.set(event.method, event)
      }
    }
  }
  return { commands, events }
}

const directory = `${import.meta.dirname}/fixtures/traffic`

const backends = [
  { fixture: fixtures.cdp, barrels: [Cdp], wire: CdpWire.wire, protocols: ["cdp"] },
  { fixture: fixtures.bidi, barrels: [Bidi], wire: BidiWire.wire, protocols: ["bidi"] },
  {
    fixture: fixtures.webkitStock,
    barrels: [WebKitStock, WebKitAutomation],
    wire: WebKitWire.wire,
    protocols: ["webkit-stock", "webkit-automation"]
  }
] as const

/** The methods the coverage reports exclude by policy, such as deprecated events. */
const excluded = (protocols: ReadonlyArray<string>): ReadonlySet<string> =>
  new Set(protocols.flatMap((protocol) => {
    const coverage = JSON.parse(
      fs.readFileSync(`${import.meta.dirname}/../../tools/codegen/protocols/${protocol}/coverage.json`, "utf8")
    ) as { readonly entries: ReadonlyArray<{ readonly item: string; readonly verdict: string }> }
    return coverage.entries.filter((entry) => entry.verdict === "excluded" && !entry.item.includes(":")).map((
      entry
    ) => entry.item.replace("#", "."))
  }))

const read = (fixture: string): ReadonlyArray<Entry> =>
  fs.readFileSync(`${directory}/${fixture}.ndjson`, "utf8").split("\n").filter((line) => line !== "").map(
    (line) => JSON.parse(line) as Entry
  )

const decode = (codec: Schema.Codec<unknown, unknown> | undefined, value: unknown) =>
  codec === undefined ? Effect.void : Effect.asVoid(Schema.decodeUnknownEffect(codec)(value))

for (const { barrels, fixture, protocols, wire } of backends) {
  describe(`recorded traffic: ${fixture}`, () => {
    const entries = read(fixture)
    const { commands, events } = definitions(barrels)
    const policy = excluded(protocols)

    it("has some of everything: events, results and error replies", () => {
      assert.isAbove(entries.filter((entry) => entry.kind === "event").length, 20)
      assert.isAbove(entries.filter((entry) => entry.kind === "result").length, 20)
      assert.isAbove(entries.filter((entry) => entry.kind === "error").length, 3)
    })

    it.effect("decodes every recorded event and result through the generated codecs", () =>
      Effect.gen(function*() {
        const failures: Array<string> = []
        for (const entry of entries) {
          if (entry.kind === "error") continue
          const definition = entry.kind === "event" ? events.get(entry.method) : commands.get(entry.method)
          if (definition === undefined) {
            if (!policy.has(entry.method)) failures.push(`${entry.kind} ${entry.method}: no generated definition`)
            continue
          }
          const codec = entry.kind === "event"
            ? definition.Params
            : (definition as Protocol.CommandDef<string, unknown, unknown>).Result
          const value = entry.kind === "event" ? entry.params : entry.result
          const exit = yield* Effect.exit(decode(codec as Schema.Codec<unknown, unknown> | undefined, value))
          if (exit._tag === "Failure") failures.push(`${entry.kind} ${entry.method}: ${String(exit.cause)}`)
        }
        assert.deepStrictEqual(failures, [])
      }))

    it("classifies every recorded error reply as it was classified when recorded", () => {
      for (const entry of entries) {
        if (entry.kind !== "error") continue
        const becomes = ProtocolClient.match(wire.errors, entry.error)?.becomes ??
          { _tag: "Rejected", reason: "Unrecognized" }
        assert.deepStrictEqual(becomes, entry.becomes, `${entry.method}: ${entry.error.message}`)
      }
    })
  })
}
