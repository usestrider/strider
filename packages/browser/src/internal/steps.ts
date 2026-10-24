/**
 * Locators as data (review 12, candidate 3): the engine's steps each query appends, how they read in code, and
 * the relative locators `filter({ has })` takes. It imports only types, so `Locator` can use it too.
 */
import type * as AriaRole from "../AriaRole.ts"
import type * as Locator from "../Locator.ts"
import type * as Engine from "./engine.ts"

// ── Describing ────────────────────────────────────────────────────────────────────────────────────────────

export const matcher = (text: string | RegExp, exact: boolean | undefined): Engine.TextMatcher =>
  typeof text === "string"
    ? { _tag: "String", value: text, exact: exact ?? false }
    : { _tag: "RegExp", source: text.source, flags: text.flags.replace("g", "") }

const quote = (matcher: Engine.TextMatcher) =>
  matcher._tag === "String" ? JSON.stringify(matcher.value) : `/${matcher.source}/${matcher.flags}`

const exactly = (matcher: Engine.TextMatcher) => matcher._tag === "String" && matcher.exact ? ", { exact: true }" : ""

/**
 * How steps read in code, for errors and traces, after `page.`: a frame boundary reads as the `page.frame(…)` that
 * made it.
 */
export const describeSteps = (steps: ReadonlyArray<Engine.Step>): string => {
  const boundary = steps.findLastIndex((step) => step._tag === "Frame")
  if (boundary < 0) return describePlain(steps)
  const rest = describePlain(steps.slice(boundary + 1))
  return `frame(page.${describeSteps(steps.slice(0, boundary))})${rest === "" ? "" : `.${rest}`}`
}

const describePlain = (steps: ReadonlyArray<Engine.Step>): string =>
  steps.map((step) => {
    switch (step._tag) {
      case "Role": {
        const options = [
          ...(step.name === null ? [] : [`name: ${quote(step.name)}`]),
          ...(step.name !== null && step.name._tag === "String" && step.name.exact ? ["exact: true"] : []),
          ...(step.includeHidden ? ["includeHidden: true"] : [])
        ]
        return `getByRole(${JSON.stringify(step.role)}${options.length === 0 ? "" : `, { ${options.join(", ")} }`})`
      }
      case "Text":
        return `getByText(${quote(step.matcher)}${exactly(step.matcher)})`
      case "Label":
        return `getByLabel(${quote(step.matcher)}${exactly(step.matcher)})`
      case "Placeholder":
        return `getByPlaceholder(${quote(step.matcher)}${exactly(step.matcher)})`
      case "AltText":
        return `getByAltText(${quote(step.matcher)}${exactly(step.matcher)})`
      case "Title":
        return `getByTitle(${quote(step.matcher)}${exactly(step.matcher)})`
      case "TestId":
        return `getByTestId(${JSON.stringify(step.id)})`
      case "Css":
        return `locator(${JSON.stringify(step.selector)})`
      case "Nth":
        return step.index === 0 ? "first" : step.index === -1 ? "last" : `nth(${step.index})`
      case "Filter": {
        const parts = [
          ...(step.hasText === null ? [] : [`hasText: ${quote(step.hasText)}`]),
          ...(step.hasNotText === null ? [] : [`hasNotText: ${quote(step.hasNotText)}`]),
          ...(step.has === null ? [] : [`has: ${describeSteps(step.has)}`]),
          ...(step.hasNot === null ? [] : [`hasNot: ${describeSteps(step.hasNot)}`]),
          ...(step.visible === null ? [] : [`visible: ${step.visible}`])
        ]
        return `filter({ ${parts.join(", ")} })`
      }
      case "And":
        return `and(page.${describeSteps(step.other)})`
      case "Or":
        return `or(page.${describeSteps(step.other)})`
      case "Frame":
        return "frame()"
      case "Ref":
        return `ref(${JSON.stringify(step.ref)})`
    }
  }).join(".")

// ── Queries ───────────────────────────────────────────────────────────────────────────────────────────────

export const roleStep = (role: AriaRole.AriaRole, options: Locator.RoleOptions | undefined): Engine.Step => ({
  _tag: "Role",
  role,
  name: options?.name === undefined ? null : matcher(options.name, options.exact),
  includeHidden: options?.includeHidden ?? false
})

/** The queries, as steps appended to `steps`. */
export const queries = <L>(
  steps: ReadonlyArray<Engine.Step>,
  make: (steps: ReadonlyArray<Engine.Step>) => L
): Locator.Queries<L> => ({
  getByRole: (role, options) => make([...steps, roleStep(role, options)]),
  getByText: (text, options) => make([...steps, { _tag: "Text", matcher: matcher(text, options?.exact) }]),
  getByLabel: (text, options) => make([...steps, { _tag: "Label", matcher: matcher(text, options?.exact) }]),
  getByPlaceholder: (text, options) =>
    make([...steps, { _tag: "Placeholder", matcher: matcher(text, options?.exact) }]),
  getByAltText: (text, options) => make([...steps, { _tag: "AltText", matcher: matcher(text, options?.exact) }]),
  getByTitle: (text, options) => make([...steps, { _tag: "Title", matcher: matcher(text, options?.exact) }]),
  getByTestId: (id) => make([...steps, { _tag: "TestId", id }]),
  locator: (css) => make([...steps, { _tag: "Css", selector: css }])
})

const RelativeTypeId = "~@usestrider/browser/Locator/RelativeLocator"

/** A relative locator: steps applied from a candidate, inside `filter({ has })`. */
export interface Relative extends Locator.RelativeLocator {
  readonly steps: ReadonlyArray<Engine.Step>
}

const makeRelative = (steps: ReadonlyArray<Engine.Step>): Relative =>
  ({
    [RelativeTypeId]: RelativeTypeId,
    steps,
    ...queries(steps, makeRelative)
  }) as unknown as Relative

/** `Locator.relative`: the queries, starting from nothing. */
export const relative: Locator.Queries<Locator.RelativeLocator> = queries([], makeRelative)
