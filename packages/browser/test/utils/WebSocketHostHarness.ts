import { Browser } from "@usestrider/browser"
import * as Clock from "effect/Clock"
import * as Effect from "effect/Effect"
import type * as Adapter from "../../src/internal/adapter.ts"
import * as BrowserImpl from "../../src/internal/browser.ts"
import * as BrowserClock from "../../src/internal/browserClock.ts"
import * as Fake from "../../src/internal/fake.ts"

export const harness = Effect.fnUntraced(
  function*(
    test: (
      bridge: () => Adapter.WebSocketBridge
    ) => Effect.Effect<void, unknown, Browser.Browser | import("effect/Scope").Scope>,
    evaluate?: Adapter.AdapterConnection["evaluate"]
  ) {
    let bridge!: Adapter.WebSocketBridge
    const clock = yield* Clock.clockWith(Effect.succeed)
    const backend = BrowserImpl.layer((sink) =>
      Fake.connect([], {
        info: new Browser.Info(Fake.info),
        capabilities: new Browser.CapabilitySet({ entries: Fake.capabilities })
      })(sink).pipe(Effect.map((fake) => ({
        ...fake,
        ownership: "launched" as const,
        ...(evaluate === undefined ? {} : { evaluate }),
        declare: (scope, declaration) =>
          fake.declare(scope, declaration).pipe(Effect.tap(() =>
            Effect.sync(() => {
              if (declaration._tag === "InitScript" && declaration.webSocket !== undefined) {
                bridge = declaration.webSocket
              }
            })
          ))
      })))
    )
    yield* test(() => bridge).pipe(
      Effect.provide(backend),
      Effect.provideService(BrowserClock.CurrentClock, BrowserClock.fromClock(clock))
    )
  }
)
