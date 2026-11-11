/** Storage export must keep typed deadlines, and its cleanup diagnostics must recognize older wrapped deadlines. */
import { assert, it } from "@effect/vitest"
import { Page, Reason, Target, Url, UserContext } from "@usestrider/browser"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as SubscriptionRef from "effect/SubscriptionRef"
import * as Operation from "../src/internal/operation.ts"
import type * as Runtime from "../src/internal/runtime.ts"
import * as Storage from "../src/internal/storageState.ts"
import { readStorage } from "./integration/slice/sharedContext.ts"

const operation = "UserContext.exportStorageState"
const contextId = "context" as UserContext.Id

for (const step of ["cookies", "realm"] as const) {
  it.effect(`preserves the original exportStorageState deadline from ${step}`, () =>
    Effect.gen(function*() {
      const record = yield* Operation.record
      const timeout = record.timeout(Option.some(
        `The browser didn't answer ${
          step === "cookies" ? "the cookie read" : "the document's realm"
        } before the deadline`
      ))
      const capabilities = yield* SubscriptionRef.make({ entries: [] })
      // Only the adapter call under test fails; the origin is an ordinary live document.
      const document = "document" as Target.DocumentId
      const runtime = {
        backend: "Firefox",
        model: {
          adapter: {
            capabilities,
            cookies: () => step === "cookies" ? Effect.fail(timeout) : Effect.succeed([]),
            realm: () => Effect.fail(timeout)
          },
          pages: {
            get: Effect.succeed([{
              context: contextId,
              state: {
                get: Effect.succeed({
                  status: { _tag: "Open", url: "https://example.com/", document: { id: document } },
                  frames: []
                })
              }
            }])
          },
          document: () => Option.some({ state: { get: Effect.succeed({ url: "https://example.com/" }) } })
        }
      } as unknown as Runtime.Runtime
      const error = yield* Storage.exportState(runtime, contextId).pipe(Effect.flip)
      assert.strictEqual(error as unknown, timeout)
    }).pipe(Operation.named(operation)))
}

const wrapped = (hint: string, method = operation) =>
  Effect.map(Operation.record, (record) =>
    new UserContext.UserContextError({
      operation,
      reason: new Reason.BackendFailure({ kind: "Rejected", method, hint }),
      diagnostics: Operation.diagnostics(record.id)
    }))

for (
  const [hint, method, probes] of [
    [`${operation} timed out while resolving`, operation, true],
    ["Storage access denied", operation, false],
    ["A script threw: timed out while resolving", operation, false],
    ["Page.evaluate timed out while resolving", "Page.evaluate", false]
  ] as const
) {
  it.effect(`readStorage ${probes ? "probes" : "does not probe"} Rejected (${hint})`, () =>
    Effect.scoped(Effect.gen(function*() {
      const error = yield* wrapped(hint, method)
      const records: Array<{ kind: string; payload: any }> = []
      const notes: Array<string> = []
      const calls: Array<string> = []
      const page = {
        evaluate: () =>
          Effect.sync(() => {
            calls.push("evaluate")
            return 2
          }),
        url: Effect.succeed("https://example.com/" as Url.Url),
        goto: () =>
          Effect.sync(() => {
            calls.push("goto")
          })
      } as unknown as Page.Page
      const context = {
        exportStorageState: Effect.fail(error),
        newPage: Effect.succeed(page)
      } as unknown as UserContext.UserContext
      yield* readStorage(
        (found) => Effect.sync(() => void notes.push(...found)),
        context,
        page,
        (kind, payload) => void records.push({ kind, payload })
      )
      for (const { payload } of records) assert.isNumber(payload.millis)
      // The exact release failure's note remains untouched, including its repeated operation name.
      assert.deepStrictEqual(notes, [`storage that couldn't be read: ${operation}: ${method}: Rejected (${hint})`])
      assert.deepStrictEqual(calls, probes ? ["evaluate", "goto", "evaluate"] : [])
      assert.deepStrictEqual(
        records.map(({ kind, payload }) => [kind, payload.probe, payload.outcome]),
        probes
          ? [
            ["stalled-read-probe", "same page answers a trivial script", "answered"],
            ["stalled-read-probe", "new page on the origin answers indexedDB.databases()", "answered"],
            ["stalled-read-probe", "closing that page", "answered"]
          ]
          : []
      )
    })).pipe(Operation.named("Test.readStorage")))
}
