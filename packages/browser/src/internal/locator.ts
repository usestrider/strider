/**
 * Locators (API.md, Locators, actions and actionability; review 12, candidates 3 and 4). A locator is data:
 * the engine's steps, resolved again on every attempt. Built: the queries and chainers, `count`, `isVisible`,
 * `all` and `click`. The other members fail as `NotBuilt`.
 */
import * as Effect from "effect/Effect"
import * as Equal from "effect/Equal"
import * as Hash from "effect/Hash"
import * as Inspectable from "effect/Inspectable"
import * as Option from "effect/Option"
import { pipeArguments } from "effect/Pipeable"
import type * as AriaRole from "../AriaRole.ts"
import type * as Deadline from "../Deadline.ts"
import type * as Diagnostics from "../Diagnostics.ts"
import * as Locator from "../Locator.ts"
import * as Reason from "../Reason.ts"
import type * as Engine from "./engine.ts"
import type * as Model from "./model.ts"
import * as NotBuilt from "./notBuilt.ts"
import * as Operation from "./operation.ts"
import * as Runtime from "./runtime.ts"
import { describeSteps, matcher, queries, type Relative, roleStep } from "./steps.ts"

// ── Locators ──────────────────────────────────────────────────────────────────────────────────────────────

/** The checks `click` runs, and the frames `stable` waits for unless the call says otherwise. */
const defaultFrames = 2

const checksFor = (checks: Locator.Checks | undefined): Engine.Checks => ({
  visible: checks?.visible ?? true,
  enabled: checks?.enabled ?? true,
  notInert: checks?.notInert ?? true,
  inViewport: checks?.inViewport ?? true,
  stable: checks?.stable === false ? 0 : typeof checks?.stable === "object" ? checks.stable.frames : defaultFrames,
  receivesPointer: checks?.receivesPointer ?? true
})

/** What a `NotReady` reason says, as a timeout's hint. */
const explain = (reason: Engine.NotReady, frames: number): string => {
  switch (reason._tag) {
    case "NoMatch":
      return "Nothing matched the locator"
    case "NotVisible":
      return "The element isn't visible"
    case "Disabled":
      return "The element is disabled"
    case "Inert":
      return "The element is inert"
    case "BlockedByModal":
      return `A modal dialog, ${reason.dialog}, blocks the element`
    case "OutsideViewport":
      return "The element is outside the viewport, even after it was scrolled into view"
    case "NotStable":
      return `The element kept moving: its box changed within ${frames} frames`
    case "NoRenderingOpportunity":
      return "The page rendered no frame: a page in the background, such as the opener of a popup, may render none; page.activate brings it to the front"
    case "Covered":
      return `Another element covers the element's action point: ${reason.by}`
  }
}

const LocatorTypeId = "~@usestrider/browser/Locator"

/** The page a locator belongs to. */
export interface Owner {
  readonly runtime: Runtime.Runtime
  readonly page: Model.PageEntry
}

export class LocatorImpl implements Locator.Locator {
  readonly [LocatorTypeId] = LocatorTypeId as typeof LocatorTypeId
  readonly owner: Owner
  readonly steps: ReadonlyArray<Engine.Step>
  readonly label: Option.Option<string>
  constructor(owner: Owner, steps: ReadonlyArray<Engine.Step>, label: Option.Option<string> = Option.none()) {
    this.owner = owner
    this.steps = steps
    this.label = label
  }

  /** How the locator reads in code, or its label. */
  get description(): string {
    return Option.getOrElse(this.label, () => `page.${describeSteps(this.steps)}`)
  }

  private with(steps: ReadonlyArray<Engine.Step>) {
    return new LocatorImpl(this.owner, steps)
  }

  // Queries, relative to this locator
  getByRole(role: AriaRole.AriaRole, options?: Locator.RoleOptions) {
    return this.with([...this.steps, roleStep(role, options)])
  }
  getByText(text: string | RegExp, options?: Locator.TextOptions) {
    return this.with([...this.steps, { _tag: "Text", matcher: matcher(text, options?.exact) }])
  }
  getByLabel(text: string | RegExp, options?: Locator.TextOptions) {
    return this.with([...this.steps, { _tag: "Label", matcher: matcher(text, options?.exact) }])
  }
  getByPlaceholder(text: string | RegExp, options?: Locator.TextOptions) {
    return this.with([...this.steps, { _tag: "Placeholder", matcher: matcher(text, options?.exact) }])
  }
  getByAltText(text: string | RegExp, options?: Locator.TextOptions) {
    return this.with([...this.steps, { _tag: "AltText", matcher: matcher(text, options?.exact) }])
  }
  getByTitle(text: string | RegExp, options?: Locator.TextOptions) {
    return this.with([...this.steps, { _tag: "Title", matcher: matcher(text, options?.exact) }])
  }
  getByTestId(id: string) {
    return this.with([...this.steps, { _tag: "TestId", id }])
  }
  locator(css: string) {
    return this.with([...this.steps, { _tag: "Css", selector: css }])
  }

  // Chainers
  frame = NotBuilt.sync("Locator.frame") as Locator.Locator["frame"]
  filter(options: Locator.FilterOptions) {
    return this.with([...this.steps, {
      _tag: "Filter",
      hasText: options.hasText === undefined ? null : matcher(options.hasText, false),
      hasNotText: options.hasNotText === undefined ? null : matcher(options.hasNotText, false),
      has: options.has === undefined ? null : (options.has as Relative).steps,
      hasNot: options.hasNot === undefined ? null : (options.hasNot as Relative).steps,
      visible: options.visible ?? null
    }])
  }
  and(other: Locator.ReadonlyLocator) {
    return this.with([...this.steps, { _tag: "And", other: this.samePage(other, "and") }])
  }
  or(other: Locator.ReadonlyLocator) {
    return this.with([...this.steps, { _tag: "Or", other: this.samePage(other, "or") }])
  }
  nth(index: number) {
    return this.with([...this.steps, { _tag: "Nth", index }])
  }
  get first() {
    return this.nth(0)
  }
  get last() {
    return this.nth(-1)
  }
  describe(label: string) {
    return new LocatorImpl(this.owner, this.steps, Option.some(label))
  }

  // The other locator's steps; one from another page is a mistake in the code, a defect
  private samePage(other: Locator.ReadonlyLocator, member: string): ReadonlyArray<Engine.Step> {
    if (!(other instanceof LocatorImpl) || other.owner.page.id !== this.owner.page.id) {
      throw new Error(`Locator.${member}: the other locator belongs to another page`)
    }
    return other.steps
  }

  // ── Reads ──

  get count() {
    return this.read(
      "Locator.count",
      { op: "count", steps: this.steps },
      (response) => response._tag === "Count" ? Effect.succeed(response.count) : this.unexpected(response)
    )
  }

  get isVisible() {
    return this.read(
      "Locator.isVisible",
      { op: "visible", steps: this.steps },
      (response, id) =>
        response._tag === "Visible"
          ? Effect.succeed(response.visible)
          : response._tag === "Strict"
          ? Effect.fail(this.strict("Locator.isVisible", response, id))
          : this.unexpected(response)
    )
  }

  get all() {
    return Effect.map(this.count, (count) => Array.from({ length: count }, (_, index) => this.nth(index)))
  }

  readText = NotBuilt.effect("Locator.readText")
  readValue = NotBuilt.effect("Locator.readValue")
  readHtml = NotBuilt.effect("Locator.readHtml")
  readAttribute = NotBuilt.fn("Locator.readAttribute")
  isEnabled = NotBuilt.effect("Locator.isEnabled")
  isChecked = NotBuilt.effect("Locator.isChecked")
  snapshot = NotBuilt.fn("Locator.snapshot") as Locator.Locator["snapshot"]
  evaluate = NotBuilt.fn("Locator.evaluate") as Locator.Locator["evaluate"]

  // ── Actions ──

  click(options?: Locator.ClickOptions) {
    return this.act("Locator.click", options, options?.button ?? "left")
  }
  dblclick = NotBuilt.fn("Locator.dblclick")
  tap = NotBuilt.fn("Locator.tap")
  hover = NotBuilt.fn("Locator.hover")
  check = NotBuilt.fn("Locator.check")
  uncheck = NotBuilt.fn("Locator.uncheck")
  focus = NotBuilt.fn("Locator.focus")
  clear = NotBuilt.fn("Locator.clear")
  scrollIntoView = NotBuilt.fn("Locator.scrollIntoView")
  fill = NotBuilt.fn("Locator.fill")
  press = NotBuilt.fn("Locator.press")
  pressSequentially = NotBuilt.fn("Locator.pressSequentially")
  selectOption = NotBuilt.fn("Locator.selectOption")
  setInputFiles = NotBuilt.fn("Locator.setInputFiles")
  dragTo = NotBuilt.fn("Locator.dragTo")

  // ── Errors ──

  error(
    operation: string,
    reason: Locator.LocatorErrorReason,
    id: Diagnostics.OperationId,
    dispatch?: Diagnostics.DispatchState
  ) {
    return new Locator.LocatorError({
      operation,
      locator: this.description,
      reason,
      diagnostics: Operation.diagnostics(id, { dispatch })
    })
  }

  strict(operation: string, response: Extract<Engine.Response, { _tag: "Strict" }>, id: Diagnostics.OperationId) {
    const visible = response.candidates.filter((candidate) => candidate.visible).length
    return this.error(
      operation,
      new Locator.StrictViolation({
        candidates: response.candidates,
        suggestions: visible === 1 ? [`${this.description}.filter({ visible: true })`] : [],
        hint: visible === 1
          ? `${response.count} elements match and 1 of them is visible; add .filter({ visible: true })`
          : `${response.count} elements match, and an action needs exactly one; narrow the locator, or pick one with nth()`
      }),
      id
    )
  }

  private unexpected(response: Engine.Response): Effect.Effect<never> {
    return Effect.die(new Error(`The engine answered ${response._tag} unexpectedly`))
  }

  /** Maps a failure to send a request onto the operation's errors. */
  sendFailure(
    operation: string,
    failure: Runtime.SendFailure,
    id: Diagnostics.OperationId,
    budget: Operation.Budget,
    phase: Deadline.Timeout["phase"]
  ) {
    switch (failure._tag) {
      case "Gone":
        return failure.error
      case "Reason":
        return this.error(operation, failure.reason, id)
      case "Deadline":
        return Operation.timeout({ operation, id, phase, budget: budget.budget, history: [], hint: Option.none() })
    }
  }

  private read<A>(
    operation: string,
    request: Engine.Request,
    answer: (response: Engine.Response, id: Diagnostics.OperationId) => Effect.Effect<A, Locator.LocatorError>
  ) {
    return Effect.gen({ self: this }, function*() {
      const id = Operation.operationId()
      const budget = yield* Operation.budget
      const response = yield* Runtime.send(this.owner.runtime, this.owner.page, request, id, budget.at).pipe(
        Effect.mapError((failure) => this.sendFailure(operation, failure, id, budget, "resolving"))
      )
      if (response._tag === "InvalidSelector") {
        return yield* Effect.fail(this.invalidSelector(operation, response, id))
      }
      return yield* answer(response, id)
    }).pipe(Effect.withSpan(operation, { attributes: { "browser.locator": this.description } }))
  }

  invalidSelector(
    operation: string,
    response: Extract<Engine.Response, { _tag: "InvalidSelector" }>,
    id: Diagnostics.OperationId
  ) {
    return this.error(
      operation,
      new Reason.InvalidInput({
        input: "selector",
        expected: "a CSS selector",
        hint: `${JSON.stringify(response.selector)}: ${response.message}`
      }),
      id
    )
  }

  /**
   * An action (review 12, candidate 4): rounds of checks in the page at each frame until they pass, then the
   * page's input permit, the checks once more, and the input, sent once.
   */
  private act(
    operation: string,
    options: Locator.PointerOptions | undefined,
    button: "left" | "right" | "middle"
  ) {
    const owner = this.owner
    return Effect.gen({ self: this }, function*() {
      const id = Operation.operationId()
      const budget = yield* Operation.budget
      if (options?.modifiers !== undefined && options.modifiers.length > 0) {
        return yield* NotBuilt.effect(`${operation} with modifiers`)
      }
      const checks = checksFor(options?.checks)
      const position = options?.position === undefined ? null : { x: options.position.x, y: options.position.y }
      const history: Array<Diagnostics.ObservedValue> = []
      const round = (cap: number) =>
        Runtime.send(owner.runtime, owner.page, { op: "act", steps: this.steps, checks, cap, position }, id, budget.at)
          .pipe(
            Effect.mapError((failure) =>
              failure._tag === "Deadline"
                ? failure
                : this.sendFailure(operation, failure, id, budget, "waitingForCondition")
            )
          )
      // Set once input may have reached the page: a timeout after it can't say the click didn't happen
      let sent = false
      const timedOut = () => {
        if (sent) {
          return Operation.timeout({
            operation,
            id,
            phase: "dispatchedUnconfirmed",
            budget: budget.budget,
            history,
            hint: Option.some(
              "The input was sent and the browser hadn't confirmed it by the deadline; a dialog it opened may still be deciding"
            ),
            dispatch: { _tag: "MayHaveBeenSent" }
          })
        }
        const reasons = history.map((each) => each.value as Engine.NotReady)
        const last = reasons.at(-1)
        return Operation.timeout({
          operation,
          id,
          phase: reasons.every((reason) => reason._tag === "NoMatch") ? "resolving" : "waitingForCondition",
          budget: budget.budget,
          history,
          hint: Option.map(Option.fromNullishOr(last), (reason) => explain(reason, checks.stable))
        })
      }
      const settle = (response: Engine.Response) => {
        switch (response._tag) {
          case "Strict":
            return Effect.fail(this.strict(operation, response, id))
          case "InvalidSelector":
            return Effect.fail(this.invalidSelector(operation, response, id))
          case "NotReady":
            for (const reason of response.history) Operation.appendObservation(history, reason)
            Operation.appendObservation(history, response.reason)
            return Effect.succeed(Option.none<Extract<Engine.Response, { _tag: "Ready" }>>())
          case "Ready":
            return Effect.succeed(Option.some(response))
          default:
            return this.unexpected(response)
        }
      }
      while (true) {
        const left = Operation.millisLeft(budget.at)
        if (left <= 0) return yield* Effect.fail(timedOut())
        const first = yield* round(Math.min(1000, left)).pipe(
          Effect.catch((failure) => failure._tag === "Deadline" ? Effect.fail(timedOut()) : Effect.fail(failure)),
          Effect.flatMap(settle)
        )
        if (Option.isNone(first)) continue
        // Input to a page is serialized; acquiring the permit takes from the deadline, and the checks run again
        const done = yield* owner.page.input.withPermit(Effect.gen({ self: this }, function*() {
          const again = yield* round(Math.min(1000, Operation.millisLeft(budget.at))).pipe(
            Effect.catch((failure) => failure._tag === "Deadline" ? Effect.fail(timedOut()) : Effect.fail(failure)),
            Effect.flatMap(settle)
          )
          if (Option.isNone(again)) return false
          // A trial stops at the last check, holding the permit as the action would
          if (options?.trial === true) return true
          const { x, y } = again.value.point
          const none = { alt: false, control: false, meta: false, shift: false }
          sent = true
          // A click that opens a dialog returns once the dialog is decided (review 13, P3), so the dispatch races
          // a dialog nothing will decide
          yield* owner.runtime.model.adapter.dispatchInput(owner.page.id, [
            { _tag: "Mouse", type: "move", x, y, button: "none", clickCount: 0, modifiers: none },
            { _tag: "Mouse", type: "down", x, y, button, clickCount: 1, modifiers: none },
            { _tag: "Mouse", type: "up", x, y, button, clickCount: 1, modifiers: none }
          ]).pipe(
            Effect.mapError((error): Runtime.SendFailure => Operation.fromAdapter(error, id, owner.runtime.backend)),
            Effect.raceFirst(Runtime.promptBlocked(owner.page, true)),
            Effect.mapError((failure) =>
              // The input may have reached the page: the error says so, and nothing is sent again
              failure._tag === "Gone"
                ? failure.error
                : failure._tag === "Reason"
                ? this.error(operation, failure.reason, id, { _tag: "MayHaveBeenSent" })
                : timedOut()
            )
          )
          return true
        })).pipe(
          Effect.timeoutOption(Operation.millisLeft(budget.at)),
          Effect.flatMap(Option.match({ onNone: () => Effect.fail(timedOut()), onSome: Effect.succeed }))
        )
        if (done) return
      }
    }).pipe(
      Effect.raceFirst(Runtime.pageEnded(owner.page, Operation.operationId())),
      Effect.withSpan(operation, {
        attributes: { "browser.locator": this.description, "browser.page.id": owner.page.id }
      })
    )
  }

  // ── Values ──

  [Equal.symbol](that: unknown): boolean {
    return that instanceof LocatorImpl && that.owner.page.id === this.owner.page.id &&
      JSON.stringify(that.steps) === JSON.stringify(this.steps) && Equal.equals(that.label, this.label)
  }
  [Hash.symbol](): number {
    return Hash.string(`${this.owner.page.id} ${JSON.stringify(this.steps)}`)
  }
  pipe() {
    return pipeArguments(this, arguments)
  }
  toString() {
    return `Locator(${this.description})`
  }
  toJSON() {
    return { _id: "Locator", page: this.owner.page.id, locator: this.description }
  }
  [Inspectable.NodeInspectSymbol]() {
    return this.toJSON()
  }
}

/** A page's root locator queries. */
export const pageQueries = (owner: Owner): Locator.Queries<Locator.Locator> =>
  queries([], (steps) => new LocatorImpl(owner, steps))
