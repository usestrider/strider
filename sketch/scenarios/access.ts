/**
 * Rules the types must enforce. Each `@ts-expect-error` line must fail to compile; if one starts compiling,
 * tsc reports the unused directive, so a loosened rule can't go unnoticed.
 */
import { Deferred as EffectDeferred, Effect } from "effect"
import { Download, NetworkRequest, NetworkResponse } from "../src/index.ts"
import type { ObservedPage, Page, ReadonlyDeferred, ReadonlyPage } from "../src/index.ts"
import { HttpIncomingMessage } from "effect/http"
import { Schema } from "effect"

declare const observed: ObservedPage
declare const reader: ReadonlyPage
declare const page: Page
declare const latched: ReadonlyDeferred<number>

export const rules = Effect.gen(function* () {
  // @ts-expect-error a page you may only inspect offers no actions
  reader.getByRole("button").click

  const snapshot = yield* reader.snapshot
  // @ts-expect-error a snapshot carries its page's access: its refs can't act either
  snapshot.ref(snapshot.refs.keys().next().value!).click

  // @ts-expect-error the main world needs control
  reader.evaluateWith({ world: "main" }, () => 1)

  // @ts-expect-error downloads need control
  yield* Download.next(observed)

  // @ts-expect-error "any request" as a first match is a footgun: next requires a url
  yield* NetworkRequest.next(page, {})

  // @ts-expect-error collecting bodies needs inspect
  yield* NetworkResponse.next(observed, { url: "**", body: HttpIncomingMessage.schemaBodyJson(Schema.String) })

  // @ts-expect-error a file path must say whose machine it is on
  yield* page.getByLabel("Avatar").setInputFiles("./avatar.png")

  // @ts-expect-error a latched result can't be completed by its reader
  yield* EffectDeferred.succeed(latched, 1)

  // @ts-expect-error DOM nodes don't cross by value
  const body: HTMLElement = yield* page.evaluate(() => document.body)
  return body
})
