/**
 * Locators as data: the engine's steps each query appends, how they read in code, and
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
          ...(step.includeHidden ? ["includeHidden: true"] : []),
          ...(["level", "checked", "pressed", "expanded", "selected", "disabled"] as const).flatMap((key) =>
            step[key] === undefined ? [] : [`${key}: ${step[key]}`]
          )
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
        return `getByTestId(${quote(step.matcher)})`
      case "Css":
        return `locator(${JSON.stringify(step.selector)})`
      case "XPath":
        return `locator(Locator.xpath(${JSON.stringify(step.expression)}))`
      case "Nth":
        return `nth(${step.index})`
      case "First":
        return "first"
      case "Last":
        return "last"
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
  includeHidden: options?.includeHidden ?? false,
  ...Object.fromEntries(
    (["level", "checked", "pressed", "expanded", "selected", "disabled"] as const)
      .filter((key) => options?.[key] !== undefined)
      .map((key) => [key, options![key]])
  )
})

/** `locator`'s step: a string is CSS, and `Locator.xpath` an XPath expression. */
export const selectorStep = (selector: string | Locator.XPath): Engine.Step =>
  typeof selector === "string"
    ? { _tag: "Css", selector }
    : { _tag: "XPath", expression: selector.expression }

/** The queries, as steps appended to `steps`, matching test ids by the attribute `testIdAttribute` reads. */
export const queries = <L>(
  steps: ReadonlyArray<Engine.Step>,
  make: (steps: ReadonlyArray<Engine.Step>) => L,
  testIdAttribute: () => string
): Locator.Queries<L> => ({
  getByRole: (role, options) => make([...steps, roleStep(role, options)]),
  getByText: (text, options) => make([...steps, { _tag: "Text", matcher: matcher(text, options?.exact) }]),
  getByLabel: (text, options) => make([...steps, { _tag: "Label", matcher: matcher(text, options?.exact) }]),
  getByPlaceholder: (text, options) =>
    make([...steps, { _tag: "Placeholder", matcher: matcher(text, options?.exact) }]),
  getByAltText: (text, options) => make([...steps, { _tag: "AltText", matcher: matcher(text, options?.exact) }]),
  getByTitle: (text, options) => make([...steps, { _tag: "Title", matcher: matcher(text, options?.exact) }]),
  getByTestId: (id) => make([...steps, { _tag: "TestId", matcher: matcher(id, true), attribute: testIdAttribute() }]),
  locator: (selector) => make([...steps, selectorStep(selector)])
})

const RelativeTypeId = "~@usestrider/browser/Locator/RelativeLocator"

/** A relative locator: steps applied from a candidate, inside `filter({ has })`. */
export interface Relative extends Locator.RelativeLocator {
  readonly steps: ReadonlyArray<Engine.Step>
}

/**
 * The test-id attribute of a relative locator's steps until it is placed: no context's, since a relative locator
 * has none. The empty string is no attribute's name, so no context's setting can be it.
 */
const unplaced = ""

const makeRelative = (steps: ReadonlyArray<Engine.Step>): Relative =>
  ({
    [RelativeTypeId]: RelativeTypeId,
    steps,
    ...queries(steps, makeRelative, () => unplaced)
  }) as unknown as Relative

/** `Locator.relative`: the queries, starting from nothing. */
export const relative: Locator.Queries<Locator.RelativeLocator> = queries([], makeRelative, () => unplaced)

/** A relative locator's steps placed in a locator whose context matches test ids by `testIdAttribute`. */
export const place = (relative: Relative, testIdAttribute: string): ReadonlyArray<Engine.Step> =>
  relative.steps.map((step) =>
    step._tag === "TestId" && step.attribute === unplaced ? { ...step, attribute: testIdAttribute } : step
  )
