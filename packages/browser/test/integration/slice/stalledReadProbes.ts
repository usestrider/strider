/**
 * What the shared context's page-closing storage read does when a page doesn't answer it: the probes run and are
 * recorded, the note stays what it was, and a read that answers runs none.
 */
import { assert, describe, layer } from "@effect/vitest"
import { Browser } from "@usestrider/browser"
import * as Effect from "effect/Effect"
import type * as Layer from "effect/Layer"
import { site } from "../adapter/harness.ts"
import { probeStalledRead, readStorage } from "./sharedContext.ts"

export const stalledReadProbes = <E>(name: string, backend: Layer.Layer<Browser.Browser, E>) =>
  describe(`${name} stalled storage read`, () => {
    layer(backend, { timeout: 60_000 })((it) => {
      const setup = Effect.fnUntraced(function*() {
        const served = yield* site
        const context = yield* Browser.newContext()
        const page = yield* context.newPage
        yield* page.goto(`${served.origin}/fixture?html=${encodeURIComponent("<p>One</p>")}`)
        return { context, page }
      })

      it.effect(
        "records both probes, with their timings, and notes the read as unreadable",
        () =>
          Effect.scoped(Effect.gen(function*() {
            const { context, page } = yield* setup()
            const records: Array<{ kind: string; payload: any }> = []
            const notes: Array<string> = []
            // A context whose storage read is a page call that never answers, so that its deadline passes
            const stalled = Object.create(context, {
              exportStorageState: { value: page.evaluate(() => new Promise<never>(() => {})) }
            })
            yield* readStorage(
              (found) => Effect.sync(() => void notes.push(...found)),
              stalled,
              page,
              (kind, payload) => void records.push({ kind, payload }),
              "200 millis"
            )
            assert.deepStrictEqual(records.map((record) => record.kind), Array(3).fill("stalled-read-probe"))
            assert.deepStrictEqual(records.map((record) => record.payload.probe), [
              "same page answers a trivial script",
              "new page on the origin answers indexedDB.databases()",
              "closing that page"
            ])
            for (const { payload } of records) {
              assert.strictEqual(payload.outcome, "answered", JSON.stringify(payload))
              assert.isNumber(payload.millis)
            }
            assert.strictEqual(notes.length, 1)
            assert.match(notes[0]!, /^storage that couldn't be read: /)
          })),
        60_000
      )

      it.effect("runs no probe when the read answers", () =>
        Effect.scoped(Effect.gen(function*() {
          const { context, page } = yield* setup()
          const records: Array<string> = []
          const notes: Array<string> = []
          yield* readStorage(
            (found) => Effect.sync(() => void notes.push(...found)),
            context,
            page,
            (kind) => void records.push(kind)
          )
          assert.deepStrictEqual(records, [])
          assert.deepStrictEqual(notes, [])
        })), 60_000)

      it.effect("records a probe that times out as such, without failing", () =>
        Effect.scoped(Effect.gen(function*() {
          const { context, page } = yield* setup()
          const records: Array<{ payload: any }> = []
          const hung = Object.create(page, {
            evaluate: { value: () => page.evaluate(() => new Promise<never>(() => {})) }
          })
          yield* probeStalledRead(context, hung, (_kind: string, payload: any) => void records.push({ payload }))
          assert.strictEqual(records[0]!.payload.outcome, "timed out")
          assert.strictEqual(records.length, 3)
        })), 60_000)
    })
  })
