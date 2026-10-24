/**
 * Locators (API.md, Locators, actions and actionability; reviews 12 and 16). A locator is data: the engine's
 * steps, resolved again on every attempt. Built: the queries and chainers, every read, and every action. Frames,
 * `snapshot` and `evaluate` fail as `NotBuilt`.
 *
 * An action checks in rounds in the page, at each frame, until its checks pass; then it takes the page's input
 * permit, checks once more and does its part in the page (focus, select, scroll), and sends its input, built from
 * the page's input state (`input.ts`). A pointer gesture is guarded: if its first trusted event lands outside the
 * element, the page never sees it, and the action checks again (review 16, candidate 5).
 */
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Equal from "effect/Equal"
import * as Hash from "effect/Hash"
import * as Inspectable from "effect/Inspectable"
import * as Option from "effect/Option"
import { pipeArguments } from "effect/Pipeable"
import * as Redacted from "effect/Redacted"
import * as SubscriptionRef from "effect/SubscriptionRef"
import type * as AriaRole from "../AriaRole.ts"
import type * as Deadline from "../Deadline.ts"
import type * as Diagnostics from "../Diagnostics.ts"
import type * as FileInput from "../FileInput.ts"
import type * as Keyboard from "../Keyboard.ts"
import * as Locator from "../Locator.ts"
import type * as Mouse from "../Mouse.ts"
import * as Reason from "../Reason.ts"
import type * as Target from "../Target.ts"
import type * as Adapter from "./adapter.ts"
import type * as Engine from "./engine.ts"
import * as FileInputImpl from "./fileInput.ts"
import * as Input from "./input.ts"
import * as Keys from "./keys.ts"
import type * as Model from "./model.ts"
import * as NotBuilt from "./notBuilt.ts"
import * as Operation from "./operation.ts"
import * as Runtime from "./runtime.ts"
import { describeSteps, matcher, queries, type Relative, roleStep } from "./steps.ts"

// ── Locators ──────────────────────────────────────────────────────────────────────────────────────────────

/** The frames `stable` waits for unless the call says otherwise. */
const defaultFrames = 2

type CheckSet = Omit<Engine.Checks, "stable"> & { readonly stable: boolean }

/** The checks each action documents (API.md, Locators, actions and actionability). */
const pointerChecks: CheckSet = {
  visible: true,
  enabled: true,
  editable: false,
  notInert: true,
  inViewport: true,
  stable: true,
  receivesPointer: true
}
const editChecks: CheckSet = {
  visible: true,
  enabled: true,
  editable: true,
  notInert: true,
  inViewport: false,
  stable: false,
  receivesPointer: false
}
const focusChecks: CheckSet = { ...editChecks, enabled: false, editable: false }
const scrollChecks: CheckSet = { ...focusChecks, notInert: false, stable: true }
const selectChecks: CheckSet = { ...editChecks, editable: false, notInert: false }
const noChecks: CheckSet = { ...focusChecks, visible: false, notInert: false }

const checksFor = (defaults: CheckSet, checks: Locator.Checks | undefined): Engine.Checks => ({
  visible: checks?.visible ?? defaults.visible,
  enabled: checks?.enabled ?? defaults.enabled,
  editable: checks?.editable ?? defaults.editable,
  notInert: checks?.notInert ?? defaults.notInert,
  inViewport: checks?.inViewport ?? defaults.inViewport,
  stable: checks?.stable === false || (checks?.stable === undefined && !defaults.stable)
    ? 0
    : typeof checks?.stable === "object"
    ? checks.stable.frames
    : defaultFrames,
  receivesPointer: checks?.receivesPointer ?? defaults.receivesPointer
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
    case "Intercepted":
      return `The element was covered when the input arrived, and the page never saw it: ${reason.by}`
    case "ReadOnly":
      return "The element is read-only"
    case "NoSuchOption":
      return `The select has no option with that ${reason.option}`
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

  get readText() {
    return this.readOne("Locator.readText", { _tag: "Text" }, (value) => value as string)
  }
  get readValue() {
    return this.readOne("Locator.readValue", { _tag: "Value" }, (value) => value as string)
  }
  get readHtml() {
    return this.readOne("Locator.readHtml", { _tag: "Html" }, (value) => value as string)
  }
  readAttribute(name: string) {
    return this.readOne(
      "Locator.readAttribute",
      { _tag: "Attribute", name },
      (value) => Option.fromNullishOr(value as string | null)
    )
  }
  get isEnabled() {
    return this.readOne("Locator.isEnabled", { _tag: "Enabled" }, (value) => value as boolean)
  }
  get isChecked() {
    return this.readOne("Locator.isChecked", { _tag: "Checked" }, (value) => value as boolean)
  }
  snapshot = NotBuilt.fn("Locator.snapshot") as Locator.Locator["snapshot"]
  evaluate = NotBuilt.fn("Locator.evaluate") as Locator.Locator["evaluate"]

  /** A one-shot read of the one match (review 16, candidate 6): strict, and immediate. */
  private readOne<A>(operation: string, what: Engine.Read, value: (read: unknown) => A) {
    return this.read(operation, { op: "read", steps: this.steps, read: what }, (response, id) => {
      switch (response._tag) {
        case "Read":
          return Effect.succeed(value(response.value))
        case "NoMatch":
          return Effect.fail(this.error(
            operation,
            new Locator.NoMatch({ hint: "A read never waits; Expect waits for what it expects" }),
            id
          ))
        case "Strict":
          return Effect.fail(this.strict(operation, response, id))
        case "Final":
          return Effect.fail(this.final(operation, response.final, id))
        default:
          return this.unexpected(response)
      }
    })
  }

  // ── Actions ──

  click(options?: Locator.ClickOptions) {
    return this.pointer(
      "Locator.click",
      options,
      (state, point) => Input.click(state, point, options?.button ?? "left", 1, options?.modifiers ?? [])
    )
  }
  dblclick(options?: Locator.ClickOptions) {
    return this.pointer(
      "Locator.dblclick",
      options,
      (state, point) => Input.click(state, point, options?.button ?? "left", 2, options?.modifiers ?? [])
    )
  }
  tap(options?: Locator.PointerOptions) {
    return this.pointer("Locator.tap", options, (state, point) => Input.tap(state, point, options?.modifiers ?? []))
  }
  hover(options?: Locator.PointerOptions) {
    return this.pointer(
      "Locator.hover",
      options,
      (state, point) => Input.move(state, point, 1, options?.modifiers ?? []),
      { guard: false }
    )
  }
  check(options?: Locator.PointerOptions) {
    return this.setChecked("Locator.check", true, options)
  }
  uncheck(options?: Locator.PointerOptions) {
    return this.setChecked("Locator.uncheck", false, options)
  }
  focus(options?: Locator.ActionOptions) {
    return this.act("Locator.focus", options, focusChecks, { _tag: "Focus" }, () => Effect.succeed("done" as const))
  }
  scrollIntoView(options?: Locator.ActionOptions) {
    return this.act(
      "Locator.scrollIntoView",
      options,
      scrollChecks,
      { _tag: "Scroll" },
      () => Effect.succeed("done" as const)
    )
  }
  clear(options?: Locator.ActionOptions) {
    return this.fillWith("Locator.clear", "", options)
  }
  fill(value: string | Redacted.Redacted<string>, options?: Locator.ActionOptions) {
    return this.fillWith("Locator.fill", value, options)
  }
  press(key: Keyboard.Key | string, options?: Locator.PressOptions) {
    return Effect.suspend(() => {
      const definition = Keys.definition(key)
      if (definition === undefined) return Effect.fail(this.unknownKey("Locator.press", key))
      return this.act(
        "Locator.press",
        options,
        focusChecks,
        { _tag: "Focus" },
        (_ready, send) =>
          Effect.as(
            send(Input.press(this.owner.page.inputState, definition, options?.modifiers ?? [])),
            "done" as const
          )
      )
    })
  }
  pressSequentially(text: string | Redacted.Redacted<string>, options?: Locator.TypeOptions) {
    const characters = Array.from(Redacted.isRedacted(text) ? Redacted.value(text) : text)
    const delay = options?.delay === undefined ? Duration.zero : Duration.fromInputUnsafe(options.delay)
    return this.act(
      "Locator.pressSequentially",
      options,
      focusChecks,
      { _tag: "Focus" },
      (_ready, send) =>
        Effect.as(
          Effect.forEach(characters, (character, index) =>
            Effect.andThen(
              index > 0 && Duration.isGreaterThan(delay, Duration.zero) ? Effect.sleep(delay) : Effect.void,
              send(Input.press(this.owner.page.inputState, Keys.forCharacter(character)))
            ), { discard: true }),
          "done" as const
        ),
      { redacted: Redacted.isRedacted(text) }
    )
  }
  selectOption(choice: Locator.SelectOption | ReadonlyArray<Locator.SelectOption>, options?: Locator.ActionOptions) {
    const choices = Array.isArray(choice)
      ? choice as ReadonlyArray<Locator.SelectOption>
      : [choice as Locator.SelectOption]
    return this.act(
      "Locator.selectOption",
      options,
      selectChecks,
      { _tag: "Select", choices },
      () => Effect.succeed("done" as const)
    )
  }
  setInputFiles(files: FileInput.FileInput | ReadonlyArray<FileInput.FileInput>, options?: Locator.ActionOptions) {
    const list = Array.isArray(files) ? files as ReadonlyArray<FileInput.FileInput> : [files as FileInput.FileInput]
    const owner = this.owner
    return this.act(
      "Locator.setInputFiles",
      options,
      noChecks,
      { _tag: "FileInput" },
      (_ready, _send, id) =>
        Effect.gen({ self: this }, function*() {
          const paths: Array<string> = []
          for (const file of list) {
            const path = yield* FileInputImpl.path(owner.runtime, file).pipe(
              Effect.mapError((reason) => this.error("Locator.setInputFiles", reason, id))
            )
            const fs = owner.runtime.fileSystem
            if (FileInputImpl.source(file)._tag === "Local" && Option.isSome(fs)) {
              const exists = yield* fs.value.exists(path).pipe(Effect.orElseSucceed(() => false))
              if (!exists) {
                return yield* Effect.fail(this.error(
                  "Locator.setInputFiles",
                  new Locator.FileUnreadable({ path, hint: "No file is at that path on this machine" }),
                  id
                ))
              }
            }
            paths.push(path)
          }
          const binding = yield* Runtime.element(owner.runtime, owner.page, this.steps, id).pipe(
            Effect.mapError((failure) => this.sendFailure("Locator.setInputFiles", failure, id, undefined))
          )
          if (Option.isNone(binding)) {
            return yield* Effect.die(new Error("Locator.setInputFiles: the browser gave no binding for the file input"))
          }
          yield* owner.runtime.model.adapter.setInputFiles(binding.value, paths).pipe(
            Effect.mapError((error) => this.adapterFailure("Locator.setInputFiles", error, id))
          )
          return "done" as const
        })
    )
  }
  dragTo(target: Locator.ReadonlyLocator, options?: Locator.DragOptions) {
    const to = this.samePageLocator(target, "dragTo")
    const steps = options?.steps ?? 1
    return this.pointer(
      "Locator.dragTo",
      options,
      (state, point, targetPoint) => Input.drag(state, point, targetPoint!, steps, options?.modifiers ?? []),
      {
        target: Effect.suspend(() => to.pointOf(options?.targetPosition)),
        // An HTML drag is a capability: Firefox never drops one, and WebKit's protocol can't (review 16, P5)
        draggable: (id) => Effect.flatMap(this.requires("Locator.dragTo", "input.dragAndDrop", id), () => Effect.void),
        position: options?.position
      }
    ).pipe(Effect.annotateSpans({ "browser.locator.target": to.description, "browser.drag.steps": steps }))
  }

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

  /** A failure no waiting mends. */
  final(operation: string, final: Engine.Final, id: Diagnostics.OperationId) {
    switch (final._tag) {
      case "WrongElement":
        return this.error(
          operation,
          new Locator.WrongElement({
            expected: final.expected,
            element: final.element,
            hint: "The locator found an element of another kind; narrow it to the one meant"
          }),
          id
        )
      case "NotEditable":
        return this.error(
          operation,
          new Locator.NotEditable({
            element: final.element,
            hint: "Only inputs, textareas and contenteditable elements take text"
          }),
          id
        )
      case "Refused":
        return this.error(
          operation,
          new Reason.InvalidInput({
            input: "value",
            expected: `a value ${final.element} takes`,
            hint: "The input refused the value; a date input takes a date such as 2026-10-23"
          }),
          id
        )
    }
  }

  private unknownKey(operation: string, key: string) {
    return this.error(
      operation,
      new Reason.InvalidInput({
        input: "key",
        expected: "a UI Events key value, such as \"Enter\" or \"a\", or one character",
        hint: `${JSON.stringify(key)} isn't a key`
      }),
      Operation.operationId()
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
    budget: Operation.Budget | undefined,
    phase: Deadline.Timeout["phase"] = "resolving"
  ) {
    switch (failure._tag) {
      case "Gone":
        return failure.error
      case "Reason":
        return this.error(operation, failure.reason, id)
      case "Deadline":
        return Operation.timeout({
          operation,
          id,
          phase,
          budget: budget?.budget ?? Duration.zero,
          history: [],
          hint: Option.none()
        })
    }
  }

  private adapterFailure(operation: string, error: Adapter.AdapterError, id: Diagnostics.OperationId) {
    const mapped = Operation.fromAdapter(error, id, this.owner.runtime.backend)
    return mapped._tag === "Gone" ? mapped.error : this.error(operation, mapped.reason, id, { _tag: "MayHaveBeenSent" })
  }

  /** Fails with `Unsupported` when the backend reports a capability as unsupported. */
  private requires(operation: string, capability: string, id: Diagnostics.OperationId) {
    return Effect.flatMap(SubscriptionRef.get(this.owner.runtime.model.adapter.capabilities), (capabilities) => {
      const entry = capabilities.entries.find((each) => each.name === capability)
      return entry === undefined || entry.status !== "unsupported" ? Effect.void : Effect.fail(this.error(
        operation,
        new Reason.Unsupported({
          capability,
          backend: this.owner.runtime.backend,
          hint: entry.limitations.join("; ") || `${this.owner.runtime.backend} can't do this`
        }),
        id
      ))
    })
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

  /** The other locator, which must belong to this page. */
  private samePageLocator(other: Locator.ReadonlyLocator, member: string): LocatorImpl {
    if (!(other instanceof LocatorImpl) || other.owner.page.id !== this.owner.page.id) {
      throw new Error(`Locator.${member}: the other locator belongs to another page`)
    }
    return other
  }

  /** The action point of the one match, now: a drag's target, which must be visible and reachable. */
  pointOf(position: Mouse.Point | undefined) {
    return Effect.gen({ self: this }, function*() {
      const id = Operation.operationId()
      const budget = yield* Operation.budget
      const response = yield* Runtime.send(
        this.owner.runtime,
        this.owner.page,
        {
          op: "act",
          steps: this.steps,
          checks: checksFor(pointerChecks, { stable: false, receivesPointer: false }),
          cap: Math.min(1000, Operation.millisLeft(budget.at)),
          action: {
            _tag: "Point",
            position: position === undefined ? null : { x: position.x, y: position.y },
            guard: false
          },
          apply: false
        },
        id,
        budget.at
      ).pipe(
        Effect.mapError((failure) => this.sendFailure("Locator.dragTo", failure, id, budget, "waitingForCondition"))
      )
      return response._tag === "Ready" && response.point !== null ? Option.some(response.point) : Option.none()
    })
  }

  /** `check` and `uncheck`: nothing when it is already so; else a click, and the state read again. */
  private setChecked(operation: string, checked: boolean, options: Locator.PointerOptions | undefined) {
    const expected = checked ? "checked" : "unchecked"
    return Effect.gen({ self: this }, function*() {
      const now = yield* this.isChecked.pipe(
        Effect.catchIf(
          (error): error is Locator.LocatorError => Locator.isLocatorError(error) && error.reason._tag === "NoMatch",
          () => Effect.succeed(undefined)
        )
      )
      if (now === checked) return
      yield* this.pointer(
        operation,
        options,
        (state, point) => Input.click(state, point, "left", 1, options?.modifiers ?? [])
      )
      const after = yield* this.isChecked
      if (after !== checked) {
        return yield* Effect.fail(this.error(
          operation,
          new Locator.StateUnchanged({
            expected,
            hint: "The click reached it and its state didn't change; the page may prevent it"
          }),
          Operation.operationId(),
          { _tag: "MayHaveBeenSent" }
        ))
      }
    }).pipe(Effect.withSpan(operation, { attributes: { "browser.locator": this.description } }))
  }

  /** `fill` and `clear`: the contents selected in the page and the value inserted, or set for a non-text input. */
  private fillWith(
    operation: string,
    value: string | Redacted.Redacted<string>,
    options: Locator.ActionOptions | undefined
  ) {
    const text = Redacted.isRedacted(value) ? Redacted.value(value) : value
    return this.act(
      operation,
      options,
      editChecks,
      { _tag: "Fill", value: text },
      (ready, send) =>
        ready.fill === "set"
          ? Effect.succeed("done" as const)
          : Effect.as(
            send(
              text === ""
                ? Input.press(this.owner.page.inputState, Keys.definition("Delete")!)
                : [{ _tag: "InsertText", text }]
            ),
            "done" as const
          ),
      { redacted: Redacted.isRedacted(value) }
    )
  }

  /**
   * A pointer action: the checks, then under the permit the point, a guard armed on the element, the gesture,
   * and the guard asked whether it stopped the gesture, in which case the action checks again.
   */
  private pointer(
    operation: string,
    options: Locator.PointerOptions | undefined,
    gesture: (
      state: Input.State,
      point: { readonly x: number; readonly y: number },
      target: { readonly x: number; readonly y: number } | undefined
    ) => ReadonlyArray<Adapter.InputEvent>,
    extra: {
      readonly guard?: boolean
      readonly target?: Effect.Effect<Option.Option<{ readonly x: number; readonly y: number }>, unknown>
      readonly draggable?: (id: Diagnostics.OperationId) => Effect.Effect<void, Locator.LocatorError>
      readonly position?: Mouse.Point | undefined
    } = {}
  ) {
    const owner = this.owner
    const guard = extra.guard ?? true
    const at = extra.position ?? options?.position
    const position = at === undefined ? null : { x: at.x, y: at.y }
    return this.act(
      operation,
      options,
      pointerChecks,
      { _tag: "Point", position, guard },
      (ready, send, id) =>
        Effect.gen({ self: this }, function*() {
          const state = owner.page.inputState
          if (Input.anyModifier(state, options?.modifiers ?? [])) {
            yield* this.requires(operation, "input.pointerModifiers", id)
          }
          if (ready.draggable && extra.draggable !== undefined) yield* extra.draggable(id)
          let target: { readonly x: number; readonly y: number } | undefined
          if (extra.target !== undefined) {
            const point = yield* extra.target.pipe(Effect.orElseSucceed(() => Option.none()))
            if (Option.isNone(point)) {
              if (guard) yield* this.disarm(id)
              return { retry: { _tag: "NoMatch" } } as const
            }
            target = point.value
          }
          const events = gesture(state, ready.point!, target)
          yield* send(events)
          const last = events.filter((event): event is Extract<Adapter.InputEvent, { _tag: "Mouse" }> =>
            event._tag === "Mouse"
          ).at(-1)
          if (last !== undefined) state.position = { x: last.x, y: last.y }
          if (!guard) return "done" as const
          const blocked = yield* this.disarm(id)
          return Option.isSome(blocked)
            ? { retry: { _tag: "Intercepted", by: blocked.value } as Engine.NotReady }
            : "done" as const
        }).pipe(
          // A guard left armed would stop the page's next gesture: any failure after arming it removes it
          Effect.onError(() => guard ? Effect.ignore(this.disarm(id)) : Effect.void)
        )
    )
  }

  /** Removes the guard an action armed: the element that stopped the gesture, if one did. */
  private disarm(id: Diagnostics.OperationId) {
    return Effect.gen({ self: this }, function*() {
      const budget = yield* Operation.budget
      const response = yield* Runtime.send(this.owner.runtime, this.owner.page, { op: "disarm" }, id, budget.at).pipe(
        Effect.option
      )
      // A document that went with the gesture took its guard with it: nothing stopped it
      return Option.isSome(response) && response.value._tag === "Guarded" && response.value.blocked !== null
        ? Option.some(response.value.blocked)
        : Option.none<string>()
    })
  }

  /**
   * An action (reviews 12 and 16): rounds of checks in the page at each frame until they pass, then the page's
   * input permit, the checks once more with the action's part done in the page, and `perform`, which sends the
   * input once. `perform` may ask for another round, only when a guard proved the page never saw the input.
   */
  private act(
    operation: string,
    options: Locator.ActionOptions | undefined,
    defaults: CheckSet,
    action: Engine.Action,
    perform: (
      ready: Extract<Engine.Response, { _tag: "Ready" }>,
      send: (
        events: ReadonlyArray<Adapter.InputEvent>
      ) => Effect.Effect<void, Locator.LocatorError | Target.TargetGone>,
      id: Diagnostics.OperationId
    ) => Effect.Effect<
      "done" | { readonly retry: Engine.NotReady },
      Locator.LocatorError | Target.TargetGone | Deadline.Timeout
    >,
    extra: { readonly redacted?: boolean } = {}
  ) {
    const owner = this.owner
    return Effect.gen({ self: this }, function*() {
      const id = Operation.operationId()
      const budget = yield* Operation.budget
      const checks = checksFor(defaults, options?.checks)
      const history: Array<Diagnostics.ObservedValue> = []
      const round = (cap: number, apply: boolean) =>
        Runtime.send(
          owner.runtime,
          owner.page,
          { op: "act", steps: this.steps, checks, cap, action, apply },
          id,
          budget.at
        )
          .pipe(
            Effect.mapError((failure) =>
              failure._tag === "Deadline"
                ? failure
                : this.sendFailure(operation, failure, id, budget, "waitingForCondition")
            )
          )
      // Set once input may have reached the page: a timeout after it can't say the action didn't happen
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
        // A page that rendered no frame in some rounds and one in others renders too seldom to tell the element
        // is still: what moved is the page's frame rate, which page.activate mends (QUIRKS.md, Q71)
        const starved = last?._tag === "NotStable" && reasons.some((reason) => reason._tag === "NoRenderingOpportunity")
        return Operation.timeout({
          operation,
          id,
          phase: reasons.every((reason) => reason._tag === "NoMatch") ? "resolving" : "waitingForCondition",
          budget: budget.budget,
          history,
          hint: Option.map(
            Option.fromNullishOr(starved ? { _tag: "NoRenderingOpportunity" } as const : last),
            (reason) => explain(reason, checks.stable)
          )
        })
      }
      const settle = (response: Engine.Response) => {
        switch (response._tag) {
          case "Strict":
            return Effect.fail(this.strict(operation, response, id))
          case "InvalidSelector":
            return Effect.fail(this.invalidSelector(operation, response, id))
          case "Final":
            return Effect.fail(this.final(operation, response.final, id))
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
      // Input reaches the page from here: a dialog it opens may block it, and a dialog nothing will decide fails it
      const send = (events: ReadonlyArray<Adapter.InputEvent>) =>
        Effect.suspend(() => {
          if (Option.isSome(owner.page.inputState.broken)) {
            return Effect.fail(this.error(
              operation,
              new Reason.BackendFailure({
                kind: "Rejected",
                method: "input",
                metadata: {},
                hint:
                  `A held input's release failed (${owner.page.inputState.broken.value}), so the page's input state is unknown`
              }),
              id
            ))
          }
          sent = true
          return owner.runtime.model.adapter.dispatchInput(owner.page.id, events).pipe(
            Effect.mapError((error): Runtime.SendFailure => Operation.fromAdapter(error, id, owner.runtime.backend)),
            Effect.raceFirst(Runtime.promptBlocked(owner.page, true)),
            Effect.mapError((failure) =>
              // The input may have reached the page: the error says so, and nothing is sent again
              failure._tag === "Gone"
                ? failure.error
                : failure._tag === "Reason"
                ? this.error(operation, failure.reason, id, { _tag: "MayHaveBeenSent" })
                : this.error(
                  operation,
                  new Reason.BackendFailure({ kind: "Rejected", method: "input", metadata: {}, hint: "deadline" }),
                  id,
                  { _tag: "MayHaveBeenSent" }
                )
            )
          )
        })
      while (true) {
        const left = Operation.millisLeft(budget.at)
        if (left <= 0) return yield* Effect.fail(timedOut())
        const first = yield* round(Math.min(1000, left), false).pipe(
          Effect.catch((failure) => failure._tag === "Deadline" ? Effect.fail(timedOut()) : Effect.fail(failure)),
          Effect.flatMap(settle)
        )
        if (Option.isNone(first)) continue
        // Input to a page is serialized; acquiring the permit takes from the deadline, and the checks run again
        const outcome = yield* owner.page.input.withPermit(Effect.gen({ self: this }, function*() {
          const again = yield* round(Math.min(1000, Operation.millisLeft(budget.at)), options?.trial !== true).pipe(
            Effect.catch((failure) => failure._tag === "Deadline" ? Effect.fail(timedOut()) : Effect.fail(failure)),
            Effect.flatMap(settle)
          )
          if (Option.isNone(again)) return "again" as const
          // A trial stops at the last check, holding the permit as the action would
          if (options?.trial === true) return "done" as const
          const done = yield* perform(again.value, send, id)
          if (done === "done") return "done" as const
          // The guard stopped the gesture before the page saw it: nothing happened, so check again
          sent = false
          Operation.appendObservation(history, done.retry)
          return "again" as const
        })).pipe(
          Effect.timeoutOption(Operation.millisLeft(budget.at)),
          Effect.flatMap(Option.match({ onNone: () => Effect.fail(timedOut()), onSome: Effect.succeed }))
        )
        if (outcome === "done") return
      }
    }).pipe(
      Effect.raceFirst(Runtime.pageEnded(owner.page, Operation.operationId())),
      Effect.withSpan(operation, {
        attributes: {
          "browser.locator": this.description,
          "browser.page.id": owner.page.id,
          ...(options?.checks === undefined ? {} : { "browser.action.checks": JSON.stringify(options.checks) }),
          ...(extra.redacted === true ? { "browser.action.redacted": true } : {})
        }
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
