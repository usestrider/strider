/**
 * Locators (API.md, Locators, actions, and actionability). A locator is data: the engine's
 * steps, resolved again on every attempt. Built: the queries and chainers, frames, every read, every action,
 * `evaluate` and `snapshot`.
 *
 * A frame locator is a boundary in the steps: the runtime resolves each document's part
 * with that document's engine. An action in a frame answers its point in the frame's viewport; the origin of each
 * iframe on the way is added to it, outermost last, and the pointer must reach the iframe at that point in each
 * parent document as well as the element in its own.
 *
 * An action checks in rounds in the page, at each frame, until its checks pass; then it takes the page's input
 * permit, checks once more and does its part in the page (focus, select, scroll), and sends its input, built from
 * the page's input state (`input.ts`). A pointer gesture is guarded: if its first trusted event lands outside the
 * element, the page never sees it, and the action checks again.
 */
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Equal from "effect/Equal"
import * as Exit from "effect/Exit"
import * as Hash from "effect/Hash"
import * as Inspectable from "effect/Inspectable"
import * as Option from "effect/Option"
import { pipeArguments } from "effect/Pipeable"
import * as Redacted from "effect/Redacted"
import * as SubscriptionRef from "effect/SubscriptionRef"
import type * as AriaRole from "../AriaRole.ts"
import * as Deadline from "../Deadline.ts"
import type * as Diagnostics from "../Diagnostics.ts"
import type * as FileInput from "../FileInput.ts"
import type * as JSHandle from "../JSHandle.ts"
import type * as Keyboard from "../Keyboard.ts"
import * as Locator from "../Locator.ts"
import type * as Mouse from "../Mouse.ts"
import * as Protocol from "../protocol/Protocol.ts"
import * as Reason from "../Reason.ts"
import type * as Snapshot from "../Snapshot.ts"
import * as Target from "../Target.ts"
import * as Access from "./access.ts"
import type * as Adapter from "./adapter.ts"
import * as BrowserClock from "./browserClock.ts"
import * as Devices from "./devices.ts"
import * as Engine from "./engine.ts"
import * as Evaluation from "./evaluation.ts"
import type * as Execution from "./execution.ts"
import * as FileInputImpl from "./fileInput.ts"
import * as Filters from "./filters.ts"
import * as Geometry from "./geometry.ts"
import * as Input from "./input.ts"
import * as Keys from "./keys.ts"
import type { Locate, Owner } from "./locatorOwner.ts"
import * as Operation from "./operation.ts"
import * as Recorders from "./recorders.ts"
import * as Runtime from "./runtime.ts"
import * as Snapshots from "./snapshot.ts"
import { describeSteps, matcher, queries, type Relative, roleStep } from "./steps.ts"

// ── Locators ──────────────────────────────────────────────────────────────────────────────────────────────

/** The frames `stable` waits for unless the call says otherwise. */
const defaultFrames = 2

type CheckSet = Omit<Engine.Checks, "stable"> & { readonly stable: boolean }

/** A round that passed: the engine's answer with its point in the page's viewport, where it ran, and its frame's origin. */
interface Ready {
  readonly response: Extract<Engine.Response, { _tag: "Ready" }>
  readonly routed: Runtime.Routed
  readonly origin: { readonly x: number; readonly y: number }
}

/** The checks each action documents (API.md, Locators, actions, and actionability). */
const pointerChecks: CheckSet = {
  rendered: true,
  visible: true,
  enabled: true,
  editable: false,
  notInert: true,
  inViewport: true,
  stable: true,
  receivesPointer: true
}
const editChecks: CheckSet = {
  rendered: false,
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
  rendered: checks?.rendered ?? defaults.rendered,
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

/** What a `NotReady` reason says, as a timeout's hint, suggesting focus emulation only where the backend has it. */
const explain = (reason: Engine.NotReady, frames: number, emulatesFocus: boolean): string => {
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
      return "The page rendered no frame: a page in the background, such as the opener of a popup on Chromium, may render none; page.activate brings it to the front" +
        (emulatesFocus
          ? ", and a context made with newContext({ focus: \"emulated\" }) keeps every page rendering"
          : "")
    case "Covered":
      return `Another element covers the element's action point: ${reason.by}`
    case "Intercepted":
      return `The element was covered when the input arrived, and the page never saw it: ${reason.by}`
    case "ReadOnly":
      return "The element is read-only"
    case "NoSuchOption":
      return `The select has no option with that ${reason.option}`
    case "PreparingFocus":
      return `Focus was being moved from ${reason.from} before filling the target`
  }
}

/** A ref that no longer points at its node, and what to do about it. */
export const staleRef = (why: Engine.Stale): Locator.StaleRef =>
  new Locator.StaleRef({
    why,
    hint: why === "Replaced"
      ? "The ref's document was replaced; take a new snapshot"
      : why === "Detached"
      ? "The ref's node was removed from its document; take a new snapshot"
      : why === "Suspended"
      ? "The ref's document is in the back/forward cache; take a new snapshot"
      : why === "BindingLost"
      ? "The page's engine was installed again, and its refs went with it; take a new snapshot"
      : "No snapshot of this document gave this ref; use one of a snapshot's refs"
  })

const LocatorTypeId = "~@usestrider/browser/Locator"

/**
 * An HTML drag the page dispatches, run in the isolated world with the element and the
 * target: untrusted events sharing one `DataTransfer`, in the order HTML's drag-and-drop model fires them, with a
 * drop only where the `dragover` was canceled. Its points are the positions given, from each padding box, or the
 * centres; the target's events go to the element at its point when that is in the target. Returns what came of it.
 */
const syntheticDrag = (
  source: Element,
  target: Element,
  from: { readonly x: number; readonly y: number } | null,
  to: { readonly x: number; readonly y: number } | null,
  keys: { readonly altKey: boolean; readonly ctrlKey: boolean; readonly metaKey: boolean; readonly shiftKey: boolean }
): "dropped" | "refused" | "canceled" => {
  const pointIn = (element: Element, position: { readonly x: number; readonly y: number } | null) => {
    const box = element.getBoundingClientRect()
    return position === null
      ? { x: box.left + box.width / 2, y: box.top + box.height / 2 }
      : { x: box.left + element.clientLeft + position.x, y: box.top + element.clientTop + position.y }
  }
  const start = pointIn(source, from)
  const end = pointIn(target, to)
  const hit = source.ownerDocument.elementFromPoint(end.x, end.y)
  const over = hit !== null && (hit === target || target.contains(hit)) ? hit : target
  const dataTransfer = new DataTransfer()
  const fire = (element: Element, type: string, at: { readonly x: number; readonly y: number }) =>
    element.dispatchEvent(
      new DragEvent(type, {
        bubbles: true,
        cancelable: type !== "dragleave" && type !== "dragend",
        composed: true,
        dataTransfer,
        clientX: at.x,
        clientY: at.y,
        ...keys
      })
    )
  if (!fire(source, "dragstart", start)) return "canceled"
  fire(source, "drag", start)
  fire(over, "dragenter", end)
  const accepted = !fire(over, "dragover", end)
  if (accepted) fire(over, "drop", end)
  else {
    dataTransfer.dropEffect = "none"
    fire(over, "dragleave", end)
  }
  fire(source, "dragend", end)
  return accepted ? "dropped" : "refused"
}

/** How a snapshot of this owner's page makes the locator for a ref. */
export const locatorOn = (owner: Owner): Locate => (steps, label) => new LocatorImpl(owner, steps, label)

export class LocatorImpl extends Inspectable.Class implements Locator.Locator {
  readonly [LocatorTypeId] = LocatorTypeId as typeof LocatorTypeId
  readonly owner: Owner
  readonly steps: ReadonlyArray<Engine.Step>
  readonly label: Option.Option<string>
  constructor(owner: Owner, steps: ReadonlyArray<Engine.Step>, label: Option.Option<string> = Option.none()) {
    super()
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
  frame(iframe: Locator.ReadonlyLocator): Locator.FrameLocator {
    const other = this.samePageLocator(iframe, "frame")
    const mine = Runtime.split(this.steps)
    const theirs = Runtime.split(other.steps)
    if (JSON.stringify(mine.frames) !== JSON.stringify(theirs.frames)) {
      throw new Error("Locator.frame: the iframe's locator is in another frame than this one")
    }
    // The iframe under this locator: its own steps when it was built from this one, or its query applied here
    const steps = startsWith(other.steps, this.steps) ? other.steps : [...this.steps, ...theirs.last]
    return frameLocator(this.owner, steps)
  }
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
    return this.with([...this.steps, { _tag: "And", other: this.sameDocument(other, "and") }])
  }
  or(other: Locator.ReadonlyLocator) {
    return this.with([...this.steps, { _tag: "Or", other: this.sameDocument(other, "or") }])
  }
  nth(index: number) {
    return this.with([...this.steps, { _tag: "Nth", index }])
  }
  get first() {
    return this.with([...this.steps, { _tag: "First" }])
  }
  get last() {
    return this.with([...this.steps, { _tag: "Last" }])
  }
  describe(label: string) {
    return new LocatorImpl(this.owner, this.steps, Option.some(label))
  }

  // The other locator's steps in this one's document; one from another page or frame is a mistake in the code, a
  // defect
  private sameDocument(other: Locator.ReadonlyLocator, member: string): ReadonlyArray<Engine.Step> {
    if (!(other instanceof LocatorImpl) || other.owner.page.id !== this.owner.page.id) {
      throw new Error(`Locator.${member}: the other locator belongs to another page`)
    }
    const mine = Runtime.split(this.steps)
    const theirs = Runtime.split(other.steps)
    if (JSON.stringify(mine.frames) !== JSON.stringify(theirs.frames)) {
      throw new Error(`Locator.${member}: the other locator is in another frame`)
    }
    return theirs.last
  }

  // ── Reads ──

  get count() {
    return this.read(
      "Locator.count",
      { op: "count", steps: this.steps },
      (response, id) =>
        response._tag === "Count"
          ? Effect.succeed(response.count)
          : this.unmatched("Locator.count", response, id)
    )
  }

  get boundingBox() {
    const operation = "Locator.boundingBox"
    return Effect.scoped(Effect.gen({ self: this }, function*() {
      yield* Access.check(this.owner.grant)
      const record = yield* Operation.record
      const runtime = this.owner.runtime
      const sendFailure = (failure: Runtime.SendFailure) =>
        failure._tag === "Deadline"
          ? record.timeout(Option.fromUndefinedOr(failure.hint))
          : this.sendFailure(operation, failure, record)
      const noMatch = () =>
        Effect.fail(
          this.error(
            operation,
            new Locator.NoMatch({ hint: "A read never waits; Expect waits for what it expects" }),
            record.id
          )
        )
      const release = (node: Adapter.NodeBinding) => Operation.detached(runtime.model.adapter.releaseNodes([node]))
      const resolve = () =>
        Effect.acquireRelease(
          Runtime.element(runtime, this.owner.page, this.steps, record.id, record.budget.at).pipe(
            Effect.mapError(sendFailure)
          ),
          (found) => found._tag === "Found" ? release(found.node) : Effect.void
        )
      const found = yield* resolve()
      if (found._tag === "Response") {
        if (found.response._tag === "NoMatch") return yield* noMatch()
        return yield* this.unmatched(operation, found.response, record.id)
      }
      const read = (node: Adapter.NodeBinding, kind: Geometry.Kind) =>
        runtime.model.adapter.geometry(node, kind).pipe(
          Effect.mapError((error) => this.adapterFailure(operation, error, record.id))
        )
      const target = yield* read(found.node, "bounds")
      if (target.data.quads.length === 0) return Option.none<Locator.BoundingBox>()
      let points = target.data.quads.flat()
      let space = target.document
      const documents = [...found.routed.hops.map((hop) => hop.document), found.routed.document]
      for (let index = found.routed.hops.length - 1; index >= 0; index--) {
        const hop = found.routed.hops[index]!
        const parent = yield* Effect.acquireRelease(
          Runtime.elementIn(runtime, hop.document, hop.steps, { scroll: false }, record.id).pipe(
            Effect.mapError(sendFailure)
          ),
          (parent) => Option.isSome(parent) && parent.value._tag === "Found" ? release(parent.value.node) : Effect.void
        )
        if (Option.isNone(parent)) return yield* noMatch()
        if (parent.value._tag === "Response") {
          if (parent.value.response._tag === "NoMatch") return yield* noMatch()
          return yield* this.unmatched(operation, parent.value.response, record.id)
        }
        const node = parent.value.node
        const frame = yield* runtime.model.adapter.contentFrame(node).pipe(
          Effect.mapError((error) => this.adapterFailure(operation, error, record.id))
        )
        if (Option.isNone(frame) || frame.value !== hop.frame) return yield* noMatch()
        const active = yield* runtime.model.documentOf(hop.frame)
        if (Option.isNone(active) || active.value !== documents[index + 1]) return yield* noMatch()
        const needsMapping = space === documents[index + 1]
        if (!needsMapping && !documents.slice(0, index + 1).includes(space)) return yield* noMatch()
        const geometry = yield* read(node, needsMapping ? "frame" : "bounds")
        if (geometry.data.quads.length === 0) return Option.none<Locator.BoundingBox>()
        if (needsMapping) {
          if (geometry.data.matrix === null) {
            return yield* Effect.fail(
              this.error(
                operation,
                new Reason.Unsupported({
                  capability: operation,
                  backend: runtime.backend,
                  hint: "The browser did not expose the frame's projected plane"
                }),
                record.id
              )
            )
          }
          points = points.map((point) => Geometry.project(geometry.data.matrix!, point))
          space = geometry.document
        }
      }
      if (space !== documents[0]) return yield* noMatch()
      if (points.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y))) {
        return yield* Effect.fail(
          this.error(
            operation,
            new Reason.Unsupported({
              capability: operation,
              backend: runtime.backend,
              hint: "The frame projection crosses a non-finite camera plane"
            }),
            record.id
          )
        )
      }
      const x = Math.min(...points.map((p) => p.x)), y = Math.min(...points.map((p) => p.y))
      return Option.some({
        x,
        y,
        width: Math.max(...points.map((p) => p.x)) - x,
        height: Math.max(...points.map((p) => p.y)) - y
      })
    })).pipe(
      Operation.named(operation, {
        attributes: { "browser.page.id": this.owner.page.id, "browser.locator": this.description }
      })
    )
  }

  get isVisible() {
    return this.read(
      "Locator.isVisible",
      { op: "visible", steps: this.steps },
      (response, id) =>
        response._tag === "Visible"
          ? Effect.succeed(response.visible)
          : this.unmatched("Locator.isVisible", response, id)
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
  get isEditable() {
    return this.readOne("Locator.isEditable", { _tag: "Editable" }, (value) => value as boolean)
  }
  get isEnabled() {
    return this.readOne("Locator.isEnabled", { _tag: "Enabled" }, (value) => value as boolean)
  }
  get isChecked() {
    return this.readOne("Locator.isChecked", { _tag: "Checked" }, (value) => value as boolean)
  }
  /** A snapshot of the one match's subtree, now: a read, so it never waits. */
  snapshot(options?: Snapshot.Options) {
    const operation = "Locator.snapshot"
    return Effect.gen({ self: this }, function*() {
      yield* Access.check(this.owner.grant)
      const record = yield* Operation.record
      const id = record.id
      const taken = yield* Snapshots.take(this.owner, locatorOn(this.owner), this.steps, options, id, record.budget.at)
        .pipe(
          Effect.mapError((failure) => this.sendFailure(operation, failure, record))
        )
      if (taken._tag === "Taken") return taken.snapshot as Snapshot.Snapshot<Locator.Locator>
      if (taken.response._tag === "NoMatch") {
        return yield* Effect.fail(this.error(
          operation,
          new Locator.NoMatch({ hint: "A snapshot never waits; Expect waits for what it expects" }),
          id
        ))
      }
      return yield* this.unmatched(operation, taken.response, id)
    }).pipe(Operation.named(operation, {
      attributes: { "browser.page.id": this.owner.page.id, "browser.locator": this.description }
    }))
  }

  /**
   * Calls `fn` in the caller's isolated world of the one match's document, with the match first:
   * resolved now, as a read is, and passed by its node binding, since the engine's world isn't the
   * caller's.
   */
  evaluate<Args extends ReadonlyArray<unknown>, B>(
    fn: (element: Element, ...args: Args) => B | Promise<B>,
    ...args: Args
  ): Effect.Effect<JSHandle.Serialized<B>, Locator.LocatorError | Target.TargetGone | Deadline.Timeout> {
    const operation = "Locator.evaluate"
    const owner = this.owner
    return Effect.gen({ self: this }, function*() {
      yield* Access.check(owner.grant)
      const record = yield* Operation.record
      const id = record.id
      const budget = record.budget
      const found = yield* Runtime.element(owner.runtime, owner.page, this.steps, id, budget.at).pipe(
        Effect.mapError((failure) => this.sendFailure(operation, failure, record))
      )
      if (found._tag === "Response") {
        const response = found.response
        switch (response._tag) {
          case "NoMatch":
            return yield* Effect.fail(this.error(
              operation,
              new Locator.NoMatch({ hint: "evaluate resolves the match now and never waits; Expect waits for it" }),
              id
            ))
          case "InvalidSelector":
            return yield* Effect.fail(this.invalidSelector(operation, response, id))
          default:
            return yield* this.unmatched(operation, response, id)
        }
      }
      const value = yield* Effect.gen(function*() {
        const realm = yield* Evaluation.documentRealm(
          owner.runtime,
          found.routed.document,
          Evaluation.isolatedWorld,
          id
        )
        const rest = yield* Evaluation.toLocal(args, realm, 1)
        // The call is on its way: a deadline after it can't say the function didn't run
        const result = yield* Evaluation.call(owner.runtime, {
          dispatch: record,
          realm,
          functionDeclaration: fn.toString(),
          arguments: [{ _tag: "Node", node: found.node }, ...rest],
          result: "value",
          userActivation: false,
          page: Option.some(owner.page),
          at: budget.at,
          id
        })
        return yield* Evaluation.fromRemote(result)
      }).pipe(Effect.mapError((failure) =>
        failure._tag === "Gone"
          ? failure.error
          : failure._tag === "Deadline"
          ? record.timeout(
            record.dispatch._tag === "MayHaveBeenSent"
              ? Option.some("The page didn't answer before the deadline; the function may still be running")
              : Option.none()
          )
          : this.error(operation, failure.reason, id)
      ))
      return value as JSHandle.Serialized<B>
    }).pipe(Operation.named(operation, {
      attributes: { "browser.page.id": this.owner.page.id, "browser.locator": this.description }
    }))
  }

  /** Evaluates the fixed membership snapshot in the caller’s isolated world. */
  evaluateAll<Args extends ReadonlyArray<unknown>, B>(
    fn: (elements: Array<Element>, ...args: Args) => B | Promise<B>,
    ...args: Args
  ): Effect.Effect<JSHandle.Serialized<B>, Locator.LocatorError | Target.TargetGone | Deadline.Timeout> {
    const operation = "Locator.evaluateAll"
    const owner = this.owner
    return Effect.gen({ self: this }, function*() {
      yield* Access.check(owner.grant)
      const record = yield* Operation.record
      const id = record.id
      const budget = record.budget
      if (record.left() <= 0) return yield* Effect.fail(record.timeout(Option.none()))
      yield* this.requires(operation, "isolatedWorlds", id)
      const found = yield* Runtime.elements(owner.runtime, owner.page, this.steps, id, budget.at).pipe(
        Effect.mapError((failure) => this.sendFailure(operation, failure, record))
      )
      if (found._tag === "Response") {
        const response = found.response
        switch (response._tag) {
          case "InvalidSelector":
            return yield* Effect.fail(this.invalidSelector(operation, response, id))
          default:
            return yield* this.unmatched(operation, response, id)
        }
      }
      const value = yield* Effect.gen(function*() {
        const realm = yield* Evaluation.documentRealm(
          owner.runtime,
          found.routed.document,
          Evaluation.isolatedWorld,
          id
        )
        const rest = yield* Evaluation.toLocal(args, realm, 1)
        // The call is on its way: a deadline after it can't say the function didn't run
        const result = yield* Evaluation.call(owner.runtime, {
          dispatch: record,
          realm,
          functionDeclaration:
            `function(...values) { return (${fn.toString()})(values.slice(0, ${found.nodes.length}), ...values.slice(${found.nodes.length})); }`,
          arguments: [...found.nodes.map((node): Adapter.LocalValue => ({ _tag: "Node", node })), ...rest],
          result: "value",
          releaseResult: true,
          userActivation: false,
          page: Option.some(owner.page),
          at: budget.at,
          id
        })
        return yield* Evaluation.fromRemote(result)
      }).pipe(Effect.mapError((failure) =>
        failure._tag === "Gone"
          ? failure.error
          : failure._tag === "Deadline"
          ? record.timeout(
            record.dispatch._tag === "MayHaveBeenSent"
              ? Option.some("The page didn't answer before the deadline; the function may still be running")
              : Option.none()
          )
          : this.error(operation, failure.reason, id)
      ))
      return value as JSHandle.Serialized<B>
    }).pipe(Operation.named(operation, {
      attributes: { "browser.page.id": this.owner.page.id, "browser.locator": this.description }
    }))
  }

  /** A one-shot read of the one match: strict, and immediate. */
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
          return this.unmatched(operation, response, id)
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
  blur(options?: Locator.ActionOptions) {
    return this.act("Locator.blur", options, noChecks, { _tag: "Blur" }, () => Effect.succeed("done" as const))
  }
  focus(options?: Locator.ActionOptions) {
    return this.act("Locator.focus", options, focusChecks, { _tag: "Focus" }, () => Effect.succeed("done" as const))
  }
  selectText(options?: Locator.ActionOptions) {
    return this.act(
      "Locator.selectText",
      options,
      { ...noChecks, visible: true },
      { _tag: "SelectText" },
      () => Effect.succeed("done" as const)
    )
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
      const layout = Devices.layoutOf(this.owner.runtime, this.owner.page)
      if (Keys.strokes(key, layout) === undefined) return Effect.fail(this.unknownKey("Locator.press", key))
      return this.act(
        "Locator.press",
        options,
        focusChecks,
        { _tag: "Focus" },
        (_ready, io) =>
          Effect.as(
            io.send(Input.type(this.owner.page.inputState, key, layout, options?.modifiers ?? [])!),
            "done" as const
          )
      )
    })
  }
  pressSequentially(text: string | Redacted.Redacted<string>, options?: Locator.TypeOptions) {
    const value = Redacted.isRedacted(text) ? Redacted.value(text) : text
    if (typeof value !== "string") {
      return Effect.fail(this.error(
        "Locator.pressSequentially",
        new Reason.InvalidInput({
          input: "text",
          expected: "a string or Redacted string",
          hint: "PressSequentially requires text"
        }),
        Operation.idNow()
      ))
    }
    const characters = Array.from(value)
    const delay = options?.delay === undefined ? Duration.zero : Duration.fromInputUnsafe(options.delay)
    return this.act(
      "Locator.pressSequentially",
      options,
      focusChecks,
      { _tag: "Focus" },
      (_ready, io, record) =>
        Effect.as(
          Effect.forEach(characters, (character, index) =>
            Effect.andThen(
              // On the deadline's clock, the browser's: Effect's would stop under TestClock (QUIRKS.md, Q235)
              index > 0 && Duration.isGreaterThan(delay, Duration.zero)
                ? record.clock.sleep(Duration.toMillis(delay))
                : Effect.void,
              io.send(
                Input.type(
                  this.owner.page.inputState,
                  character,
                  Devices.layoutOf(this.owner.runtime, this.owner.page)
                )!
              )
            ), { discard: true }),
          "done" as const
        ),
      { redacted: Redacted.isRedacted(text) }
    )
  }
  dispatchEvent(type: string, options?: Locator.DispatchEventOptions) {
    const operation = "Locator.dispatchEvent"
    const owner = this.owner
    return Effect.gen({ self: this }, function*() {
      yield* Access.check(owner.grant)
      const record = yield* Operation.record
      const hint = () =>
        record.dispatch._tag === "MayHaveBeenSent"
          ? Option.some("The event may have been dispatched; it will not be sent again")
          : Option.some("Waiting for one element to match the locator")
      const attempt = Effect.gen({ self: this }, function*() {
        if (record.left() <= 0) return yield* Effect.fail(record.timeout(hint()))
        const id = record.id
        const found = yield* Runtime.element(owner.runtime, owner.page, this.steps, id, record.budget.at).pipe(
          Effect.mapError((failure) => this.sendFailure(operation, failure, record))
        )
        if (found._tag === "Response") {
          if (found.response._tag === "NoMatch") return { retry: { _tag: "NoMatch" } } as const
          return yield* this.unmatched(operation, found.response, id)
        }
        if (options?.trial === true) return "done" as const
        const result = yield* Effect.gen(function*() {
          // A frame may commit while its engine is installed; the node identifies the document that returned it.
          const realm = yield* Evaluation.documentRealm(
            owner.runtime,
            found.node.document,
            yield* Runtime.ownWorld(owner.runtime, Evaluation.isolatedWorld),
            id
          )
          const args = yield* Evaluation.toLocal([{
            type,
            eventClass: options?.eventClass ?? "Event",
            init: options?.init ?? {}
          }], realm)
          if (record.left() <= 0) return yield* Effect.fail({ _tag: "Deadline" } as const)
          const remote = yield* Evaluation.call(owner.runtime, {
            dispatch: record,
            realm,
            functionDeclaration: dispatchDOMEvent.toString(),
            arguments: [{ _tag: "Node", node: found.node }, ...args],
            result: "value",
            userActivation: false,
            page: Option.some(owner.page),
            at: record.budget.at,
            id
          })
          return yield* Evaluation.fromRemote(remote)
        }).pipe(Effect.mapError((failure) =>
          failure._tag === "Gone" ?
            failure.error
            : failure._tag === "Deadline" ?
            record.timeout(hint())
            : this.error(operation, failure.reason, id, record.dispatch)
        ))
        if (result === "detached") {
          record.markNotSent()
          return { retry: { _tag: "NoMatch" } } as const
        }
        if (result === "unsupported") {
          record.markNotSent()
          return yield* Effect.fail(this.error(
            operation,
            new Reason.Unsupported({
              capability: "dom.eventConstructor",
              backend: owner.runtime.backend,
              hint: "The target document does not provide the requested native event constructor"
            }),
            id
          ))
        }
        if (result === "invalid") {
          record.markNotSent()
          return yield* Effect.fail(this.error(
            operation,
            new Reason.InvalidInput({
              input: "event initialization",
              expected: "initialization accepted by the native event constructor",
              hint: "Use fields supported by the selected event class; DOM references cannot cross by value"
            }),
            id
          ))
        }
        record.markConfirmed()
        return "done" as const
      })
      while (true) {
        const outcome = yield* record.bound(owner.page.input.withPermit(attempt), hint)
        if (outcome === "done") return
        record.observe(outcome.retry)
        yield* record.bound(BrowserClock.sleep(50), hint)
      }
    }).pipe(
      Effect.raceFirst(Runtime.pageEnded(owner.page)),
      Operation.named(operation, {
        attributes: { "browser.page.id": owner.page.id, "browser.locator": this.description }
      }),
      Effect.provideService(Recorders.CurrentSubject, Option.some({ steps: this.steps, secret: false }))
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
      (_ready, _io, record) =>
        Effect.gen({ self: this }, function*() {
          const id = record.id
          const given = yield* FileInputImpl.prepare(owner.runtime, list).pipe(
            Effect.mapError((reason) => this.error("Locator.setInputFiles", reason, id))
          )
          if (given._tag === "Paths" && Option.isSome(owner.runtime.fileSystem)) {
            for (let index = 0; index < list.length; index++) {
              if (FileInputImpl.source(list[index]!)._tag !== "Local") continue
              const path = given.files[index]!
              const exists = yield* owner.runtime.fileSystem.value.exists(path).pipe(Effect.orElseSucceed(() => false))
              if (!exists) {
                return yield* Effect.fail(
                  this.error(
                    "Locator.setInputFiles",
                    new Locator.FileUnreadable({ path, hint: "No file is at that path on this machine" }),
                    id
                  )
                )
              }
            }
          }
          const budget = record.budget
          const found = yield* Runtime.element(owner.runtime, owner.page, this.steps, id, budget.at).pipe(
            Effect.mapError((failure) => this.sendFailure("Locator.setInputFiles", failure, record))
          )
          // The input went between the checks and now: check again
          if (found._tag !== "Found") return { retry: { _tag: "NoMatch" } } as const
          if (given._tag === "Made") {
            record.markSent()
            yield* FileInputImpl.setMade(owner.runtime, found.node, given.files, {
              dispatch: record,
              page: Option.some(owner.page),
              at: budget.at,
              id
            }).pipe(Effect.mapError((failure) =>
              failure._tag === "Gone"
                ? failure.error
                : failure._tag === "Deadline"
                ? record.timeout(
                  Option.some("The page didn't answer before the deadline; the files may have been set")
                )
                : this.error("Locator.setInputFiles", failure.reason, id)
            ))
            return "done" as const
          }
          yield* FileInputImpl.validateCount(owner.runtime, found.node, given.files.length, {
            page: Option.some(owner.page),
            at: budget.at,
            id
          }).pipe(Effect.mapError((failure) =>
            failure._tag === "Gone"
              ? failure.error
              : failure._tag === "Deadline"
              ? record.timeout(Option.none())
              : this.error("Locator.setInputFiles", failure.reason, id)
          ))
          yield* owner.runtime.model.adapter.setInputFiles(found.node, given.files).pipe(
            Effect.mapError((error) => this.adapterFailure("Locator.setInputFiles", error, id))
          )
          return "done" as const
        })
    )
  }
  dragTo(target: Locator.ReadonlyLocator, options?: Locator.DragOptions) {
    const to = this.samePageLocator(target, "dragTo")
    const steps = options?.steps ?? 1
    const html = options?.html ?? "native"
    return this.pointer(
      "Locator.dragTo",
      options,
      (state, point, targetPoint) => Input.drag(state, point, targetPoint!, steps, options?.modifiers ?? []),
      {
        target: Effect.suspend(() => to.pointOf(options?.targetPosition, options?.checks?.rendered)),
        draggable: (record, io) =>
          html === "native"
            // An HTML drag is a capability: Firefox never drops one, and WebKit's protocol can't
            ? Effect.as(
              this.requires(
                "Locator.dragTo",
                "input.dragAndDrop",
                record.id,
                `dragTo(target, { html: "synthetic" }) has the page dispatch the drag's events, untrusted`
              ),
              "gesture" as const
            )
            : Effect.andThen(io.disarm, this.syntheticDrag(to, options, record)),
        position: options?.position
      }
    ).pipe(
      Effect.annotateSpans({
        "browser.locator.target": to.description,
        "browser.drag.steps": steps,
        "browser.drag.html": html
      })
    )
  }

  /**
   * An HTML drag the page dispatches: the element and the target resolved now, in one
   * document, and the drag's events sent there from the isolated world, sharing one `DataTransfer`.
   */
  private syntheticDrag(to: LocatorImpl, options: Locator.DragOptions | undefined, record: Operation.Record) {
    const operation = "Locator.dragTo"
    const owner = this.owner
    const id = record.id
    return Effect.gen({ self: this }, function*() {
      const budget = record.budget
      const resolve = (locator: LocatorImpl) =>
        Runtime.element(owner.runtime, owner.page, locator.steps, id, budget.at).pipe(
          Effect.mapError((failure) => this.sendFailure(operation, failure, record)),
          Effect.flatMap((found) =>
            found._tag === "Found"
              ? Effect.succeed(found)
              : Effect.fail(this.error(
                operation,
                new Locator.NoMatch({ hint: `${locator.description} matched no one element as the drag began` }),
                id
              ))
          )
        )
      const source = yield* resolve(this)
      const target = yield* resolve(to)
      if (source.routed.document !== target.routed.document) {
        return yield* Effect.fail(this.error(
          operation,
          new Reason.InvalidInput({
            input: "target",
            expected: "an element in the dragged element's document",
            hint: "A synthetic drag shares one DataTransfer, which doesn't cross documents"
          }),
          id
        ))
      }
      const keys = options?.modifiers ?? []
      const outcome = yield* Effect.gen(function*() {
        // The library's own function: the page's world where the backend makes no other
        const realm = yield* Evaluation.documentRealm(
          owner.runtime,
          source.routed.document,
          yield* Runtime.ownWorld(owner.runtime, Evaluation.isolatedWorld),
          id
        )
        const rest = yield* Evaluation.toLocal(
          [
            options?.position ?? null,
            options?.targetPosition ?? null,
            {
              altKey: keys.includes("Alt"),
              ctrlKey: keys.includes("Control"),
              metaKey: keys.includes("Meta"),
              shiftKey: keys.includes("Shift")
            }
          ],
          realm,
          2
        )
        // From here the drag's events may have been sent
        const result = yield* Evaluation.call(owner.runtime, {
          dispatch: record,
          realm,
          functionDeclaration: syntheticDrag.toString(),
          arguments: [{ _tag: "Node", node: source.node }, { _tag: "Node", node: target.node }, ...rest],
          result: "value",
          userActivation: false,
          page: Option.some(owner.page),
          at: budget.at,
          id
        })
        return yield* Evaluation.fromRemote(result)
      }).pipe(Effect.mapError((failure) =>
        failure._tag === "Gone"
          ? failure.error
          : failure._tag === "Deadline"
          ? record.timeout(
            record.dispatch._tag === "MayHaveBeenSent"
              ? Option.some("The page didn't answer before the deadline; the drag's events may have been sent")
              : Option.none()
          )
          : this.error(operation, failure.reason, id)
      ))
      yield* Effect.annotateCurrentSpan("browser.drag.outcome", String(outcome))
      return "done" as const
    })
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
            hint: final.hint ?? "The locator found an element of another kind; narrow it to the one meant"
          }),
          id
        )
      case "NotEditable":
        return this.error(
          operation,
          new Locator.NotEditable({
            element: final.element,
            hint: "Only inputs, textareas, and contenteditable elements take text"
          }),
          id
        )
      case "Refused":
        return this.error(
          operation,
          new Reason.InvalidInput({
            input: "value",
            expected: `a value ${final.element} takes`,
            hint: "Use a value the input accepts, such as a finite number for number inputs or 2026-10-23 for dates"
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
      Operation.idNow()
    )
  }

  private unexpected(response: Engine.Response): Effect.Effect<never> {
    return Effect.die(new Error(`The engine answered ${response._tag} unexpectedly`))
  }

  /**
   * An answer that isn't the one asked for: several matches, an iframe on the way that isn't one, a selector that
   * doesn't parse, a ref that went stale, or a bug.
   */
  unmatched(
    operation: string,
    response: Engine.Response,
    id: Diagnostics.OperationId
  ): Effect.Effect<never, Locator.LocatorError> {
    switch (response._tag) {
      case "Strict":
        return Effect.fail(this.strict(operation, response, id))
      case "Final":
        return Effect.fail(this.final(operation, response.final, id))
      case "InvalidSelector":
        return Effect.fail(this.invalidSelector(operation, response, id))
      case "StaleRef":
        return Effect.fail(this.error(operation, staleRef(response.why), id))
      default:
        return this.unexpected(response)
    }
  }

  /** Maps a failure to send a request onto the operation's errors: a deadline as the record's `Timeout`. */
  sendFailure(operation: string, failure: Execution.Failure, record: Operation.Record) {
    switch (failure._tag) {
      case "Timeout":
      case "TargetGone":
        return failure
      case "Gone":
        return failure.error
      case "Reason":
        return this.error(operation, failure.reason, record.id)
      case "Deadline":
        return record.timeout(Option.fromUndefinedOr(failure.hint))
    }
  }

  private adapterFailure(
    operation: string,
    error: Adapter.AdapterError | Deadline.Timeout,
    id: Diagnostics.OperationId
  ) {
    const mapped = Operation.fromAdapter(error, id, this.owner.runtime.backend)
    return mapped._tag !== "Reason"
      ? mapped.error
      : this.error(operation, mapped.reason, id)
  }

  /** Fails with `Unsupported` when the backend reports a capability as unsupported. */
  private requires(operation: string, capability: string, id: Diagnostics.OperationId, instead?: string) {
    return Effect.flatMap(SubscriptionRef.get(this.owner.runtime.model.adapter.capabilities), (capabilities) => {
      const entry = capabilities.entries.find((each) => each.name === capability)
      return entry === undefined || entry.status !== "unsupported" ? Effect.void : Effect.fail(this.error(
        operation,
        new Reason.Unsupported({
          capability,
          backend: this.owner.runtime.backend,
          hint: [
            entry.limitations.join("; ") || `${this.owner.runtime.backend} can't do this`,
            ...(instead === undefined
              ? []
              : [instead])
          ].join("; ")
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
      yield* Access.check(this.owner.grant)
      const record = yield* Operation.record
      const id = record.id
      const response = yield* Runtime.send(this.owner.runtime, this.owner.page, request, id, record.budget.at).pipe(
        Effect.mapError((failure) =>
          failure._tag === "Deadline"
            ? record.timeout(Option.fromUndefinedOr(failure.hint))
            : this.sendFailure(operation, failure, record)
        )
      )
      if (response._tag === "InvalidSelector") {
        return yield* Effect.fail(this.invalidSelector(operation, response, id))
      }
      return yield* answer(response, id)
    }).pipe(Operation.named(operation, {
      attributes: { "browser.page.id": this.owner.page.id, "browser.locator": this.description }
    }))
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
        expected: response.kind === "role" ? "a role query with supported state filters" : "a CSS selector",
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

  /** A drag target's point, with visibility/viewport checks and without pointer coverage or stability checks. */
  pointOf(position: Mouse.Point | undefined, rendered?: boolean | undefined) {
    return Effect.gen({ self: this }, function*() {
      yield* Access.check(this.owner.grant)
      // A drag's target, found inside the drag: its record, and its deadline
      const record = yield* Operation.record
      const id = record.id
      const answer = yield* this.owner.page.execution.action(
        this.owner.runtime,
        this.owner.page,
        {
          op: "act",
          steps: this.steps,
          checks: checksFor(pointerChecks, { rendered, stable: false, receivesPointer: false }),
          cap: Runtime.roundCap(record.left()),
          action: {
            _tag: "Point",
            position: position === undefined ? null : { x: position.x, y: position.y },
            guard: false
          },
          apply: false
        },
        id,
        record.budget.at,
        true
      ).pipe(Effect.mapError((failure) => this.sendFailure("Locator.dragTo", failure, record)))
      if ("_tag" in answer) return Option.none()
      const response = answer.response
      if (response._tag !== "Ready" || response.point === null) return Option.none()
      if (answer.routed.hops.length === 0) return Option.some(response.point)
      const translated = yield* this.translate(
        answer.routed,
        response.point,
        { inViewport: true, receivesPointer: false },
        id
      ).pipe(Effect.mapError((failure) => this.sendFailure("Locator.dragTo", failure, record)))
      return translated._tag === "Point" ? Option.some(translated.point) : Option.none()
    })
  }

  /** `check` and `uncheck`: nothing when it is already so; else a pointer action, checking the result unless trial. */
  private setChecked(operation: string, checked: boolean, options: Locator.PointerOptions | undefined) {
    const expected = checked ? "checked" : "unchecked"
    return Effect.gen({ self: this }, function*() {
      const now = yield* this.readOne(
        operation,
        { _tag: "Checked", followLabel: true, uncheck: !checked },
        (value) => value as boolean
      ).pipe(
        Effect.catchIf(
          (error): error is Locator.LocatorError => Locator.isLocatorError(error) && error.reason._tag === "NoMatch",
          () => Effect.succeed(undefined)
        )
      )
      if (now === checked) return
      yield* this.pointer(
        operation,
        options,
        (state, point) => Input.click(state, point, "left", 1, options?.modifiers ?? []),
        { checked: true }
      )
      if (options?.trial === true) return
      const after = yield* this.readOne(operation, { _tag: "Checked", followLabel: true }, (value) => value as boolean)
      if (after !== checked) {
        return yield* Effect.fail(this.error(
          operation,
          new Locator.StateUnchanged({
            expected,
            hint: "The click reached it and its state didn't change; the page may prevent it"
          }),
          (yield* Operation.record).id
        ))
      }
    }).pipe(Operation.named(operation, {
      attributes: { "browser.page.id": this.owner.page.id, "browser.locator": this.description }
    }))
  }

  /** `fill` and `clear`: the contents selected in the page and the value inserted, or set for a non-text input. */
  private fillWith(
    operation: string,
    value: string | Redacted.Redacted<string>,
    options: Locator.ActionOptions | undefined
  ) {
    const text = Redacted.isRedacted(value) ? Redacted.value(value) : value
    if (typeof text !== "string") {
      return Effect.fail(this.error(
        operation,
        new Reason.InvalidInput({
          input: "value",
          expected: "a string or Redacted string",
          hint: "Fill requires text"
        }),
        Operation.idNow()
      ))
    }
    return this.act(
      operation,
      options,
      editChecks,
      { _tag: "Fill", value: text },
      (ready, io) => {
        if (ready.fill === "set") return Effect.succeed("done" as const)
        const insert = io.send(
          text === ""
            ? Input.press(this.owner.page.inputState, Keys.definition("Delete")!)
            : [{ _tag: "InsertText", text }]
        )
        return ready.fill === "guarded" ? io.guardFill(insert) : Effect.as(insert, "done" as const)
      },
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
      readonly checked?: boolean
      readonly target?: Effect.Effect<Option.Option<{ readonly x: number; readonly y: number }>, unknown>
      /** For an HTML drag: send the gesture, or say it was done another way. */
      readonly draggable?: (
        record: Operation.Record,
        io: { readonly disarm: Effect.Effect<Option.Option<string>> }
      ) => Effect.Effect<"gesture" | "done", Locator.LocatorError | Target.TargetGone | Deadline.Timeout>
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
      { _tag: "Point", position, guard, checked: extra.checked },
      (ready, io, record) =>
        Effect.gen({ self: this }, function*() {
          const state = owner.page.inputState
          // A drag the page dispatches carries its modifiers in its events, which every backend can
          if (ready.draggable && extra.draggable !== undefined && (yield* extra.draggable(record, io)) === "done") {
            return "done" as const
          }
          if (Input.anyModifier(state, options?.modifiers ?? [])) {
            yield* this.requires(operation, "input.pointerModifiers", record.id)
          }
          let target: { readonly x: number; readonly y: number } | undefined
          if (extra.target !== undefined) {
            const point = yield* extra.target.pipe(Effect.catch((failure) =>
              Deadline.isTimeout(failure) || Target.isTargetGone(failure) ||
                Locator.isLocatorError(failure) && failure.reason._tag === "LocatorHandlerFailed" ?
                Effect.fail(failure) :
                Effect.succeed(Option.none())
            ))
            if (Option.isNone(point)) {
              if (guard) {
                yield* io.disarm
              }
              return { retry: { _tag: "NoMatch" } } as const
            }
            target = point.value
          }
          const events = gesture(state, ready.point!, target)
          yield* io.send(events)
          const last = events.filter((event): event is Extract<Adapter.InputEvent, { _tag: "Mouse" }> =>
            event._tag === "Mouse"
          ).at(-1)
          if (last !== undefined) {
            state.position = { x: last.x, y: last.y }
          }
          if (!guard) {
            return "done" as const
          }
          const blocked = yield* io.disarm
          return Option.isSome(blocked)
            ? { retry: { _tag: "Intercepted", by: blocked.value } as Engine.NotReady }
            : "done" as const
        }).pipe(
          // A guard left armed would stop the page's next gesture: any failure after arming it removes it
          Effect.onError(() =>
            guard ? Effect.ignore(io.disarm) : Effect.void
          )
        )
    )
  }

  /** Brackets a design-mode insertion, including interruption while its guard is being installed. */
  private guardFill(
    operation: string,
    routed: Runtime.Routed,
    record: Operation.Record,
    insert: Effect.Effect<void, Locator.LocatorError | Target.TargetGone | Deadline.Timeout>
  ) {
    const targets = [
      ...routed.hops.map((hop) => ({ document: hop.document, steps: hop.steps, ancestor: true })),
      { document: routed.document, steps: Runtime.split(this.steps).last, ancestor: false }
    ]
    const documents = targets.map((target) => target.document)
    const call = (document: Target.DocumentId, request: Engine.Request) =>
      Runtime.sendToDocument(this.owner.runtime, this.owner.page, document, request, record.id).pipe(
        Effect.mapError((failure) => this.sendFailure(operation, failure, record)),
        Effect.flatMap((response) =>
          Option.isSome(response) && response.value._tag === "FillGuard"
            ? Effect.succeed(response.value)
            : Effect.fail(this.error(
              operation,
              new Reason.BackendFailure({
                kind: "Rejected",
                method: "fill guard",
                hint: "The insertion guard could not confirm the native input"
              }),
              record.id,
              record.dispatch
            ))
        )
      )
    let released = false
    const disarm = Effect.forEach(documents, (document) => call(document, { op: "fillDisarm" })).pipe(
      Effect.tap(() =>
        Effect.sync(() => {
          released = true
        })
      )
    )
    return Effect.acquireUseRelease(
      Effect.void,
      () =>
        Effect.gen({ self: this }, function*() {
          const guards = yield* Effect.forEach(targets, (target) =>
            call(target.document, { op: "fillGuard", steps: target.steps, ancestor: target.ancestor }))
          if (
            guards.every((guard) =>
              guard.blocked === null
            )
          ) yield* insert
          const outcomes = yield* disarm
          const blocked = outcomes.find((guard) => guard.blocked !== null)?.blocked ?? null
          if (
            outcomes.some((guard) => guard.unsafe) || (blocked !== null && outcomes.some((guard) => guard.accepted))
          ) {
            return yield* Effect.fail(this.error(
              operation,
              new Reason.BackendFailure({
                kind: "Rejected",
                method: "native insertion",
                hint: "Focus or selection changed; native input may already have changed the page"
              }),
              record.id,
              record.dispatch
            ))
          }
          return blocked === null
            ? "done" as const
            : { retry: { _tag: "PreparingFocus", from: blocked } as Engine.NotReady }
        }),
      () =>
        released ? Effect.void : Effect.gen({ self: this }, function*() {
          // Close the permit while we still own it. Taking it again in the cleanup fiber would queue
          // behind already waiting input, which must not run through the guard we are removing.
          yield* this.owner.page.input.resize(0)
          yield* Effect.gen({ self: this }, function*() {
            const cleanup = yield* Operation.record
            const outcomes = yield* Effect.forEach(documents, (document) =>
              Runtime.releaseInDocument(
                this.owner.runtime,
                document,
                { op: "fillDisarm" },
                cleanup.id
              ).pipe(Effect.exit))
            const failed = outcomes.find(Exit.isFailure)
            if (failed !== undefined) return yield* Effect.failCause(failed.cause)
            yield* this.owner.page.input.resize(1)
          }).pipe(
            Operation.named(`${operation}.guardCleanup`, { attributes: { "browser.page.id": this.owner.page.id } }),
            Operation.detached,
            Effect.catchCause((cause) =>
              Effect.logWarning(
                "Native insertion guard cleanup failed; page input remains blocked. Close this page before sending more input.",
                { pageId: this.owner.page.id, cause }
              )
            ),
            // The interrupted caller returns promptly, including when a dialog holds the browser command.
            Effect.forkIn(this.owner.runtime.model.scope, { startImmediately: true })
          )
        })
    )
  }

  /** Removes the guard an action armed in a document: the element that stopped the gesture, if one did. */
  private disarm(document: Target.DocumentId, id: Diagnostics.OperationId) {
    return Runtime.sendToDocument(this.owner.runtime, this.owner.page, document, { op: "disarm" }, id).pipe(
      Effect.option,
      // A document that went with the gesture took its guard with it: nothing stopped it
      Effect.map((response) =>
        Option.isSome(response) && Option.isSome(response.value) && response.value.value._tag === "Guarded" &&
          response.value.value.blocked !== null
          ? Option.some(response.value.value.blocked)
          : Option.none<string>()
      )
    )
  }

  /**
   * An action point in a frame, in the page's viewport: each iframe's content-box origin
   * added, innermost first, each iframe scrolled into view in its parent when the checks ask for the viewport, and,
   * when they ask for the pointer, the iframe hit at the point in its parent. `NotReady` when one isn't.
   */
  translate(
    routed: Runtime.Routed,
    point: { readonly x: number; readonly y: number },
    checks: { readonly inViewport: boolean; readonly receivesPointer: boolean },
    id: Diagnostics.OperationId
  ): Effect.Effect<
    | {
      readonly _tag: "Point"
      readonly point: { x: number; y: number }
      readonly origin: { x: number; y: number }
    }
    | { readonly _tag: "NotReady"; readonly reason: Engine.NotReady },
    Runtime.SendFailure
  > {
    const runtime = this.owner.runtime
    const page = this.owner.page
    return Effect.gen(function*() {
      let at = { ...point }
      const origin = { x: 0, y: 0 }
      for (const hop of [...routed.hops].reverse()) {
        const answer = yield* Runtime.sendToDocument(runtime, page, hop.document, {
          op: "frame",
          steps: hop.steps,
          scroll: checks.inViewport,
          cap: Runtime.roundCap((yield* Operation.record).left()),
          point: checks.receivesPointer ? at : null
        }, id)
        if (Option.isNone(answer) || answer.value._tag !== "Frame") {
          return { _tag: "NotReady", reason: { _tag: "NoMatch" } } as const
        }
        const frame = answer.value
        // The iframe moved into view: the point inside it is right, but the next round reads it again
        if (frame.scrolled) return { _tag: "NotReady", reason: { _tag: "OutsideViewport" } } as const
        if (frame.covered !== null) return { _tag: "NotReady", reason: { _tag: "Covered", by: frame.covered } } as const
        at = { x: at.x + frame.origin.x, y: at.y + frame.origin.y }
        origin.x += frame.origin.x
        origin.y += frame.origin.y
      }
      return { _tag: "Point", point: at, origin } as const
    })
  }

  /**
   * An action: rounds of checks in the page at each frame until they pass, then the page's
   * input permit, the checks once more with the action's part done in the page, and `perform`, which sends the
   * input once. `perform` may ask for another round, only when a guard proved the page never saw the input. In a
   * frame, each round's point is translated into the page's viewport (`translate`), and input names the frame.
   */
  private act(
    operation: string,
    options: Locator.ActionOptions | undefined,
    defaults: CheckSet,
    action: Engine.Action,
    perform: (
      ready: Extract<Engine.Response, { _tag: "Ready" }>,
      io: {
        /** Sends input to the page, into the frame the element is in. */
        readonly send: (
          events: ReadonlyArray<Adapter.InputEvent>
        ) => Effect.Effect<void, Locator.LocatorError | Target.TargetGone | Deadline.Timeout>
        /** Removes the guard the round armed: what stopped the gesture, if anything did. */
        readonly disarm: Effect.Effect<Option.Option<string>>
        readonly guardFill: (
          insert: Effect.Effect<void, Locator.LocatorError | Target.TargetGone | Deadline.Timeout>
        ) => Effect.Effect<
          "done" | { readonly retry: Engine.NotReady },
          Locator.LocatorError | Target.TargetGone | Deadline.Timeout
        >
      },
      record: Operation.Record
    ) => Effect.Effect<
      "done" | { readonly retry: Engine.NotReady },
      Locator.LocatorError | Target.TargetGone | Deadline.Timeout
    >,
    extra: { readonly redacted?: boolean } = {}
  ) {
    const owner = this.owner
    return Effect.gen({ self: this }, function*() {
      yield* Access.check(owner.grant)
      const record = yield* Operation.record
      const id = record.id
      const budget = record.budget
      const checks = checksFor(defaults, options?.checks)
      const reuseStability = checks.stable > 0 &&
        (operation === "Locator.click" || operation === "Locator.check" || operation === "Locator.uncheck")
      const emulatesFocus = yield* Filters.supported(owner.runtime, "emulation.focus")
      // These actions happen in the round that applies them: once it is sent, the action may have happened, and
      // its answer says whether it did
      const inRound = Engine.appliesInRound(action)
      const round = (cap: number, apply: boolean, stability?: string, final = false) =>
        Effect.suspend(() => {
          return owner.page.execution.action(
            owner.runtime,
            owner.page,
            {
              op: "act",
              steps: this.steps,
              checks,
              cap,
              action,
              apply,
              ...(stability === undefined ? {} : { stability })
            },
            id,
            budget.at,
            final
          )
        }).pipe(
          Effect.tap((answer) =>
            Effect.sync(() => {
              if (apply && inRound) {
                // A native fill's Ready response confirms only preparation; its input is still unsent.
                // Until this response arrives, the applying round may itself have changed the value.
                if (
                  !("_tag" in answer) && answer.response._tag === "Ready" &&
                  (action._tag !== "Fill" || answer.response.fill === "set")
                ) record.markConfirmed()
                else record.markNotSent()
              }
            })
          ),
          Effect.tapError((failure) =>
            Effect.sync(() => {
              if (
                apply && inRound && failure._tag === "Reason" && failure.reason._tag === "BackendFailure" &&
                Protocol.isProtocolError(failure.reason.cause) && failure.reason.cause.reason._tag === "Rejected"
              ) {
                record.markConfirmed("rejected")
              }
            })
          ),
          Effect.mapError((failure) =>
            failure._tag === "Deadline"
              ? failure
              : this.sendFailure(operation, failure, record)
          )
        )
      // The record's phase says where the action stopped; the hint says why, from what it saw
      const hint = (noDocument?: string): Option.Option<string> => {
        // Input that may have reached the page: a timeout after it can't say the action didn't happen
        if (record.dispatch._tag === "MayHaveBeenSent") {
          return Option.some(
            "The input was sent and the browser hadn't confirmed it by the deadline; a dialog it opened may still be deciding"
          )
        }
        const reasons = record.history.map((each) => each.value as Engine.NotReady)
        const last = reasons.at(-1)
        // A page that rendered no frame in some rounds and one in others renders too seldom to tell the element
        // is still: what moved is the page's frame rate, which page.activate mends (QUIRKS.md, Q19 and Q71)
        const starved = last?._tag === "NotStable" && reasons.some((reason) => reason._tag === "NoRenderingOpportunity")
        return Option.map(
          Option.fromNullishOr(starved ? { _tag: "NoRenderingOpportunity" } as const : last),
          (reason) => explain(reason, checks.stable, emulatesFocus)
        ).pipe(Option.orElse(() => Option.fromUndefinedOr(noDocument)))
      }
      const timedOut = (noDocument?: string) => record.timeout(hint(noDocument))
      const notReady = (reason: Engine.NotReady) => {
        record.observe(reason)
        return Option.none<Ready>()
      }
      /** A round's answer: ready, with its point in the page's viewport, or not yet. */
      const settle = (answer: Runtime.Answer | { readonly _tag: "Restart" }) =>
        Effect.gen({ self: this }, function*() {
          if ("_tag" in answer) return Option.none<Ready>()
          const response = answer.response
          switch (response._tag) {
            case "Strict":
              return yield* Effect.fail(this.strict(operation, response, id))
            case "InvalidSelector":
              return yield* Effect.fail(this.invalidSelector(operation, response, id))
            case "Final":
              return yield* Effect.fail(this.final(operation, response.final, id))
            case "NotReady":
              for (const reason of response.history) record.observe(reason)
              // A round cut short before it checked anything adds nothing to what was seen
              return response.checked ? notReady(response.reason) : Option.none<Ready>()
            case "Ready": {
              if (answer.routed.hops.length === 0 || response.point === null) {
                return Option.some<Ready>({ response, routed: answer.routed, origin: { x: 0, y: 0 } })
              }
              const points = checks.receivesPointer && action._tag === "Point" && action.position === null &&
                  response.candidates !== undefined && response.candidates.length > 0
                ? response.candidates
                : [response.point]
              let covered: Engine.NotReady | undefined
              for (const point of points) {
                const translated = yield* this.translate(answer.routed, point, checks, id).pipe(
                  Effect.mapError((failure) =>
                    failure._tag === "Deadline" ? failure : this.sendFailure(operation, failure, record)
                  )
                )
                if (translated._tag === "NotReady") {
                  if (translated.reason._tag !== "Covered") return notReady(translated.reason)
                  covered ??= translated.reason
                  continue
                }
                return Option.some<Ready>({
                  response: { ...response, point: translated.point },
                  routed: answer.routed,
                  origin: translated.origin
                })
              }
              return notReady(covered!)
            }
            default:
              return yield* this.unmatched(operation, response, id)
          }
        })
      // Input reaches the page from here: a dialog it opens may block it, and a dialog nothing will decide fails it
      const send = (ready: Ready) => (events: ReadonlyArray<Adapter.InputEvent>) =>
        Effect.flatMap(
          Input.recover(owner.page.inputState, (release) =>
            owner.runtime.model.adapter.dispatchInput(owner.page.id, release)),
          (unknown) => {
            if (Option.isSome(unknown)) {
              return Effect.fail(this.error(
                operation,
                new Reason.BackendFailure({
                  kind: "Rejected",
                  method: "input",
                  hint: `A held input's release failed (${unknown.value}), and failed again when sent before this ` +
                    "gesture, so the page's input state is unknown"
                }),
                id
              ))
            }
            record.markSent()
            const frame = ready.routed.hops.at(-1)
            return owner.runtime.model.adapter.dispatchInput(
              owner.page.id,
              events,
              frame === undefined ? undefined : { frame: frame.frame, origin: ready.origin }
            ).pipe(
              Effect.tapError((error) =>
                Effect.sync(() => {
                  // A page that is gone took its input with it; otherwise the gesture may have left input pressed
                  if (Deadline.isTimeout(error) || error.reason._tag !== "Gone") {
                    Input.uncertain(owner.page.inputState, `${operation}: ${error.message}`, events)
                  }
                })
              ),
              // Cut short, by a deadline or a dialog, it may still have pressed something
              Effect.onInterrupt(() =>
                Effect.sync(() =>
                  Input.uncertain(owner.page.inputState, `${operation}: interrupted`, events)
                )
              ),
              Effect.mapError((error) => Runtime.fromAdapter(error, id, owner.runtime.backend)),
              Effect.raceFirst(Runtime.promptBlocked(owner.page, true)),
              Effect.mapError((failure) =>
                // The input may have reached the page: the error says so, and nothing is sent again. A backend
                // that can't send input refuses before it sends any (stock WebKit's inspector)
                failure._tag === "Gone"
                  ? failure.error
                  : failure._tag === "Reason"
                  ? this.error(
                    operation,
                    failure.reason,
                    id,
                    failure.reason._tag === "Unsupported" ? { _tag: "NotSent" } : record.dispatch
                  )
                  : timedOut()
              )
            )
          }
        )
      // A round that reached the deadline is the action's own Timeout, with what the record saw
      const attempts = Effect.gen({ self: this }, function*() {
        while (true) {
          const left = record.left()
          if (left <= 0) return yield* Effect.fail(timedOut())
          const first = yield* round(Runtime.roundCap(left), false, reuseStability ? "capture" : undefined).pipe(
            Effect.flatMap(settle)
          )
          if (Option.isNone(first)) continue
          // Input to a page is serialized; acquiring the permit takes from the deadline, and the checks run again
          const underPermit = Effect.fnUntraced(function*(this: LocatorImpl, stability?: string) {
            const apply = options?.trial !== true
            const answer = yield* round(Runtime.roundCap(record.left()), apply, stability, true)
            if ("_tag" in answer) {
              record.markNotSent()
              return "again" as const
            }
            const disarm = this.disarm(answer.routed.document, id)
            const again = yield* settle(answer).pipe(
              // A guard the round armed comes off when the point outside its frame wasn't ready
              Effect.tap((ready) =>
                Option.isNone(ready) && apply && answer.response._tag === "Ready"
                  ? Effect.ignore(disarm)
                  : Effect.void
              )
            )
            if (Option.isNone(again)) return "again" as const
            // A trial stops at the last check, holding the permit as the action would
            if (options?.trial === true) return "done" as const
            const done = yield* perform(again.value.response, {
              send: send(again.value),
              disarm,
              guardFill: (insert) => this.guardFill(operation, again.value.routed, record, insert)
            }, record)
            if (done === "done") return "done" as const
            // The guard stopped the gesture before the page saw it: nothing happened, so check again
            record.markNotSent()
            record.observe(done.retry)
            return "again" as const
          }).bind(this)
          const permitted = Effect.gen(function*() {
            if (reuseStability) {
              const immediate = yield* owner.page.input.withPermitsIfAvailable(1)(
                underPermit(first.value.response.stability)
              )
              if (Option.isSome(immediate)) return immediate.value
            }
            // Queued input always takes new stability samples, even if the page hasn't rendered while waiting.
            return yield* owner.page.input.withPermit(underPermit())
          })
          const outcome = yield* record.bound(permitted, () => hint())
          if (outcome === "done") return
        }
      })
      return yield* attempts.pipe(Effect.catchTag("Deadline", (failure) => Effect.fail(timedOut(failure.hint))))
    }).pipe(
      Effect.raceFirst(Runtime.pageEnded(owner.page)),
      Operation.named(operation, {
        attributes: {
          "browser.locator": this.description,
          "browser.page.id": owner.page.id,
          ...(options?.checks === undefined ? {} : { "browser.action.checks": JSON.stringify(options.checks) }),
          ...(extra.redacted === true ? { "browser.action.redacted": true } : {})
        }
      }),
      // What a recording's DOM snapshots mark as the action's target
      Effect.provideService(
        Recorders.CurrentSubject,
        Option.some({ steps: this.steps, secret: extra.redacted === true })
      )
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
  override toString() {
    return `Locator(${this.description})`
  }
  toJSON() {
    return { _id: "Locator", page: this.owner.page.id, locator: this.description }
  }
}

/** A page's root locator queries. */
export const pageQueries = (owner: Owner): Locator.Queries<Locator.Locator> =>
  queries([], (steps) => new LocatorImpl(owner, steps))

/** Whether `steps` begins with `prefix`. */
const startsWith = (steps: ReadonlyArray<Engine.Step>, prefix: ReadonlyArray<Engine.Step>) =>
  prefix.length <= steps.length && JSON.stringify(steps.slice(0, prefix.length)) === JSON.stringify(prefix)

/**
 * An iframe's document, entered by its element: the iframe's steps and a boundary, which
 * every locator it makes begins with.
 */
export const frameLocator = (owner: Owner, steps: ReadonlyArray<Engine.Step>): Locator.FrameLocator => {
  const inside: ReadonlyArray<Engine.Step> = [...steps, { _tag: "Frame" }]
  const make = (each: ReadonlyArray<Engine.Step>) => new LocatorImpl(owner, each)
  return {
    ...queries(inside, make),
    owner: make(steps),
    frame: (iframe) => {
      if (!(iframe instanceof LocatorImpl) || iframe.owner.page.id !== owner.page.id) {
        throw new Error("FrameLocator.frame: the iframe's locator belongs to another page")
      }
      if (
        !startsWith(iframe.steps, inside) ||
        Runtime.split(iframe.steps).frames.length !== Runtime.split(inside).frames.length
      ) {
        throw new Error(
          "FrameLocator.frame: the iframe's locator isn't in this frame; build it from this frame locator"
        )
      }
      return frameLocator(owner, iframe.steps)
    },
    toString: () => `FrameLocator(page.frame(page.${describeSteps(steps)}))`
  } as Locator.FrameLocator
}

/** `page.frame(iframe)`: the iframe may be any locator of the page's, one in a frame included. */
export const pageFrame = (owner: Owner, iframe: Locator.ReadonlyLocator): Locator.FrameLocator => {
  if (!(iframe instanceof LocatorImpl) || iframe.owner.page.id !== owner.page.id) {
    throw new Error("Page.frame: the iframe's locator belongs to another page")
  }
  return frameLocator(owner, iframe.steps)
}

/** Sent only by dispatchEvent; no constructor lookup or event state is added to engine installation. */
function dispatchDOMEvent(element: Element, data: {
  readonly type: string
  readonly eventClass: string
  readonly init: Readonly<Record<string, unknown>>
}) {
  const { type, eventClass, init } = data
  if (!element.isConnected) return "detached"
  const constructors = {
    Event: globalThis.Event,
    CustomEvent: globalThis.CustomEvent,
    MouseEvent: globalThis.MouseEvent,
    KeyboardEvent: globalThis.KeyboardEvent,
    PointerEvent: globalThis.PointerEvent,
    FocusEvent: globalThis.FocusEvent,
    WheelEvent: globalThis.WheelEvent,
    InputEvent: globalThis.InputEvent,
    DragEvent: globalThis.DragEvent,
    TouchEvent: globalThis.TouchEvent,
    DeviceOrientationEvent: globalThis.DeviceOrientationEvent,
    DeviceMotionEvent: globalThis.DeviceMotionEvent
  }
  const Constructor = Object.prototype.hasOwnProperty.call(constructors, eventClass)
    ? constructors[eventClass as keyof typeof constructors] :
    undefined
  if (typeof Constructor !== "function") return "unsupported"
  let event: Event
  try {
    event = new Constructor(type, { bubbles: true, cancelable: true, composed: true, ...init })
  } catch {
    return "invalid"
  }
  element.dispatchEvent(event)
  return "sent"
}
