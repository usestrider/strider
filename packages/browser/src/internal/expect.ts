/**
 * The expectations behind `Expect`: the round that waits in the page, the wait on a `Watchable`, the poll of any
 * other effect, and what a failed expectation says.
 */
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Stream from "effect/Stream"
import type * as AriaPattern from "../AriaPattern.ts"
import type * as Condition from "../Condition.ts"
import * as Deadline from "../Deadline.ts"
import * as Diagnostics from "../Diagnostics.ts"
import * as Expect from "../Expect.ts"
import * as Locator from "../Locator.ts"
import type * as Page from "../Page.ts"
import type * as Reason from "../Reason.ts"
import type * as Target from "../Target.ts"
import type * as Watchable from "../Watchable.ts"
import * as Access from "./access.ts"
import { now } from "./adapter.ts"
import * as AriaPatterns from "./ariaPattern.ts"
import * as BrowserClock from "./browserClock.ts"
import * as ConditionImpl from "./condition.ts"
import type * as Engine from "./engine.ts"
import type * as Execution from "./execution.ts"
import * as Sources from "./expectSource.ts"
import * as Handles from "./handles.ts"
import type { LocatorImpl } from "./locator.ts"
import type * as Model from "./model.ts"
import * as Operation from "./operation.ts"
import * as Runtime from "./runtime.ts"
import { describeSteps } from "./steps.ts"

export const show = (expected: string | RegExp) =>
  typeof expected === "string" ? JSON.stringify(expected) : String(expected)

/** A string compared whole (`exact`) or contained, or a `RegExp` tested as given. */
export const matcher = (expected: string | RegExp, exact: boolean): Engine.TextMatcher =>
  typeof expected === "string"
    ? { _tag: "String", value: expected, exact }
    : { _tag: "RegExp", source: expected.source, flags: expected.flags }

/** Export classification follows the failure's identity, including catches and rethrows outside its operation. */
export type EvidenceKind = "URL" | "Title" | "Value" | "Other" | "SourceURL" | "SourceTitle"

const evidenceKinds = new WeakMap<Expect.ExpectationFailed, EvidenceKind>()

/** First classification wins; recording an enclosing operation can never reclassify its failure. */
export const classifyFailure = (
  error: Expect.ExpectationFailed,
  matcherName: string,
  source?: object
): Expect.ExpectationFailed => {
  if (!evidenceKinds.has(error)) {
    evidenceKinds.set(
      error,
      matcherName === "toHaveURL"
        ? "URL"
        : matcherName === "toHaveTitle"
        ? "Title"
        : (matcherName === "toHaveValue" || matcherName === "toHaveValues")
        ? "Value"
        : Sources.kind(source) ?? "Other"
    )
  }
  return error
}

/** Metadata lives as long as its failure; it does not keep the failure alive or change the public error. */
export const evidenceKind = (error: Expect.ExpectationFailed): EvidenceKind | undefined => evidenceKinds.get(error)

/** What a failed expectation says, from what it saw. */
const failure = (
  id: Diagnostics.OperationId,
  subject: string,
  condition: string,
  started: number,
  history: ReadonlyArray<Diagnostics.ObservedValue>,
  checks: number,
  triggers: ReadonlySet<"initial" | "change" | "interval">,
  explained: Explained = { nearest: Option.none(), suggestions: [] },
  matcherName: string = "that",
  source?: object,
  handlerFailure?: Reason.LocatorHandlerFailed
) =>
  classifyFailure(
    new Expect.ExpectationFailed({
      subject,
      condition,
      ...(handlerFailure === undefined ? {} : { handlerFailure }),
      last: Option.fromNullishOr(history.at(-1)),
      history: [...history],
      elapsed: Duration.millis((now() - started) / 1e6),
      checks: { count: checks, triggeredBy: Array.from(triggers) },
      nearest: explained.nearest,
      suggestions: explained.suggestions,
      diagnostics: Operation.diagnostics(id, { last: Option.fromNullishOr(history.at(-1)) })
    }),
    matcherName,
    source
  )

/** What a failed expectation says when nothing matched its locator. */
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
  // After the expectation's deadline, under a budget of its own
  return Effect.flatMap(
    Operation.record,
    (record) =>
      Runtime.send(subject.runtime, subject.page, { op: "explain", steps: subject.steps }, id, record.budget.at)
  ).pipe(
    Operation.apart("Expect.explain", Duration.millis(explainBudget)),
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
  /** The grant the subject's handle was made under. */
  readonly grant: Option.Option<Access.Grant>
  readonly steps: ReadonlyArray<Engine.Step>
  readonly description: string
}

/** An expectation on a locator, in its page. */
export const expectLocator = (
  subject: Locator.ReadonlyLocator,
  expectation: Engine.Expectation,
  matcherName: string,
  condition: string
) =>
  Effect.suspend(() => {
    if (!Locator.isLocator(subject)) return Effect.die(new Error("Expect: not a locator of this library"))
    const { description, owner, steps } = subject as LocatorImpl
    return expectIn(
      { runtime: owner.runtime, page: owner.page, grant: owner.grant, steps, description },
      expectation,
      matcherName,
      condition
    )
  })

/**
 * An expectation that waits in the page: rounds of up to a second, each checking once
 * and then again on each change the page makes, until it holds or the deadline ends.
 */
export const expectIn = (subject: InPage, expectation: Engine.Expectation, matcherName: string, condition: string) =>
  expectUsing(subject, expectation, matcherName, condition, (cap, record, provisional) =>
    subject.page.execution.expect(
      subject.runtime,
      subject.page,
      { op: "expect", steps: subject.steps, expectation, cap, ...(provisional ? { provisional } : {}) },
      record.id,
      record.budget.at
    ))

const expectUsing = (
  subject: InPage,
  expectation: Engine.Expectation | Engine.CooperativeURLRequest["expectation"],
  matcherName: string,
  condition: string,
  execute: (
    cap: number,
    record: Operation.Record,
    provisional: boolean
  ) => Effect.Effect<Engine.Response, Execution.Failure>
) =>
  Effect.gen(function*() {
    yield* Access.check(subject.grant)
    const record = yield* Operation.record
    const id = record.id
    const started = now()
    const history: Array<Diagnostics.ObservedValue> = []
    const triggers = new Set<"initial" | "change" | "interval">(["initial"])
    let checks = 0
    // Whether the last observation is provisional, so the next round answers with the first complete one
    let provisional = false
    const failed = (handlerFailure?: Reason.LocatorHandlerFailed) =>
      Effect.flatMap(
        // A count or absence is about matching nothing, and a title has no locator: nothing to explain
        handlerFailure !== undefined || expectation._tag === "Count" || expectation._tag === "Hidden" ||
          expectation._tag === "Detached" || expectation._tag === "Title" || expectation._tag === "URL"
          ? Effect.succeed<Explained>({ nearest: Option.none(), suggestions: [] })
          : explain(subject, id),
        (explained) =>
          Effect.fail(
            failure(
              id,
              subject.description,
              condition,
              started,
              history,
              checks,
              triggers,
              explained,
              matcherName,
              undefined,
              handlerFailure
            )
          )
      )
    while (true) {
      const left = record.left()
      if (left <= 0 && checks > 0) return yield* failed()
      checks++
      const response: Engine.Response | { readonly error: string; readonly final: boolean } | null = yield* execute(
        checks === 1 ? 0 : Runtime.roundCap(left),
        record,
        provisional
      ).pipe(
        Effect.map((response): Engine.Response | { readonly error: string; readonly final: boolean } => response),
        Effect.catch((
          failure
        ): Effect.Effect<
          { readonly error: string; readonly final: boolean } | null,
          Target.TargetGone | Deadline.Timeout | Expect.ExpectationFailed
        > =>
          failure._tag === "Timeout" || failure._tag === "TargetGone" ?
            Effect.fail(failure)
            : failure._tag === "Reason" && failure.reason._tag === "LocatorHandlerFailed" ?
            failed(failure.reason)
            : failure._tag === "Gone"
            ? Effect.fail(failure.error)
            : failure._tag === "Deadline"
            ? Effect.succeed(null)
            // A dialog nothing will decide holds the page until someone else decides it
            : Effect.succeed({ error: failure.reason.message, final: failure.reason._tag === "PromptBlocking" })
        )
      )
      if (response === null) return yield* failed()
      provisional = !("error" in response) && response._tag === "Expected" && response.provisional === true
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
          // An iframe on the way matches more than one element: waiting may narrow it
          Operation.appendObservation(history, { error: `an iframe on the way matches ${response.count} elements` })
          break
        case "StaleRef":
          // A ref never rebinds, so waiting can't mend it
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
  }).pipe(Operation.named(`Expect.${matcherName}`, {
    attributes: { "browser.page.id": subject.page.id, "browser.subject": subject.description }
  }))

/** An expectation on a `Watchable`: its value now, then each change, until it holds or the deadline ends. */
export const watching = <A>(
  subject: Watchable.Watchable<A>,
  holds: (value: A) => boolean,
  matcherName: string,
  description: string,
  condition: string,
  attributes: Readonly<Record<string, unknown>> = {}
): Effect.Effect<void, Expect.ExpectationFailed | Target.TargetGone> =>
  Effect.gen(function*() {
    const record = yield* Operation.record
    const id = record.id
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
      BrowserClock.until(record.budget.at)
    )
    if (Option.isSome(found) && Option.isSome(found.value)) return
    return yield* Effect.fail(
      failure(id, description, condition, started, history, checks, triggers, undefined, matcherName, subject)
    )
  }).pipe(Operation.named(`Expect.${matcherName}`, { attributes: { ...attributes, "browser.subject": description } }))

/**
 * An expectation on any other effect: run again at `CheckInterval` until its value holds or the deadline ends.
 * The subject runs under the expectation's deadline, so a check still running at it, or failing with it, is a
 * check that didn't finish, and the expectation fails with what the others saw.
 */
export const polling = Operation.fn("Expect.that")(
  function*<A, E, R>(subject: Effect.Effect<A, E, R>, condition: Condition.Condition<A>) {
    const record = yield* Operation.record
    const id = record.id
    const budget = record.budget
    const interval = Duration.toMillis(yield* Effect.service(Expect.CheckInterval))
    const started = now()
    const history: Array<Diagnostics.ObservedValue> = []
    const triggers = new Set<"initial" | "change" | "interval">(["initial"])
    let checks = 0
    const failed = () =>
      failure(
        id,
        "the subject",
        ConditionImpl.describe(condition),
        started,
        history,
        checks,
        triggers,
        undefined,
        "that",
        subject
      )
    while (true) {
      checks++
      const checked = yield* Operation.under(subject, budget.at).pipe(
        Effect.map(Option.some),
        // A shorter deadline inside the subject is the subject's own failure
        Effect.catchIf(
          (error: E) => Deadline.isTimeout(error) && record.left() <= 0,
          () => Effect.succeedNone
        ),
        BrowserClock.timeoutOn(record.clock, record.left()),
        Effect.map(Option.flatten)
      )
      if (Option.isNone(checked)) {
        Operation.appendObservation(history, { error: "a check was still running at the deadline" })
        return yield* Effect.fail(failed())
      }
      Operation.appendObservation(history, checked.value)
      if (ConditionImpl.holds(condition, checked.value)) return
      const left = record.left()
      if (left <= 0) return yield* Effect.fail(failed())
      triggers.add("interval")
      // On the browser's clock: Effect's would stop under TestClock (QUIRKS.md, Q235)
      yield* record.clock.sleep(Math.min(interval, left))
    }
  }
)

/** The page's URL is expected to match: checked on each change of it. */
export const toHaveURL = (page: Page.ReadonlyPage, expected: string | RegExp) =>
  Effect.suspend(() => Handles.page(page).entry.execution.url(page, expected))

/** The unchanged model-only URL watcher used by ordinary dispatch and suppressed callbacks. */
export const watchURL = (page: Page.ReadonlyPage, expected: string | RegExp) =>
  watching(
    page.url,
    (url: string) =>
      typeof expected === "string" ? url === expected : new RegExp(expected.source, expected.flags).test(url),
    "toHaveURL",
    `page ${page.id}`,
    `to have the URL ${show(expected)}`,
    { "browser.page.id": page.id }
  )

/** Page-bound URL assertions on opted-in pages use the cooperative check/retry boundary. */
export const handlerURL = (
  page: Page.ReadonlyPage,
  expected: string | RegExp,
  execute: (
    request: Engine.CooperativeURLRequest,
    record: Operation.Record
  ) => Effect.Effect<Engine.Response, Execution.Failure>
) => {
  const { entry, runtime } = Handles.page(page)
  const expectation: Engine.CooperativeURLRequest["expectation"] = { _tag: "URL", expected: matcher(expected, true) }
  // Reading the URL is an observe operation, including on a formerly borrowed handle.
  return expectUsing(
    { runtime, page: entry, grant: Option.none(), steps: [], description: `page ${page.id}` },
    expectation,
    "toHaveURL",
    `to have the URL ${show(expected)}`,
    (cap, record) => execute({ op: "expect", steps: [], expectation, cap }, record)
  )
}

/** The page's title is expected to match, in the page. */
export const toHaveTitle = (page: Page.ReadonlyPage, expected: string | RegExp) => {
  const { entry, grant, runtime } = Handles.page(page)
  return expectIn(
    { runtime, page: entry, grant, steps: [], description: `page ${page.id}` },
    { _tag: "Title", expected: matcher(expected, true) },
    "toHaveTitle",
    `to have the title ${show(expected)}`
  )
}

// ── The matchers' expectations: what each public matcher expects of its subject ──────────────────────────

const stateOf = (
  tag:
    | "Attached"
    | "Detached"
    | "Visible"
    | "Hidden"
    | "Enabled"
    | "Disabled"
    | "Checked"
    | "Focused"
    | "Editable"
    | "Empty"
) =>
(matcherName: string, condition: string) =>
(locator: Locator.ReadonlyLocator) => expectLocator(locator, { _tag: tag }, matcherName, condition)

export const toBeAttached = stateOf("Attached")("toBeAttached", "to be attached")
export const toBeDetached = stateOf("Detached")("toBeDetached", "to be detached")
export const toBeVisible = stateOf("Visible")("toBeVisible", "to be visible")
export const toBeHidden = stateOf("Hidden")("toBeHidden", "to be hidden")
export const toBeEnabled = stateOf("Enabled")("toBeEnabled", "to be enabled")
export const toBeDisabled = stateOf("Disabled")("toBeDisabled", "to be disabled")
export const toBeChecked = stateOf("Checked")("toBeChecked", "to be checked")
export const toBeFocused = stateOf("Focused")("toBeFocused", "to have focus")
export const toBeEmpty = stateOf("Empty")("toBeEmpty", "to be empty")
export const toBeEditable = stateOf("Editable")("toBeEditable", "to be editable")

export const toHaveText = (
  locator: Locator.ReadonlyLocator,
  expected: string | RegExp | ReadonlyArray<string | RegExp>
) => {
  const list = Array.isArray(expected)
  const all = (list ? expected : [expected]) as ReadonlyArray<string | RegExp>
  return expectLocator(
    locator,
    { _tag: "Text", expected: all.map((each) => matcher(each, true)), list },
    "toHaveText",
    `to have the text ${list ? `[${all.map(show).join(", ")}]` : show(all[0]!)}`
  )
}

export const toHaveClass = (
  locator: Locator.ReadonlyLocator,
  expected: string | RegExp | ReadonlyArray<string | RegExp>
) => {
  const list = Array.isArray(expected)
  const all = (list ? expected : [expected]) as ReadonlyArray<string | RegExp>
  return expectLocator(
    locator,
    { _tag: "Class", expected: all.map((each) => matcher(each, true)), list },
    "toHaveClass",
    `to have the class ${list ? `[${all.map(show).join(", ")}]` : show(all[0]!)}`
  )
}

export const toContainText = (locator: Locator.ReadonlyLocator, expected: string | RegExp) =>
  expectLocator(
    locator,
    { _tag: "ContainsText", expected: matcher(expected, false) },
    "toContainText",
    `to contain the text ${show(expected)}`
  )

export const toHaveValue = (locator: Locator.ReadonlyLocator, expected: string | RegExp) =>
  expectLocator(
    locator,
    { _tag: "Value", expected: matcher(expected, true) },
    "toHaveValue",
    `to have the value ${show(expected)}`
  )

export const toHaveValues = (locator: Locator.ReadonlyLocator, expected: ReadonlyArray<string | RegExp>) =>
  expectLocator(
    locator,
    { _tag: "Values", expected: expected.map((value) => matcher(value, true)) },
    "toHaveValues",
    `to have the values [${expected.map(show).join(", ")}]`
  )

export const toHaveRole = (locator: Locator.ReadonlyLocator, expected: string) =>
  expectLocator(
    locator,
    { _tag: "Role", expected },
    "toHaveRole",
    `to have the role ${show(expected)}`
  )

export const toHaveAttribute = (locator: Locator.ReadonlyLocator, name: string, expected?: string | RegExp) =>
  expectLocator(
    locator,
    { _tag: "Attribute", name, expected: expected === undefined ? null : matcher(expected, true) },
    "toHaveAttribute",
    `to have the attribute ${name}${expected === undefined ? "" : ` ${show(expected)}`}`
  )

export const toHaveCount = (locator: Locator.ReadonlyLocator, count: number) =>
  expectLocator(
    locator,
    { _tag: "Count", count },
    "toHaveCount",
    `to match ${count} element${count === 1 ? "" : "s"}`
  )

export const toMatchAria = (locator: Locator.ReadonlyLocator, pattern: AriaPattern.AriaPattern) => {
  const data = AriaPatterns.pattern(pattern)
  return expectLocator(
    locator,
    { _tag: "Aria", pattern: data },
    "toMatchAria",
    `to match ${AriaPatterns.describe(data)}`
  )
}

export const toBeInViewport = (
  locator: Locator.ReadonlyLocator,
  options?: { readonly ratio?: number | undefined; readonly inViewport?: boolean | undefined } | undefined
) => {
  const ratio = options?.ratio ?? 0
  const inViewport = options?.inViewport ?? true
  return expectLocator(
    locator,
    { _tag: "Viewport", ratio, inViewport },
    "toBeInViewport",
    `to ${inViewport ? "" : "not "}intersect the viewport at ratio ${ratio}`
  )
}
/** Accessible names use the shared engine only when this expectation is requested. */
export const toHaveAccessibleName = (
  locator: Locator.ReadonlyLocator,
  expected: string | RegExp,
  options?: { readonly ignoreCase?: boolean | undefined } | undefined
) => {
  const ignoreCase = options?.ignoreCase
  const flags = typeof expected === "string" ? "" : expected.flags
  const text = typeof expected === "string" ? matcher(expected, true) : {
    _tag: "RegExp" as const,
    source: expected.source,
    flags: ignoreCase === undefined ? flags : flags.replace(/i/g, "") + (ignoreCase ? "i" : "")
  }
  return expectLocator(
    locator,
    { _tag: "AccessibleName", expected: text, ignoreCase: ignoreCase === true },
    "toHaveAccessibleName",
    `to have the accessible name ${show(expected)}${
      ignoreCase === undefined ? "" : ignoreCase ? " ignoring case" : " matching case"
    }`
  )
}

export const toHaveCSS = (
  locator: Locator.ReadonlyLocator,
  name: string,
  expected: string | RegExp,
  options?: { readonly not?: boolean | undefined; readonly pseudo?: "before" | "after" | undefined }
) =>
  expectLocator(
    locator,
    {
      _tag: "CSS",
      name,
      expected: matcher(expected, true),
      not: options?.not ?? false,
      pseudo: options?.pseudo ?? null
    },
    "toHaveCSS",
    `${options?.not ? "not " : ""}to have the computed CSS ${name}${options?.pseudo ? ` on ::${options.pseudo}` : ""} ${
      show(expected)
    }`
  )
