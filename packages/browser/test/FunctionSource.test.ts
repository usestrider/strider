/** A caller's function as the declaration an evaluation sends, for every form a function's source takes. */
import { assert, describe, it } from "@effect/vitest"
import { runInNewContext } from "node:vm"
import * as FunctionSource from "../src/internal/functionSource.ts"

/** The declaration, evaluated in a realm of its own as a browser evaluates it, then called. */
const call = (fn: Function, ...args: ReadonlyArray<unknown>): unknown =>
  runInNewContext(`(${FunctionSource.declaration(fn)})`)(...args)

describe("FunctionSource.declaration", () => {
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

  it("sends a source that isn't a function as it is", () => {
    // A native function's source isn't JavaScript: the browser's SyntaxError is the evaluation's failure
    assert.strictEqual(FunctionSource.declaration(Math.max), Math.max.toString())
  })
})
