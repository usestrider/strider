/**
 * Operations of your own, kept as the library keeps its: one deadline for everything inside, and a `Timeout` that
 * says how far the operation got.
 *
 * `fn` is `Effect.fn` for an operation, and `named` wraps an effect in one, as `Effect.withSpan` does. Each call
 * opens a span under the operation's name and keeps a record of what it did: its steps, the operations that ran
 * inside it, and what its body notes with `markSent` and `observe`. A `Timeout` that leaves an operation is the
 * operation's own, in the phase where it stopped.
 *
 * @stability unstable
 * @since 0.1.0
 */
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import { dual } from "effect/Function"
import type * as Deadline from "./Deadline.ts"
import type * as Diagnostics from "./Diagnostics.ts"
import * as Internal from "./internal/operation.ts"

const TypeId = "~@usestrider/browser/Operation"

/**
 * An operation that's running: what `Operation.Current` holds inside `fn` and `named`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface Operation {
  readonly [TypeId]: typeof TypeId
  /** The name it was started with, which its span and its `Timeout` carry. */
  readonly name: string
  /** Its id, which its errors' diagnostics carry. */
  readonly id: Diagnostics.OperationId
}

/**
 * The service tag for the operation that's running, which `fn` and `named` provide.
 *
 * **Details**
 *
 * `markSent`, `observe` and `bound` require it, so they compile only inside an operation, and a helper that uses
 * them says so in its requirements. Library operations read it where it's present, so one that runs inside yours is
 * a step of it.
 *
 * @stability unstable
 * @category tags
 * @since 0.1.0
 */
export class Current extends Context.Service<Current, Operation>()("@usestrider/browser/Operation/Current") {}

/**
 * Settings for an operation's span.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface Options {
  /** Attributes for the operation's span. */
  readonly attributes?: Readonly<Record<string, unknown>> | undefined
}

/**
 * Runs an effect as an operation named `name`.
 *
 * **When to use**
 *
 * Use to make a value, such as a read, an operation of its own. For a function that takes arguments, use `fn`.
 *
 * **Details**
 *
 * The operation starts when the effect runs. It reads the deadline in force once, from `Deadline.within` around it
 * or `Deadline.DefaultBudget` from then, and everything inside shares it. Its span is named for it, and
 * `Browser.SpanNameGenerator` and `Browser.TracerDisabledWhen` apply to it as to the library's.
 *
 * An operation that runs inside another is a step of it: when it ends, it joins the enclosing operation's steps.
 * Every library operation, such as a click, is one. A `Timeout` that leaves an operation is the operation's own: one
 * a step ran out with keeps the step's `phase`, `history` and `hint`, which say where it stopped, and takes the
 * operation's name, budget and diagnostics. The diagnostics list its steps in `progress`, and their `dispatch` is
 * the furthest any step got.
 *
 * **Gotchas**
 *
 * Inside the operation, a step's `Timeout` is still the step's: `Effect.catchTag("Timeout", …)` around a click
 * catches the click's.
 *
 * **Example** (A read that's an operation of its own)
 *
 * ```ts import.meta.vitest
 * import { Deadline, Operation, Page } from "@usestrider/browser"
 *
 * const cartCount = (page: Page.Page) =>
 *   page.getByTestId("cart-count").readText.pipe(
 *     Operation.named("cartCount"),
 *     Deadline.within("5 seconds")
 *   )
 * ```
 *
 * @see {@link fn} for a function whose calls are operations
 *
 * @stability unstable
 * @category combinators
 * @since 0.1.0
 */
export const named: {
  (name: string, options?: Options | undefined): <A, E, R>(
    self: Effect.Effect<A, E, R>
  ) => Effect.Effect<A, E, Exclude<R, Current>>
  <A, E, R>(
    self: Effect.Effect<A, E, R>,
    name: string,
    options?: Options | undefined
  ): Effect.Effect<A, E, Exclude<R, Current>>
} = dual(
  (args) => Effect.isEffect(args[0]),
  <A, E, R>(self: Effect.Effect<A, E, R>, name: string, options?: Options | undefined) =>
    Internal.named(name, options)(self)
)

type Run<Eff, AEff> = Effect.Effect<
  AEff,
  [Eff] extends [never] ? never : [Eff] extends [Effect.Effect<infer _A, infer E, infer _R>] ? E : never,
  [Eff] extends [never] ? never
    : [Eff] extends [Effect.Effect<infer _A, infer _E, infer R>] ? Exclude<R, Current>
    : never
>

/**
 * What `fn` returns: `Effect.fn`'s shape, a generator body and up to nine pipeables, each given the effect so far
 * and the call's arguments.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface Fn {
  <Eff extends Effect.Effect<any, any, any>, AEff, Args extends Array<any>>(
    body: (...args: Args) => Generator<Eff, AEff, never>
  ): (...args: Args) => Run<Eff, AEff>
  <Eff extends Effect.Effect<any, any, any>, AEff, Args extends Array<any>, A>(
    body: (...args: Args) => Generator<Eff, AEff, never>,
    a: (_: Run<Eff, AEff>, ...args: Args) => A
  ): (...args: Args) => A
  <Eff extends Effect.Effect<any, any, any>, AEff, Args extends Array<any>, A, B>(
    body: (...args: Args) => Generator<Eff, AEff, never>,
    a: (_: Run<Eff, AEff>, ...args: Args) => A,
    b: (_: A, ...args: Args) => B
  ): (...args: Args) => B
  <Eff extends Effect.Effect<any, any, any>, AEff, Args extends Array<any>, A, B, C>(
    body: (...args: Args) => Generator<Eff, AEff, never>,
    a: (_: Run<Eff, AEff>, ...args: Args) => A,
    b: (_: A, ...args: Args) => B,
    c: (_: B, ...args: Args) => C
  ): (...args: Args) => C
  <Eff extends Effect.Effect<any, any, any>, AEff, Args extends Array<any>, A, B, C, D>(
    body: (...args: Args) => Generator<Eff, AEff, never>,
    a: (_: Run<Eff, AEff>, ...args: Args) => A,
    b: (_: A, ...args: Args) => B,
    c: (_: B, ...args: Args) => C,
    d: (_: C, ...args: Args) => D
  ): (...args: Args) => D
  <Eff extends Effect.Effect<any, any, any>, AEff, Args extends Array<any>, A, B, C, D, E>(
    body: (...args: Args) => Generator<Eff, AEff, never>,
    a: (_: Run<Eff, AEff>, ...args: Args) => A,
    b: (_: A, ...args: Args) => B,
    c: (_: B, ...args: Args) => C,
    d: (_: C, ...args: Args) => D,
    e: (_: D, ...args: Args) => E
  ): (...args: Args) => E
  <Eff extends Effect.Effect<any, any, any>, AEff, Args extends Array<any>, A, B, C, D, E, F>(
    body: (...args: Args) => Generator<Eff, AEff, never>,
    a: (_: Run<Eff, AEff>, ...args: Args) => A,
    b: (_: A, ...args: Args) => B,
    c: (_: B, ...args: Args) => C,
    d: (_: C, ...args: Args) => D,
    e: (_: D, ...args: Args) => E,
    f: (_: E, ...args: Args) => F
  ): (...args: Args) => F
  <Eff extends Effect.Effect<any, any, any>, AEff, Args extends Array<any>, A, B, C, D, E, F, G>(
    body: (...args: Args) => Generator<Eff, AEff, never>,
    a: (_: Run<Eff, AEff>, ...args: Args) => A,
    b: (_: A, ...args: Args) => B,
    c: (_: B, ...args: Args) => C,
    d: (_: C, ...args: Args) => D,
    e: (_: D, ...args: Args) => E,
    f: (_: E, ...args: Args) => F,
    g: (_: F, ...args: Args) => G
  ): (...args: Args) => G
  <Eff extends Effect.Effect<any, any, any>, AEff, Args extends Array<any>, A, B, C, D, E, F, G, H>(
    body: (...args: Args) => Generator<Eff, AEff, never>,
    a: (_: Run<Eff, AEff>, ...args: Args) => A,
    b: (_: A, ...args: Args) => B,
    c: (_: B, ...args: Args) => C,
    d: (_: C, ...args: Args) => D,
    e: (_: D, ...args: Args) => E,
    f: (_: E, ...args: Args) => F,
    g: (_: F, ...args: Args) => G,
    h: (_: G, ...args: Args) => H
  ): (...args: Args) => H
  <Eff extends Effect.Effect<any, any, any>, AEff, Args extends Array<any>, A, B, C, D, E, F, G, H, I>(
    body: (...args: Args) => Generator<Eff, AEff, never>,
    a: (_: Run<Eff, AEff>, ...args: Args) => A,
    b: (_: A, ...args: Args) => B,
    c: (_: B, ...args: Args) => C,
    d: (_: C, ...args: Args) => D,
    e: (_: D, ...args: Args) => E,
    f: (_: E, ...args: Args) => F,
    g: (_: F, ...args: Args) => G,
    h: (_: G, ...args: Args) => H,
    i: (_: H, ...args: Args) => I
  ): (...args: Args) => I
}

/**
 * Makes a function whose calls are operations named `name`, as `Effect.fn` makes one whose calls are spans.
 *
 * **When to use**
 *
 * Use to make a helper of your own, such as a checkout, one operation: its caller gets one deadline for all of it,
 * and a `Timeout` named for it that lists its steps.
 *
 * **Details**
 *
 * `Operation.fn(name, options)(body, ...pipeables)` is `named(name, options)` around the body's effect, with the
 * pipeables around that, so a `Deadline.within` among them sets the deadline the operation reads. Everything `named`
 * says about steps and `Timeout` holds for each call.
 *
 * **Example** (A checkout whose caller sees how far it got)
 *
 * ```ts import.meta.vitest
 * import { Deadline, Expect, Operation, Page } from "@usestrider/browser"
 *
 * // A Timeout here is named "checkout", in the phase of the step that ran out, and its
 * // diagnostics list the steps, such as Locator.fill: ok and Locator.click: unsent
 * const checkout = Operation.fn("checkout")(function*(page: Page.Page, card: string) {
 *   yield* page.getByLabel("Card number").fill(card)
 *   yield* page.getByRole("button", { name: "Pay" }).click()
 *   yield* page.getByRole("heading", { name: "Order confirmed" }).pipe(Expect.toBeVisible)
 * }, Deadline.within("20 seconds"))
 * ```
 *
 * @see {@link named} for an effect that is one operation
 *
 * @stability unstable
 * @category constructors
 * @since 0.1.0
 */
export const fn = (name: string, options?: Options | undefined): Fn =>
  ((body: Function, ...pipeables: Array<Function>) =>
    Effect.fnUntraced(
      body as never,
      (effect: Effect.Effect<unknown, unknown, unknown>) => Internal.named(name, options)(effect),
      ...pipeables as []
    )) as Fn

/**
 * Notes that from here, the operation may have had an effect outside the program, such as a call to your shop's API.
 *
 * **Details**
 *
 * If the operation then runs out of time, its `Timeout` is in the phase `dispatchedUnconfirmed`, and its
 * diagnostics' `dispatch` is `MayHaveBeenSent`: the caller knows not to repeat it blindly. An operation that sends
 * and then succeeds is confirmed by succeeding, so in the operation around it, it's `ok`. Library operations note
 * their own sends; this is for yours.
 *
 * **Example** (An order placed through the shop's API, then shown)
 *
 * ```ts import.meta.vitest
 * import { Operation, Page } from "@usestrider/browser"
 * import { Effect } from "effect"
 *
 * const reorder = Operation.fn("reorder")(
 *   function*(page: Page.Page, placeOrder: Effect.Effect<string>) {
 *     yield* Operation.markSent
 *     const orderId = yield* placeOrder
 *     yield* page.goto(`https://shop.example.com/orders/${orderId}`)
 *   }
 * )
 * ```
 *
 * @stability unstable
 * @category combinators
 * @since 0.1.0
 */
export const markSent: Effect.Effect<void, never, Current> = Effect.flatMap(
  Effect.service(Current),
  (operation) => Effect.map(Internal.recordOf(operation), (record) => record.markSent())
)

/**
 * Notes why the operation isn't done yet, such as a status it read that isn't the one it waits for.
 *
 * **Details**
 *
 * Observations go into the operation's `Timeout`: `history` lists them, with consecutive repeats dropped, and `last`
 * is the latest. An operation that observed something other than `NoMatch` before it timed out without sending
 * anything is in the phase `waitingForCondition`.
 *
 * **Example** (Waiting for an order to ship)
 *
 * ```ts import.meta.vitest
 * import { Operation } from "@usestrider/browser"
 * import { Effect } from "effect"
 *
 * const awaitShipped = Operation.fn("awaitShipped")(
 *   function*(status: Effect.Effect<string>) {
 *     return yield* Operation.bound(Effect.gen(function*() {
 *       while (true) {
 *         const current = yield* status
 *         if (current === "shipped") return current
 *         yield* Operation.observe(current)
 *         yield* Effect.sleep("1 second")
 *       }
 *     }))
 *   }
 * )
 * ```
 *
 * @stability unstable
 * @category combinators
 * @since 0.1.0
 */
export const observe = (value: unknown): Effect.Effect<void, never, Current> =>
  Effect.flatMap(
    Effect.service(Current),
    (operation) => Effect.map(Internal.recordOf(operation), (record) => record.observe(value))
  )

/**
 * Waits for an effect no longer than the operation's deadline, and fails with the operation's `Timeout` when it
 * passes.
 *
 * **When to use**
 *
 * Use to end a wait of your own at the operation's deadline, such as for your backend to confirm an order. Library
 * operations already end there.
 *
 * **Details**
 *
 * The deadline is on the clock the browser runs on, as every deadline is: under `TestClock`, a real browser's still
 * passes. When it passes, the effect is interrupted, and the `Timeout`'s phase follows from what the operation
 * recorded: `postcondition` after a step that sent succeeded, `dispatchedUnconfirmed` after `markSent`,
 * `waitingForCondition` after `observe`, and `resolving` before any of them.
 *
 * **Example** (Waiting for the backend after a payment)
 *
 * ```ts import.meta.vitest
 * import { Deadline, Operation, Page } from "@usestrider/browser"
 * import { Effect } from "effect"
 *
 * // Past the deadline, the Timeout is in the phase postcondition: the click went out,
 * // and the confirmation didn't come
 * const pay = Operation.fn("pay")(
 *   function*(page: Page.Page, confirmed: Effect.Effect<string>) {
 *     yield* page.getByRole("button", { name: "Pay" }).click()
 *     return yield* Operation.bound(confirmed)
 *   },
 *   Deadline.within("20 seconds")
 * )
 * ```
 *
 * @stability unstable
 * @category combinators
 * @since 0.1.0
 */
export const bound = <A, E, R>(
  self: Effect.Effect<A, E, R>
): Effect.Effect<A, E | Deadline.Timeout, R | Current> =>
  Effect.flatMap(
    Effect.service(Current),
    (operation) => Effect.flatMap(Internal.recordOf(operation), (record) => record.bound(self))
  )
