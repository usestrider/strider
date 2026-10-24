/**
 * Retrying expectations: each `Expect.to*` checks until it passes or the deadline ends.
 *
 * A locator's expectation waits in the page (review 16, candidate 7): it checks once, then again on each change
 * the page makes (a DOM mutation, an `input`, `change` or focus event, an animation frame), so there is no
 * polling cadence and no change is missed between checks. A page's URL is a `Watchable`, checked on each
 * change. `Expect.that` checks a `Watchable` on each change, and runs any other effect again at
 * `CheckInterval`. Everything runs on the live clock, within the deadline. Collecting several failures is
 * Effect's job: `Effect.validate`, or `Effect.all(…, { mode: "result" })`.
 *
 * Matchers that take arguments are duals: `locator.pipe(Expect.toHaveText("1 item"))` or
 * `Expect.toHaveText(locator, "1 item")`. Matchers without arguments are the function itself:
 * `locator.pipe(Expect.toBeVisible)`.
 *
 * @stability unstable
 * @since 0.1.0
 */
import * as Context from "effect/Context"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import { dual } from "effect/Function"
import * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"
import * as Schema from "effect/Schema"
import * as Stream from "effect/Stream"
import type * as AriaPattern from "./AriaPattern.ts"
import type * as Condition from "./Condition.ts"
import * as Deadline from "./Deadline.ts"
import * as Diagnostics from "./Diagnostics.ts"
import { now } from "./internal/adapter.ts"
import * as AriaPatterns from "./internal/ariaPattern.ts"
import * as ConditionImpl from "./internal/condition.ts"
import type * as Engine from "./internal/engine.ts"
import * as Handles from "./internal/handles.ts"
import { LocatorImpl } from "./internal/locator.ts"
import type * as Model from "./internal/model.ts"
import * as Operation from "./internal/operation.ts"
import * as Runtime from "./internal/runtime.ts"
import { describeSteps } from "./internal/steps.ts"
import type * as Locator from "./Locator.ts"
import type * as MonotonicInstant from "./MonotonicInstant.ts"
import type * as Page from "./Page.ts"
import type * as Target from "./Target.ts"
import type * as Watchable from "./Watchable.ts"

/**
 * A matcher with no arguments: the expectation itself.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type Matcher<S> = (subject: S) => Effect.Effect<void, ExpectationFailed | Target.TargetGone>

/**
 * A matcher with arguments, usable data-first or in `pipe`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface DualMatcher<S, Args extends ReadonlyArray<unknown>> {
  (...args: Args): (subject: S) => Effect.Effect<void, ExpectationFailed | Target.TargetGone>
  (subject: S, ...args: Args): Effect.Effect<void, ExpectationFailed | Target.TargetGone>
}

/**
 * Expects the one match to be visible.
 *
 * **Example** (Waiting for a welcome message)
 *
 * ```ts import.meta.vitest
 * import { Effect } from "effect"
 * import { Expect, Page } from "@usestrider/browser"
 *
 * const welcomed = Effect.fn("welcomed")(function*(page: Page.ReadonlyPage) {
 *   yield* page.getByText("Welcome").pipe(Expect.toBeVisible)
 * })
 * ```
 *
 * @stability unstable
 * @category matchers
 * @since 0.1.0
 */
export const toBeVisible: Matcher<Locator.ReadonlyLocator> = (locator) =>
  expectLocator(locator, { _tag: "Visible" }, "toBeVisible", "to be visible")

/**
 * Expects the element to be hidden; passes when it is missing too.
 *
 * @stability unstable
 * @category matchers
 * @since 0.1.0
 */
export const toBeHidden: Matcher<Locator.ReadonlyLocator> = (locator) =>
  expectLocator(locator, { _tag: "Hidden" }, "toBeHidden", "to be hidden")

/**
 * Expects the one match to be enabled.
 *
 * @stability unstable
 * @category matchers
 * @since 0.1.0
 */
export const toBeEnabled: Matcher<Locator.ReadonlyLocator> = (locator) =>
  expectLocator(locator, { _tag: "Enabled" }, "toBeEnabled", "to be enabled")

/**
 * Expects the one match to be disabled.
 *
 * @stability unstable
 * @category matchers
 * @since 0.1.0
 */
export const toBeDisabled: Matcher<Locator.ReadonlyLocator> = (locator) =>
  expectLocator(locator, { _tag: "Disabled" }, "toBeDisabled", "to be disabled")

/**
 * Expects the one match to be checked.
 *
 * @stability unstable
 * @category matchers
 * @since 0.1.0
 */
export const toBeChecked: Matcher<Locator.ReadonlyLocator> = (locator) =>
  expectLocator(locator, { _tag: "Checked" }, "toBeChecked", "to be checked")

/**
 * Expects the one match to have focus.
 *
 * @stability unstable
 * @category matchers
 * @since 0.1.0
 */
export const toBeFocused: Matcher<Locator.ReadonlyLocator> = (locator) =>
  expectLocator(locator, { _tag: "Focused" }, "toBeFocused", "to have focus")

/**
 * Expects the one match to accept input.
 *
 * @stability unstable
 * @category matchers
 * @since 0.1.0
 */
export const toBeEditable: Matcher<Locator.ReadonlyLocator> = (locator) =>
  expectLocator(locator, { _tag: "Editable" }, "toBeEditable", "to be editable")

/**
 * Expects the rendered text to match: of the one match, or of each match in order when given a list.
 *
 * @stability unstable
 * @category matchers
 * @since 0.1.0
 */
export const toHaveText: DualMatcher<
  Locator.ReadonlyLocator,
  [expected: string | RegExp | ReadonlyArray<string | RegExp>]
> = dual(2, (locator: Locator.ReadonlyLocator, expected: string | RegExp | ReadonlyArray<string | RegExp>) => {
  const list = Array.isArray(expected)
  const all = (list ? expected : [expected]) as ReadonlyArray<string | RegExp>
  return expectLocator(
    locator,
    { _tag: "Text", expected: all.map((each) => matcher(each, true)), list },
    "toHaveText",
    `to have the text ${list ? `[${all.map(show).join(", ")}]` : show(all[0]!)}`
  )
})

/**
 * Expects the rendered text of the one match to contain `expected`.
 *
 * @stability unstable
 * @category matchers
 * @since 0.1.0
 */
export const toContainText: DualMatcher<Locator.ReadonlyLocator, [expected: string | RegExp]> = dual(
  2,
  (locator: Locator.ReadonlyLocator, expected: string | RegExp) =>
    expectLocator(
      locator,
      { _tag: "ContainsText", expected: matcher(expected, false) },
      "toContainText",
      `to contain the text ${show(expected)}`
    )
)

/**
 * Expects the value of the one matching form control to match.
 *
 * @stability unstable
 * @category matchers
 * @since 0.1.0
 */
export const toHaveValue: DualMatcher<Locator.ReadonlyLocator, [expected: string | RegExp]> = dual(
  2,
  (locator: Locator.ReadonlyLocator, expected: string | RegExp) =>
    expectLocator(
      locator,
      { _tag: "Value", expected: matcher(expected, true) },
      "toHaveValue",
      `to have the value ${show(expected)}`
    )
)

/**
 * Expects the one match to have the attribute, with a matching value when one is given.
 *
 * @stability unstable
 * @category matchers
 * @since 0.1.0
 */
export const toHaveAttribute: DualMatcher<
  Locator.ReadonlyLocator,
  [name: string, expected?: string | RegExp | undefined]
> = dual(
  (args) => args[0] instanceof LocatorImpl,
  (locator: Locator.ReadonlyLocator, name: string, expected?: string | RegExp) =>
    expectLocator(
      locator,
      { _tag: "Attribute", name, expected: expected === undefined ? null : matcher(expected, true) },
      "toHaveAttribute",
      `to have the attribute ${name}${expected === undefined ? "" : ` ${show(expected)}`}`
    )
)

/**
 * Expects exactly `count` matches.
 *
 * @stability unstable
 * @category matchers
 * @since 0.1.0
 */
export const toHaveCount: DualMatcher<Locator.ReadonlyLocator, [count: number]> = dual(
  2,
  (locator: Locator.ReadonlyLocator, count: number) =>
    expectLocator(
      locator,
      { _tag: "Count", count },
      "toHaveCount",
      `to match ${count} element${count === 1 ? "" : "s"}`
    )
)

/**
 * Expects the one match's accessibility tree to match a pattern.
 *
 * **Example** (A navigation with an Orders link)
 *
 * ```ts import.meta.vitest
 * import { AriaPattern, Expect, Page } from "@usestrider/browser"
 *
 * const hasOrdersLink = (page: Page.ReadonlyPage) =>
 *   page.getByRole("navigation").pipe(Expect.toMatchAria(
 *     AriaPattern.node("navigation", "Main", AriaPattern.including(
 *       AriaPattern.node("link", "Orders", AriaPattern.unchecked)
 *     ))
 *   ))
 * ```
 *
 * @stability unstable
 * @category matchers
 * @since 0.1.0
 */
export const toMatchAria: DualMatcher<Locator.ReadonlyLocator, [pattern: AriaPattern.AriaPattern]> = dual(
  2,
  (locator: Locator.ReadonlyLocator, pattern: AriaPattern.AriaPattern) => {
    const data = AriaPatterns.pattern(pattern)
    return expectLocator(
      locator,
      { _tag: "Aria", pattern: data },
      "toMatchAria",
      `to match ${AriaPatterns.describe(data)}`
    )
  }
)

/**
 * Expects the page's URL to match.
 *
 * @stability unstable
 * @category matchers
 * @since 0.1.0
 */
export const toHaveURL: DualMatcher<Page.ReadonlyPage, [expected: string | RegExp]> = dual(
  2,
  (page: Page.ReadonlyPage, expected: string | RegExp) =>
    watching(
      page.url,
      (url: string) =>
        typeof expected === "string" ? url === expected : new RegExp(expected.source, expected.flags).test(url),
      "toHaveURL",
      `page ${page.id}`,
      `to have the URL ${show(expected)}`
    )
)

/**
 * Expects the page's title to match.
 *
 * @stability unstable
 * @category matchers
 * @since 0.1.0
 */
export const toHaveTitle: DualMatcher<Page.ReadonlyPage, [expected: string | RegExp]> = dual(
  2,
  (page: Page.ReadonlyPage, expected: string | RegExp) => {
    const { entry, runtime } = Handles.page(page)
    return expectIn(
      { runtime, page: entry, steps: [], description: `page ${page.id}` },
      { _tag: "Title", expected: matcher(expected, true) },
      "toHaveTitle",
      `to have the title ${show(expected)}`
    )
  }
)

/**
 * Expects any subject to satisfy a condition, checking until it does or the deadline ends.
 *
 * **Details**
 *
 * A `Watchable` subject is checked again on each change. Any other effect is run again at the check
 * interval.
 *
 * **Example** (A download that finishes)
 *
 * ```ts import.meta.vitest
 * import { Effect } from "effect"
 * import { Condition, Download, Expect } from "@usestrider/browser"
 *
 * const completed = (download: Download.Download) =>
 *   Expect.that(download.status, Condition.make("completed", (status) => status._tag === "Completed"))
 * ```
 *
 * @stability unstable
 * @category matchers
 * @since 0.1.0
 */
export const that = <A, E, R>(
  subject: Effect.Effect<A, E, R>,
  condition: Condition.Condition<A>
): Effect.Effect<void, E | ExpectationFailed | Target.TargetGone, R> =>
  Predicate.hasProperty(subject, "~@usestrider/browser/Watchable")
    ? watching(
      subject as unknown as Watchable.Watchable<A>,
      (value: A) => ConditionImpl.holds(condition, value),
      "that",
      "the subject",
      ConditionImpl.describe(condition)
    )
    : polling(subject, condition)

/**
 * Reference to how often a subject with no change signal is checked again; 100 ms unless set.
 *
 * @stability unstable
 * @category references
 * @since 0.1.0
 */
export const CheckInterval: Context.Reference<Duration.Duration> = Context.Reference<Duration.Duration>(
  "@usestrider/browser/Expect/CheckInterval",
  { defaultValue: () => Duration.millis(100) }
)

/**
 * Sets the check interval for every expectation inside an effect.
 *
 * @see {@link CheckInterval} for the reference it sets
 *
 * @stability unstable
 * @category combinators
 * @since 0.1.0
 */
export const withCheckInterval: {
  (interval: Duration.Input): <A, E, R>(self: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>
  <A, E, R>(self: Effect.Effect<A, E, R>, interval: Duration.Input): Effect.Effect<A, E, R>
} = dual(
  2,
  <A, E, R>(self: Effect.Effect<A, E, R>, interval: Duration.Input): Effect.Effect<A, E, R> =>
    Effect.provideService(self, CheckInterval, Duration.fromInputUnsafe(interval))
)

const ExpectationFailedTypeId = "~@usestrider/browser/Expect/ExpectationFailed"

/**
 * Error for an expectation that didn't pass before the deadline.
 *
 * **Details**
 *
 * - `last` and `history` are the de-duplicated observations, which answer "was it ever right?".
 * - `checks` says how many checks ran and what triggered them.
 * - `nearest` is a snapshot of the nearest existing ancestor when nothing matched.
 * - `suggestions` are locators that would have matched.
 *
 * @stability unstable
 * @category errors
 * @since 0.1.0
 */
export class ExpectationFailed extends Schema.TaggedError<ExpectationFailed>(ExpectationFailedTypeId)(
  "ExpectationFailed",
  {
    subject: Schema.String,
    condition: Schema.String,
    last: Schema.Option(Diagnostics.ObservedValue),
    history: Schema.Array(Diagnostics.ObservedValue),
    elapsed: Schema.Duration,
    checks: Schema.Struct({
      count: Schema.Int,
      triggeredBy: Schema.Array(Schema.Literals(["initial", "change", "interval"]))
    }),
    nearest: Schema.Option(Schema.String),
    suggestions: Schema.Array(Schema.String),
    diagnostics: Diagnostics.Diagnostics
  }
) {
  readonly [ExpectationFailedTypeId] = ExpectationFailedTypeId
  override get message(): string {
    return `Expected ${this.subject} ${this.condition}`
  }
}

/**
 * Checks whether a value is an `ExpectationFailed`.
 *
 * @stability unstable
 * @category guards
 * @since 0.1.0
 */
export const isExpectationFailed = (u: unknown): u is ExpectationFailed =>
  Predicate.hasProperty(u, ExpectationFailedTypeId)

// ── Implementation ──

const show = (expected: string | RegExp) => typeof expected === "string" ? JSON.stringify(expected) : String(expected)

/** A string compared whole (`exact`) or contained, or a `RegExp` tested as given. */
const matcher = (expected: string | RegExp, exact: boolean): Engine.TextMatcher =>
  typeof expected === "string"
    ? { _tag: "String", value: expected, exact }
    : { _tag: "RegExp", source: expected.source, flags: expected.flags }

/** What a failed expectation says, from what it saw. */
const failure = (
  id: Diagnostics.OperationId,
  subject: string,
  condition: string,
  started: number,
  history: ReadonlyArray<Diagnostics.ObservedValue>,
  checks: number,
  triggers: ReadonlySet<"initial" | "change" | "interval">,
  explained: Explained = { nearest: Option.none(), suggestions: [] }
) =>
  new ExpectationFailed({
    subject,
    condition,
    last: Option.fromNullishOr(history.at(-1)),
    history: [...history],
    elapsed: Duration.millis((now() - started) / 1e6),
    checks: { count: checks, triggeredBy: Array.from(triggers) },
    nearest: explained.nearest,
    suggestions: explained.suggestions,
    diagnostics: Operation.diagnostics(id, { last: Option.fromNullishOr(history.at(-1)) })
  })

/** What a failed expectation says when nothing matched its locator (review 18, candidate 4). */
interface Explained {
  readonly nearest: Option.Option<string>
  readonly suggestions: ReadonlyArray<string>
}

/** How long explaining a failure may take, past the expectation's deadline. */
const explainBudget = 1000

/**
 * Why a locator matched nothing: the accessibility text of what the longest matching prefix of its steps found,
 * and locators for elements near it with the role it asked for and a close name. Nothing when it matches now.
 */
const explain = (subject: InPage, id: Diagnostics.OperationId): Effect.Effect<Explained> => {
  const none: Explained = { nearest: Option.none(), suggestions: [] }
  if (subject.steps.length === 0) return Effect.succeed(none)
  const at = (now() + explainBudget * 1e6) as MonotonicInstant.MonotonicInstant
  return Runtime.send(subject.runtime, subject.page, { op: "explain", steps: subject.steps }, id, at).pipe(
    Effect.map((response): Explained => {
      if (response._tag !== "Explained" || response.matched) return none
      const boundary = subject.steps.findLastIndex((step) => step._tag === "Frame")
      const frames = subject.steps.slice(0, boundary + 1)
      const last = subject.steps.slice(boundary + 1)
      return {
        nearest: Option.fromNullishOr(response.nearest),
        suggestions: response.suggestions.map((suggestion) =>
          `page.${
            describeSteps([...frames, ...last.slice(0, response.prefix), {
              _tag: "Role",
              role: suggestion.role,
              name: { _tag: "String", value: suggestion.name, exact: true },
              includeHidden: false
            }])
          }`
        )
      }
    }),
    Effect.orElseSucceed(() => none)
  )
}

interface InPage {
  readonly runtime: Runtime.Runtime
  readonly page: Model.PageEntry
  readonly steps: ReadonlyArray<Engine.Step>
  readonly description: string
}

const expectLocator = (
  subject: Locator.ReadonlyLocator,
  expectation: Engine.Expectation,
  matcherName: string,
  condition: string
) =>
  Effect.suspend(() => {
    if (!(subject instanceof LocatorImpl)) return Effect.die(new Error("Expect: not a locator of this library"))
    return expectIn(
      {
        runtime: subject.owner.runtime,
        page: subject.owner.page,
        steps: subject.steps,
        description: subject.description
      },
      expectation,
      matcherName,
      condition
    )
  })

/**
 * An expectation that waits in the page (review 16, candidate 7): rounds of up to a second, each checking once
 * and then again on each change the page makes, until it holds or the deadline ends.
 */
const expectIn = (subject: InPage, expectation: Engine.Expectation, matcherName: string, condition: string) =>
  Effect.gen(function*() {
    const id = Operation.operationId()
    const budget = yield* Operation.budget
    const started = now()
    const history: Array<Diagnostics.ObservedValue> = []
    const triggers = new Set<"initial" | "change" | "interval">(["initial"])
    let checks = 0
    const failed = () =>
      Effect.flatMap(
        // A count or absence is about matching nothing, and a title has no locator: nothing to explain
        expectation._tag === "Count" || expectation._tag === "Hidden" || expectation._tag === "Title"
          ? Effect.succeed<Explained>({ nearest: Option.none(), suggestions: [] })
          : explain(subject, id),
        (explained) =>
          Effect.fail(failure(id, subject.description, condition, started, history, checks, triggers, explained))
      )
    while (true) {
      const left = Operation.millisLeft(budget.at)
      if (left <= 0 && checks > 0) return yield* failed()
      checks++
      const response = yield* Runtime.send(
        subject.runtime,
        subject.page,
        { op: "expect", steps: subject.steps, expectation, cap: Math.max(0, Math.min(1000, left)) },
        id,
        budget.at
      ).pipe(
        Effect.map((response): Engine.Response | { readonly error: string; readonly final: boolean } => response),
        Effect.catch((
          failure
        ): Effect.Effect<{ readonly error: string; readonly final: boolean } | null, Target.TargetGone> =>
          failure._tag === "Gone"
            ? Effect.fail(failure.error)
            : failure._tag === "Deadline"
            ? Effect.succeed(null)
            // A dialog nothing will decide holds the page until someone else decides it
            : Effect.succeed({ error: failure.reason.message, final: failure.reason._tag === "PromptBlocking" })
        )
      )
      if (response === null) return yield* failed()
      if ("error" in response) {
        Operation.appendObservation(history, { error: response.error })
        if (response.final) return yield* failed()
        continue
      }
      switch (response._tag) {
        case "Expected":
          Operation.appendObservation(history, response.observed)
          if (response.changed) triggers.add("change")
          if (response.passed) return
          break
        case "InvalidSelector":
          // A selector that doesn't parse never will
          Operation.appendObservation(history, {
            error: `invalid selector ${JSON.stringify(response.selector)}: ${response.message}`
          })
          return yield* failed()
        case "Strict":
          // An iframe on the way matches more than one element (review 18, candidate 2): waiting may narrow it
          Operation.appendObservation(history, { error: `an iframe on the way matches ${response.count} elements` })
          break
        case "StaleRef":
          // A ref never rebinds, so waiting can't mend it (review 18, candidate 3)
          Operation.appendObservation(history, { error: `stale ref (${response.why})` })
          return yield* failed()
        case "Final":
          // An iframe on the way that isn't one never will be
          Operation.appendObservation(history, { error: `${response.final.element} on the way isn't an iframe` })
          return yield* failed()
        default:
          Operation.appendObservation(history, { error: `unexpected answer ${response._tag}` })
      }
    }
  }).pipe(Effect.withSpan(`Expect.${matcherName}`, { attributes: { "browser.subject": subject.description } }))

/** An expectation on a `Watchable`: its value now, then each change, until it holds or the deadline ends. */
const watching = <A>(
  subject: Watchable.Watchable<A>,
  holds: (value: A) => boolean,
  matcherName: string,
  description: string,
  condition: string
): Effect.Effect<void, ExpectationFailed | Target.TargetGone> =>
  Effect.gen(function*() {
    const id = Operation.operationId()
    const budget = yield* Operation.budget
    const started = now()
    const history: Array<Diagnostics.ObservedValue> = []
    const triggers = new Set<"initial" | "change" | "interval">(["initial"])
    let checks = 0
    const found = yield* subject.changes.pipe(
      Stream.filter((value) => {
        checks++
        if (checks > 1) triggers.add("change")
        Operation.appendObservation(history, value)
        return holds(value)
      }),
      Stream.runHead,
      Effect.timeoutOption(Operation.millisLeft(budget.at))
    )
    if (Option.isSome(found) && Option.isSome(found.value)) return
    return yield* Effect.fail(failure(id, description, condition, started, history, checks, triggers))
  }).pipe(Effect.withSpan(`Expect.${matcherName}`, { attributes: { "browser.subject": description } }))

/**
 * An expectation on any other effect: run again at `CheckInterval` until its value holds or the deadline ends.
 * The subject runs under the expectation's deadline, so a check still running at it, or failing with it, is a
 * check that didn't finish, and the expectation fails with what the others saw.
 */
const polling = Effect.fn("Expect.that")(
  function*<A, E, R>(subject: Effect.Effect<A, E, R>, condition: Condition.Condition<A>) {
    const id = Operation.operationId()
    const budget = yield* Operation.budget
    const interval = Duration.toMillis(yield* Effect.service(CheckInterval))
    const started = now()
    const history: Array<Diagnostics.ObservedValue> = []
    const triggers = new Set<"initial" | "change" | "interval">(["initial"])
    let checks = 0
    const failed = () =>
      failure(id, "the subject", ConditionImpl.describe(condition), started, history, checks, triggers)
    while (true) {
      checks++
      const checked = yield* Operation.under(subject, budget.at).pipe(
        Effect.map(Option.some),
        // A shorter deadline inside the subject is the subject's own failure
        Effect.catchIf(
          (error: E) => Deadline.isTimeout(error) && Operation.millisLeft(budget.at) <= 0,
          () => Effect.succeedNone
        ),
        Effect.timeoutOption(Operation.millisLeft(budget.at)),
        Effect.map(Option.flatten)
      )
      if (Option.isNone(checked)) {
        Operation.appendObservation(history, { error: "a check was still running at the deadline" })
        return yield* Effect.fail(failed())
      }
      Operation.appendObservation(history, checked.value)
      if (ConditionImpl.holds(condition, checked.value)) return
      const left = Operation.millisLeft(budget.at)
      if (left <= 0) return yield* Effect.fail(failed())
      triggers.add("interval")
      yield* Effect.sleep(Math.min(interval, left))
    }
  }
)
