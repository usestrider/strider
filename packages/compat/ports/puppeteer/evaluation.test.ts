/**
 * Puppeteer's `test/src/evaluation.test.ts`: running a function in the page, what crosses the boundary in each
 * direction, what a failed evaluation reports, init scripts added before a page's own, and the execution context each
 * frame has.
 *
 * What the port changes:
 * - Puppeteer's `page.evaluate` runs in the page's main world, so every evaluation here is `page.evaluateInMainWorld`.
 *   Strider's `page.evaluate` is the isolated world, which stock WebKit lacks. The tests that pass a handle
 *   (`page.evaluateHandle`) are the only ones that run in the isolated world, and they are ledgered for WebKit.
 * - Results come back as `JSHandle.Serialized<A>`, and a thrown value is `PageError` with `Reason.EvaluationThrown`,
 *   whose `exception` carries the name and message. Puppeteer's checks on the thrown value (the string, the number, or
 *   the object itself) become checks on that exception's message, and `.catch(e => e)` is `reasonOf`. The reload test
 *   asserts Strider's `TargetGone`, which is more specific than Puppeteer's message.
 * - What crosses is by value, as API.md, "Pages" states: the first value that can't cross fails with `NotSerializable`.
 *   A symbol in an array is `undefined`. Puppeteer is lenient where Strider refuses: a window, a `Promise` and an
 *   `ImageBitmap` come back as `undefined`, `{}` and a left-out field, and an `undefined` field is dropped by its JSON
 *   transfer where Strider keeps it. Those tests assert Puppeteer's results and fail on Strider, which has no decision
 *   that makes them differences by design.
 * - Puppeteer's `evaluateOnNewDocument` is `page.addInitScript`, with the function as the script; the script runs in the
 *   main world, as Puppeteer's does. `removeScriptToEvaluateOnNewDocument` is the end of the scope the script was added
 *   in (`Scope.make`, `Scope.provide`, `Scope.close`), as IS-029 of the Playwright port does.
 * - Puppeteer's `frame.evaluate` runs in the frame's main world, which Strider has no method for. A frame here is reached
 *   through `document.querySelector("iframe").contentWindow` from the page's main world, as FR-001 and FR-002 of the
 *   Playwright port do, and the test reads the same globals.
 * - `page.frames()` is `frameCount(page)`, and `page.frames()[0]` is the page. `page.mainFrame()` is the page, since
 *   Strider has no `Frame` object.
 * - Puppeteer's `page.$` is `page.evaluateHandle`, a handle in the isolated world, as EV-060 of the Playwright port does.
 *   `element.dispose()` is `release`, and a released handle is a defect in Strider, where Puppeteer's disposed handle
 *   rejects its evaluation with "JSHandle is disposed". The port checks the defect, as EV-061 does.
 * - Puppeteer's `page.goto`, `setContent`, and `reload` wait for `load` by default; Strider's wait for `commit`, so each
 *   names `waitUntil: "load"`.
 * - "should work right after framenavigated" is `PageNavigation.next`, subscribed before the `goto` and awaited after it,
 *   as the original awaits its listener's promise (EV-024 of the Playwright port).
 * - "should simulate a user gesture" runs under `Page.withUserGesture`, since Puppeteer's evaluate runs with user
 *   activation (`execCommand("copy")` needs it).
 * - "should not throw an error when evaluation does a navigation" waits for the request for `/empty.html`
 *   (`server.waitForRequest`) with a bound of its own, so a request that never comes fails naming what it waited for.
 * - "should transfer 100Mb of data from page to node.js" runs under the harness's 30-second budget, where Puppeteer's
 *   test sets 25 seconds.
 * - The tests that need what Strider lacks are not ported, and the ledger says why each is: a function the page calls
 *   back (`exposeFunction`), a string evaluated as source, and a handle from another frame.
 * - "should work with CSP" adds its second script by hand: Strider has no `addScriptTag`, so the check that the CSP
 *   blocks an inline script appends a `<script>` element from the page, as `addScriptTag({ content })` does.
 * - "should work for circular object" and "should return properly serialize objects with unknown type fields" are ported
 *   as written, and fail: a cycle, and an `ImageBitmap`, can't cross by value.
 * - "should work with function shorthands" (both) and "should support thrown strings as error messages" are ported as
 *   written and fail on Chromium: Strider sends `fn.toString()` as the function declaration, which method shorthand is
 *   not, and a thrown string's text is `Uncaught` with the value left out of the exception.
 */
import { assert } from "@effect/vitest"
import { Page, PageNavigation, Reason, Target } from "@usestrider/browser"
import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Fiber from "effect/Fiber"
import * as Scope from "effect/Scope"
import { attachFrame, failureOf, frameCount, startWaiting } from "../harness/playwright.ts"
import { html } from "../harness/puppeteer.ts"
import { upstream } from "../harness/upstream.ts"

/**
 * The reason a page call fails with, for a call the original expects to throw (its `.catch(e => e)`). A call that
 * succeeds fails the test.
 */
const reasonOf = Effect.fnUntraced(function*<A, R>(effect: Effect.Effect<A, unknown, R>) {
  const error = yield* failureOf(effect, "the evaluation")
  assert.instanceOf(error, Page.PageError)
  return error.reason
})

/** The thrown exception's message, for a call whose original throws a value and checks its message. */
const thrownMessageOf = Effect.fnUntraced(function*<A, R>(effect: Effect.Effect<A, unknown, R>) {
  const reason = yield* reasonOf(effect)
  assert.instanceOf(reason, Reason.EvaluationThrown)
  return reason.exception.message
})

/** The fixture server's request for `path` arrives within a bound of this test's own; the bound names what it waited for. */
const requestWithin = (path: string, arrived: Effect.Effect<unknown, unknown>) =>
  arrived.pipe(
    Effect.timeoutOrElse({
      duration: "10 seconds",
      orElse: () => Effect.die(new Error(`the request for ${path} never arrived`))
    })
  )

upstream(import.meta.filename, {}, (test) => {
  test("Evaluation specs Page.evaluate should work", ({ page }) =>
    Effect.gen(function*() {
      const result = yield* page.evaluateInMainWorld(() => {
        return 7 * 3
      })
      assert.strictEqual(result, 21)
    }))

  test("Evaluation specs Page.evaluate should transfer BigInt", ({ page }) =>
    Effect.gen(function*() {
      const result = yield* page.evaluateInMainWorld((a: bigint) => {
        return a
      }, BigInt(42))
      assert.strictEqual(result, BigInt(42))
    }))

  test("Evaluation specs Page.evaluate should transfer NaN", ({ page }) =>
    Effect.gen(function*() {
      const result = yield* page.evaluateInMainWorld((a: number) => {
        return a
      }, NaN)
      assert.isTrue(Object.is(result, NaN))
    }))

  test("Evaluation specs Page.evaluate should transfer -0", ({ page }) =>
    Effect.gen(function*() {
      const result = yield* page.evaluateInMainWorld((a: number) => {
        return a
      }, -0)
      assert.isTrue(Object.is(result, -0))
    }))

  test("Evaluation specs Page.evaluate should transfer Infinity", ({ page }) =>
    Effect.gen(function*() {
      const result = yield* page.evaluateInMainWorld((a: number) => {
        return a
      }, Infinity)
      assert.isTrue(Object.is(result, Infinity))
    }))

  test("Evaluation specs Page.evaluate should transfer -Infinity", ({ page }) =>
    Effect.gen(function*() {
      const result = yield* page.evaluateInMainWorld((a: number) => {
        return a
      }, -Infinity)
      assert.isTrue(Object.is(result, -Infinity))
    }))

  test("Evaluation specs Page.evaluate should transfer arrays", ({ page }) =>
    Effect.gen(function*() {
      const result = yield* page.evaluateInMainWorld((a: ReadonlyArray<number>) => {
        return a
      }, [1, 2, 3])
      assert.deepStrictEqual(result, [1, 2, 3])
    }))

  test("Evaluation specs Page.evaluate should transfer arrays as arrays, not objects", ({ page }) =>
    Effect.gen(function*() {
      const result = yield* page.evaluateInMainWorld((a: ReadonlyArray<number>) => {
        return Array.isArray(a)
      }, [1, 2, 3])
      assert.isTrue(result)
    }))

  test("Evaluation specs Page.evaluate should transfer RegEx", ({ page }) =>
    Effect.gen(function*() {
      const result = yield* page.evaluateInMainWorld((a: RegExp) => {
        return `Hello World!`.match(a)![1]
      }, /Hello (.*)/)
      assert.strictEqual(result, `World!`)
    }))

  test("Evaluation specs Page.evaluate should modify global environment", ({ page }) =>
    Effect.gen(function*() {
      yield* page.evaluateInMainWorld(() => {
        return ((globalThis as any).globalVar = 123)
      })
      // The original's second evaluation is the string `globalVar`, which reads this function's body
      assert.strictEqual(yield* page.evaluateInMainWorld(() => Reflect.get(window, "globalVar")), 123)
    }))

  test("Evaluation specs Page.evaluate should evaluate in the page context", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/global-var.html", { waitUntil: "load" })
      assert.strictEqual(yield* page.evaluateInMainWorld(() => Reflect.get(window, "globalVar")), 123)
    }))

  test("Evaluation specs Page.evaluate should replace symbols with undefined", ({ page }) =>
    Effect.gen(function*() {
      assert.deepStrictEqual(
        yield* page.evaluateInMainWorld(() => {
          return [Symbol("foo4"), "foo"]
        }),
        [undefined, "foo"]
      )
    }))

  test("Evaluation specs Page.evaluate should work with function shorthands", ({ page }) =>
    Effect.gen(function*() {
      const a = {
        sum(a: number, b: number) {
          return a + b
        },

        async mult(a: number, b: number) {
          return a * b
        }
      }
      assert.strictEqual(yield* page.evaluateInMainWorld(a.sum, 1, 2), 3)
      assert.strictEqual(yield* page.evaluateInMainWorld(a.mult, 2, 4), 8)
    }))

  test("Evaluation specs Page.evaluate should work with function shorthands and nested arrow functions", ({ page }) =>
    Effect.gen(function*() {
      const a = {
        sum(a: number, b: number) {
          const _arrow = () => {}
          _arrow()
          return a + b
        }
      }
      assert.strictEqual(yield* page.evaluateInMainWorld(a.sum, 1, 2), 3)
    }))

  test("Evaluation specs Page.evaluate should work with unicode chars", ({ page }) =>
    Effect.gen(function*() {
      const result = yield* page.evaluateInMainWorld((a: Record<string, number>) => {
        return a["中文字符"]
      }, {
        中文字符: 42
      })
      assert.strictEqual(result, 42)
    }))

  test("Evaluation specs Page.evaluate should throw when evaluation triggers reload", ({ page }) =>
    Effect.gen(function*() {
      // The document ends during the call, which fails it with `TargetGone`, since the function may have run partly
      const error = yield* failureOf(
        page.evaluateInMainWorld(() => {
          location.reload()
          return new Promise(() => {})
        }),
        "the evaluation"
      )
      assert.isTrue(Target.isTargetGone(error))
    }))

  test("Evaluation specs Page.evaluate should await promise", ({ page }) =>
    Effect.gen(function*() {
      const result = yield* page.evaluateInMainWorld(() => {
        return Promise.resolve(8 * 7)
      })
      assert.strictEqual(result, 56)
    }))

  test("Evaluation specs Page.evaluate should work right after framenavigated", ({ page, server }) =>
    Effect.gen(function*() {
      // The original's listener starts the evaluation at `framenavigated` and awaits it after the `goto`. The wait ends
      // at the navigation's commit, so the evaluation starts then, in a fiber, as EV-024 of the Playwright port does.
      const navigated = yield* PageNavigation.next(page)
      const evaluation = yield* startWaiting(
        Effect.gen(function*() {
          yield* navigated
          return yield* page.evaluateInMainWorld(() => {
            return 6 * 7
          })
        })
      )
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      assert.strictEqual(yield* Fiber.join(evaluation.fiber), 42)
    }))

  test("Evaluation specs Page.evaluate should reject promise with exception", ({ page }) =>
    Effect.gen(function*() {
      const reason = yield* reasonOf(
        page.evaluateInMainWorld(() => {
          // @ts-expect-error we know the object doesn't exist
          return notExistingObject.property
        })
      )
      assert.instanceOf(reason, Reason.EvaluationThrown)
      assert.include(reason.exception.message, "notExistingObject")
    }))

  test("Evaluation specs Page.evaluate should support thrown strings as error messages", ({ page }) =>
    Effect.gen(function*() {
      // Puppeteer's error is the thrown string itself; Strider's is `EvaluationThrown`, which carries it as its message
      const message = yield* thrownMessageOf(
        page.evaluateInMainWorld(() => {
          throw "qwerty"
        })
      )
      assert.include(message, "qwerty")
    }))

  test("Evaluation specs Page.evaluate should support thrown numbers as error messages", ({ page }) =>
    Effect.gen(function*() {
      const message = yield* thrownMessageOf(
        page.evaluateInMainWorld(() => {
          throw 100500
        })
      )
      assert.include(message, "100500")
    }))

  test("Evaluation specs Page.evaluate should support thrown platform objects as error messages", ({ page }) =>
    Effect.gen(function*() {
      const message = yield* thrownMessageOf(
        page.evaluateInMainWorld(() => {
          throw new DOMException("some DOMException message")
        })
      )
      assert.include(message, "some DOMException message")
    }))

  test("Evaluation specs Page.evaluate should return complex objects", ({ page }) =>
    Effect.gen(function*() {
      const object = { foo: "bar!" }
      const result = yield* page.evaluateInMainWorld((a: { foo: string }) => {
        return a
      }, object)
      assert.notStrictEqual(result, object)
      assert.deepStrictEqual(result, object)
    }))

  test("Evaluation specs Page.evaluate should return BigInt", ({ page }) =>
    Effect.gen(function*() {
      const result = yield* page.evaluateInMainWorld(() => {
        return BigInt(42)
      })
      assert.strictEqual(result, BigInt(42))
    }))

  test("Evaluation specs Page.evaluate should return NaN", ({ page }) =>
    Effect.gen(function*() {
      const result = yield* page.evaluateInMainWorld(() => {
        return NaN
      })
      assert.isTrue(Object.is(result, NaN))
    }))

  test("Evaluation specs Page.evaluate should return -0", ({ page }) =>
    Effect.gen(function*() {
      const result = yield* page.evaluateInMainWorld(() => {
        return -0
      })
      assert.isTrue(Object.is(result, -0))
    }))

  test("Evaluation specs Page.evaluate should return Infinity", ({ page }) =>
    Effect.gen(function*() {
      const result = yield* page.evaluateInMainWorld(() => {
        return Infinity
      })
      assert.isTrue(Object.is(result, Infinity))
    }))

  test("Evaluation specs Page.evaluate should return -Infinity", ({ page }) =>
    Effect.gen(function*() {
      const result = yield* page.evaluateInMainWorld(() => {
        return -Infinity
      })
      assert.isTrue(Object.is(result, -Infinity))
    }))

  test("Evaluation specs Page.evaluate should return RegEx", ({ page }) =>
    Effect.gen(function*() {
      const result = yield* page.evaluateInMainWorld(() => {
        return /(.*)/
      })
      assert.isTrue(result instanceof RegExp)
    }))

  test("Evaluation specs Page.evaluate should accept \"null\" as one of multiple parameters", ({ page }) =>
    Effect.gen(function*() {
      const result = yield* page.evaluateInMainWorld(
        (a: unknown, b: unknown) => {
          return Object.is(a, null) && Object.is(b, "foo")
        },
        null,
        "foo"
      )
      assert.isTrue(result)
    }))

  test("Evaluation specs Page.evaluate should properly serialize null fields", ({ page }) =>
    Effect.gen(function*() {
      const result: unknown = yield* page.evaluateInMainWorld(() => {
        return { a: undefined }
      })
      assert.deepStrictEqual(result, {})
    }))

  test("Evaluation specs Page.evaluate should return undefined for non-serializable objects", ({ page }) =>
    Effect.gen(function*() {
      assert.isUndefined(
        yield* page.evaluateInMainWorld(() => {
          return window
        })
      )
    }))

  test("Evaluation specs Page.evaluate should return promise as empty object", ({ page }) =>
    Effect.gen(function*() {
      const result: unknown = yield* page.evaluateInMainWorld(() => {
        return {
          promise: new Promise((resolve) => {
            setTimeout(resolve, 1000)
          })
        }
      })
      assert.deepStrictEqual(result, { promise: {} })
    }))

  test("Evaluation specs Page.evaluate should work for circular object", ({ page }) =>
    Effect.gen(function*() {
      // A cycle in a result can't cross by value, so this fails on every backend (the port keeps Puppeteer's checks)
      // The cyclic result's type is its `Serialized` form, which the port reads through the fields Puppeteer checks
      const result = (yield* page.evaluateInMainWorld(() => {
        const a: Record<string, unknown> = {
          c: 5,
          d: {
            foo: "bar"
          }
        }
        const b = { a }
        a["b"] = b
        return a
      })) as unknown as { c: number; d: unknown; b: { a?: unknown } }
      assert.strictEqual(result.c, 5)
      assert.deepStrictEqual(result.d, { foo: "bar" })
      assert.isObject(result.b)
      assert.isUndefined(result.b.a)
    }))

  test("Evaluation specs Page.evaluate should accept element handle as an argument", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(html("<section>42</section>"), { waitUntil: "load" })
      // Puppeteer's `page.$` is a handle in the isolated world, which Strider's `evaluateHandle` makes
      const element = yield* page.evaluateHandle(() => document.querySelector("section"))
      const text = yield* page.evaluate((e) => (e as unknown as Element | null)?.textContent, element)
      assert.strictEqual(text, "42")
    }))

  test("Evaluation specs Page.evaluate should throw if underlying element was disposed", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(html("<section>39</section>"), { waitUntil: "load" })
      const element = yield* page.evaluateHandle(() => document.querySelector("section"))
      // Puppeteer's `element.dispose()` ends the handle early; using a released handle is a programming error, a defect,
      // where Puppeteer's disposed handle rejects its evaluation with "JSHandle is disposed"
      yield* element.release
      const exit = yield* Effect.exit(
        page.evaluate((e) => (e as unknown as Element | null)?.textContent, element)
      )
      if (!Exit.isFailure(exit)) assert.fail("the evaluation succeeded, where Puppeteer's rejects")
      assert.isTrue(Cause.hasDies(exit.cause))
    }))

  test("Evaluation specs Page.evaluate should simulate a user gesture", ({ page }) =>
    Effect.gen(function*() {
      // Puppeteer's evaluate runs with user activation, which `execCommand("copy")` needs, so it runs as a user gesture
      const result = yield* page.evaluateInMainWorld(() => {
        document.body.appendChild(document.createTextNode("test"))
        document.execCommand("selectAll")
        return document.execCommand("copy")
      }).pipe(Page.withUserGesture)
      assert.isTrue(result)
    }))

  test("Evaluation specs Page.evaluate should not throw an error when evaluation does a navigation", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/one-style.html", { waitUntil: "load" })
      const onRequest = yield* server.waitForRequest("/empty.html")
      const result = yield* page.evaluateInMainWorld(() => {
        ;(window as any).location = "/empty.html"
        return [42]
      })
      assert.deepStrictEqual(result, [42])
      yield* requestWithin("/empty.html", onRequest)
    }))

  test("Evaluation specs Page.evaluate should transfer 100Mb of data from page to node.js", ({ page }) =>
    Effect.gen(function*() {
      const a = yield* page.evaluateInMainWorld(() => {
        return Array(100 * 1024 * 1024 + 1).join("a")
      })
      assert.strictEqual(a.length, 100 * 1024 * 1024)
    }))

  test("Evaluation specs Page.evaluate should throw error with detailed information on exception inside promise", ({ page }) =>
    Effect.gen(function*() {
      const message = yield* thrownMessageOf(
        page.evaluateInMainWorld(() => {
          return new Promise(() => {
            throw new Error("Error in promise")
          })
        })
      )
      assert.include(message, "Error in promise")
    }))

  test("Evaluation specs Page.evaluate should return properly serialize objects with unknown type fields", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(
        html(
          `<img
          src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="
        />`
        ),
        { waitUntil: "load" }
      )

      const result = yield* page.evaluateInMainWorld(async () => {
        const image = document.querySelector("img")!
        const imageBitmap = await createImageBitmap(image)

        return {
          a: "foo",
          b: imageBitmap
        }
      })

      assert.deepStrictEqual(result, {
        a: "foo",
        b: undefined
      } as unknown)
    }))

  test("Evaluation specs Page.evaluateOnNewDocument should evaluate before anything else on the page", ({ page, server }) =>
    Effect.scoped(Effect.gen(function*() {
      yield* page.addInitScript(() => {
        ;(globalThis as any).injected = 123
      })
      yield* page.goto(server.PREFIX + "/tamperable.html", { waitUntil: "load" })
      assert.strictEqual(
        yield* page.evaluateInMainWorld(() => {
          return (globalThis as any).result
        }),
        123
      )
    })))

  test("Evaluation specs Page.evaluateOnNewDocument should work with CSP", ({ page, server }) =>
    Effect.scoped(Effect.gen(function*() {
      // The original's `server.setCSP`: the header the fixture server sends for this page
      server.setExtraHeaders("/empty.html", { "content-security-policy": "script-src " + server.PREFIX })
      yield* page.addInitScript(() => {
        ;(globalThis as any).injected = 123
      })
      yield* page.goto(server.PREFIX + "/empty.html", { waitUntil: "load" })
      assert.strictEqual(
        yield* page.evaluateInMainWorld(() => (globalThis as any).injected),
        123
      )

      // Make sure CSP works: the original adds an inline script with `addScriptTag`, which the policy blocks
      yield* page.evaluateInMainWorld(() => {
        const script = document.createElement("script")
        script.textContent = "window.e = 10;"
        document.head.appendChild(script)
      })
      assert.isUndefined(yield* page.evaluateInMainWorld(() => (window as any).e))
    })))

  test("Evaluation specs Page.removeScriptToEvaluateOnNewDocument should remove new document script", ({ page, server }) =>
    Effect.scoped(Effect.gen(function*() {
      // `removeScriptToEvaluateOnNewDocument(identifier)`: the script lives in its own scope, which closing removes it
      // from, as IS-029 of the Playwright port does
      const scope = yield* Scope.make()
      yield* page.addInitScript(() => {
        ;(globalThis as any).injected = 123
      }).pipe(Scope.provide(scope))
      yield* page.goto(server.PREFIX + "/tamperable.html", { waitUntil: "load" })
      assert.strictEqual(
        yield* page.evaluateInMainWorld(() => {
          return (globalThis as any).result
        }),
        123
      )

      yield* Scope.close(scope, Exit.void)
      yield* page.reload({ waitUntil: "load" })
      assert.strictEqual(
        yield* page.evaluateInMainWorld(() => {
          return (globalThis as any).result || null
        }),
        null
      )
    })))

  test("Evaluation specs Frame.evaluate should have different execution contexts", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      yield* attachFrame(page, "frame1", server.EMPTY_PAGE)
      assert.strictEqual(yield* frameCount(page), 2)
      // `page.frames()[0]` is the page's window, and `page.frames()[1]` is the iframe's, same-origin, in the main world
      yield* page.evaluateInMainWorld(() => {
        ;(window as any).FOO = "foo"
        ;(document.querySelector("iframe")!.contentWindow as any).FOO = "bar"
      })
      assert.strictEqual(
        yield* page.evaluateInMainWorld(() => (window as any).FOO),
        "foo"
      )
      assert.strictEqual(
        yield* page.evaluateInMainWorld(() => (document.querySelector("iframe")!.contentWindow as any).FOO),
        "bar"
      )
    }))

  test("Evaluation specs Frame.evaluate should have correct execution contexts", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/frames/one-frame.html", { waitUntil: "load" })
      assert.strictEqual(yield* frameCount(page), 2)
      assert.strictEqual(
        yield* page.evaluateInMainWorld(() => document.body.textContent!.trim()),
        ""
      )
      assert.strictEqual(
        yield* page.evaluateInMainWorld(() =>
          document.querySelector("iframe")!.contentDocument!.body.textContent!.trim()
        ),
        "Hi, I'm frame"
      )
    }))

  test("Evaluation specs Frame.evaluate should execute after cross-site navigation", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      // The page is the main frame, so its evaluation reads whichever document is current
      assert.include(
        yield* page.evaluateInMainWorld(() => window.location.href),
        "localhost"
      )
      yield* page.goto(server.CROSS_PROCESS_PREFIX + "/empty.html", { waitUntil: "load" })
      assert.include(
        yield* page.evaluateInMainWorld(() => window.location.href),
        "127"
      )
    }))
})
