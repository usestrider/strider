/** A caller's function as the declaration an evaluation sends, for every form a function's source takes. */
import { assert, describe, it } from "@effect/vitest"
import { runInNewContext } from "node:vm"
import * as FunctionSource from "../src/internal/functionSource.ts"
import * as Utility from "../src/internal/webkitUtility.ts"

/** The declaration, evaluated in a realm of its own as a browser evaluates it, then called. */
const call = (fn: Function, ...args: ReadonlyArray<unknown>): unknown =>
  runInNewContext(`(${FunctionSource.declaration(fn)})`)(...args)

describe("FunctionSource.declaration", () => {
  it("does not split an escaped identifier into an async modifier and a key", () => {
    const method = runInNewContext(String.raw`({ async\u0061() { return 42 } }).asynca`)
    const source = FunctionSource.declaration(method)
    // An unsupported identifier may be sent unchanged, but must not change the function kind.
    if (source === method.toString()) return
    const sent = runInNewContext(`(${source})`)
    assert.strictEqual(sent.constructor.name, method.constructor.name)
    assert.strictEqual(sent(), method())
  })

  it("does not mistake division after a keyword property for a regex", () => {
    const methods = runInNewContext(
      "({ [({return: 4}).return / 2]() { return `/ ]() { return 99 /* `; /* filler */ } })"
    )
    const method = methods[2]
    const sent = FunctionSource.declaration(method)
    // Unsupported syntax may be left unchanged, but a rewrite must retain the actual body.
    if (sent === method.toString()) return
    assert.strictEqual(runInNewContext(`(${sent})`)(), method())
  })

  for (
    const [kind, source] of [
      ["quoted", "({ \"a() { return 99 } //\"() { return 42 } })"],
      ["computed", "({ [\"a() { return 99 } //\"]() { return 42 } })"]
    ]
  ) {
    it(`does not treat function-shaped text in a ${kind} key as its parameters`, () => {
      const methods = runInNewContext(source!)
      const method = methods[Reflect.ownKeys(methods)[0]!]
      const sent = runInNewContext(`(${FunctionSource.declaration(method)}\n)`)
      assert.strictEqual(sent(), method())
    })
  }

  for (
    const [kind, source] of [
      ["async method", "({ async/*comment*/read() { return 42 } }).read"],
      ["async generator", "({ async /*comment*/ *read() { yield 42 } }).read"],
      ["method named async", "({ async /*comment*/ () { return 42 } }).async"]
    ]
  ) {
    it(`preserves the function kind of a commented ${kind}`, () => {
      const method = runInNewContext(source!)
      const sent = runInNewContext(`(${FunctionSource.declaration(method)})`)
      assert.strictEqual(sent.constructor.name, method.constructor.name)
    })
  }

  for (
    const [kind, source] of [
      ["string", "({ [\"](\" + 1]() { return 42 } })"],
      ["template", "({ [`](${\"](\"}`]() { return 42 } })"],
      ["regular expression", "({ [/[\\](]/.source]() { return 42 } })"],
      ["regular expression after a keyword", "({ [typeof /]\\(/]() { return 42 } })"],
      ["division and a comment", "({ [6 / 2 /* ]( */]() { return 42 } })"]
    ]
  ) {
    it(`reads a computed key holding a ${kind} with brackets in it`, () => {
      const methods = runInNewContext(source!)
      const method = methods[Reflect.ownKeys(methods)[0]!]
      assert.strictEqual(FunctionSource.declaration(method), "function () { return 42 }")
      assert.strictEqual(call(method), 42)
    })
  }

  it("reads a conditional computed key, and a comment holding a bracket before the parameters", () => {
    const methods = runInNewContext(
      "const c = true, a = ['k']; ({ [c ? a[0] : 'b']() { return 42 }, sum /* ( */ (a, b) { return a + b } })"
    )
    assert.deepStrictEqual(
      [FunctionSource.declaration(methods.k), FunctionSource.declaration(methods.sum), call(methods.sum, 1, 2)],
      ["function () { return 42 }", "function (a, b) { return a + b }", 3]
    )
  })

  it("reads a numeric key", () => {
    const methods = runInNewContext(
      "({ 0x1f() { return 1 }, 1_000() { return 2 }, 2e+3() { return 3 }, .5() { return 4 }, 7n() { return 5 } })"
    )
    assert.deepStrictEqual(
      ["31", "1000", "2000", "0.5", "7"].map((key) => [FunctionSource.declaration(methods[key]), call(methods[key])]),
      [1, 2, 3, 4, 5].map((value) => [`function () { return ${value} }`, value])
    )
  })

  it("reads a private method's key", () => {
    const method = runInNewContext(
      "(class { static #secret(a) { return a + 1 } static get() { return this.#secret } }).get()"
    )
    assert.strictEqual(FunctionSource.declaration(method), "function (a) { return a + 1 }")
    assert.strictEqual(call(method, 41), 42)
  })

  it("sends a function expression's source unchanged", () => {
    const arrow = (a: number, b: number) => a + b
    function named(a: number) {
      return a * 2
    }
    const withComment = (a: number) => a // a trailing comment
    assert.strictEqual(FunctionSource.declaration(arrow), arrow.toString())
    assert.strictEqual(FunctionSource.declaration(named), named.toString())
    assert.strictEqual(FunctionSource.declaration(withComment), withComment.toString())
    assert.strictEqual(call(withComment, 3), 3)
  })

  it("turns every method form into a function expression", async () => {
    const key = "computed"
    const methods = {
      sum(a: number, b: number) {
        return a + b
      },
      async later(a: number) {
        return a + 1
      },
      *items() {
        yield 1
        yield 2
      },
      get size() {
        return 4
      },
      set size(_: number) {},
      [Symbol.iterator]() {
        return [].values()
      },
      [key]() {
        return "unused"
      }
    }
    const accessor = Object.getOwnPropertyDescriptor(methods, "size")!
    assert.strictEqual(call(methods.sum, 1, 2), 3)
    assert.strictEqual(await (call(methods.later, 1) as Promise<number>), 2)
    assert.deepStrictEqual([...(call(methods.items) as Iterable<number>)], [1, 2])
    assert.strictEqual(call(accessor.get!), 4)
    assert.strictEqual(call(accessor.set!, 1), undefined)
    assert.deepStrictEqual([...(call(methods[Symbol.iterator]) as Iterable<never>)], [])
  })

  it("resolves a method's free identifiers in the destination realm", () => {
    const method = runInNewContext("({ read() { return [d, p] } }).read")
    const result = runInNewContext(`(${FunctionSource.declaration(method)})()`, { d: "page:d", p: "page:p" })
    assert.deepStrictEqual(Array.from(result), ["page:d", "page:p"])
  })

  it("preserves a strict method's this value", () => {
    const method = runInNewContext("({ read() { \"use strict\"; return this } }).read")
    const sent = runInNewContext(`(${FunctionSource.declaration(method)})`)
    for (const receiver of [undefined, null, 7]) {
      assert.strictEqual(Reflect.apply(sent, receiver, []), Reflect.apply(method, receiver, []))
    }
  })

  it("keeps a method callable when WebKit stages its declaration in parts", () => {
    const method = new Function(`return { large() { /*${"x".repeat(100_000)}*/ return 42 } }.large`)()
    const source = FunctionSource.declaration(method)
    const parts = Utility.parts(source)
    assert.isDefined(parts)
    const helper = runInNewContext(Utility.source)
    parts!.forEach((part, index) => helper.stage("method", index, part))
    assert.strictEqual(helper.compile("method")(), 42)
  })

  it("keeps a method's modifiers and drops its key, whatever the key is named", async () => {
    const methods = {
      async *pairs() {
        yield await Promise.resolve(1)
      },
      async() {
        return "async"
      },
      get() {
        return "get"
      },
      "a(b"(value: number) {
        return value
      }
    }
    const pairs: Array<number> = []
    for await (const value of call(methods.pairs) as AsyncIterable<number>) pairs.push(value)
    assert.deepStrictEqual(pairs, [1])
    assert.strictEqual(FunctionSource.declaration(methods.async), `function ${methods.async.toString().slice(5)}`)
    assert.deepStrictEqual([call(methods.async), call(methods.get), call(methods["a(b"], 3)], ["async", "get", 3])
  })

  it("sends a method that uses super as it is", () => {
    // No function expression can hold `super`: the browser's SyntaxError is the evaluation's failure
    const base = { name: () => "base" }
    const derived = {
      __proto__: base,
      name() {
        return super.name()
      }
    }
    assert.strictEqual(FunctionSource.declaration(derived.name), derived.name.toString())
  })

  it("sends a source that isn't a function as it is", () => {
    // A native function's source isn't JavaScript: the browser's SyntaxError is the evaluation's failure
    assert.strictEqual(FunctionSource.declaration(Math.max), Math.max.toString())
  })
})
