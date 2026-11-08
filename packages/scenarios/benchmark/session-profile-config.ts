// Checked transforms for the three canonical session workloads.
export const transformScenarios = (source: string): string => {
  const start = source.indexOf("// #region many-pages/strider")
  const end = source.indexOf("export const scenarios:", start)
  if (start < 0 || end < 0) throw new Error("Scenario region anchors changed")
  let region = source.slice(start, end)
  region = region.replace(
    /yield\* (page\.(?:getByRole\([^\n]+\)\.(?:fill|click)\([^\n]*\)|goto\([^\n]*\)))/g,
    (_, call) =>
      `yield* sessionProfile.effect(${
        JSON.stringify(
          call.includes(".fill(") ? "strider.fill" : call.includes(".click(") ? "strider.click" : "strider.goto"
        )
      }, ${call})`
  )
  region = region.replace(
    /await (page\.(?:getByRole\([^\n]+\)\.(?:fill|click)\([^\n]*\)|goto\([^\n]*\)|close\(\)))/g,
    (_, call) =>
      `await sessionProfile.promise(${
        JSON.stringify(
          call.includes(".fill(")
            ? "playwright.fill"
            : call.includes(".click(")
            ? "playwright.click"
            : call.includes(".goto(")
            ? "playwright.goto"
            : "playwright.close"
        )
      }, () => ${call})`
  )
  region = region.replace(
    /return (`[\s\S]*?`)\n/g,
    (_, value) => `sessionProfile.event("verification.start", {})\n  return sessionProfile.value(${value})\n`
  )
  region = region.replaceAll(
    "  const values = []",
    "  sessionProfile.event(\"verification.start\", {})\n  const values = []"
  )
  region = region.replaceAll("return values.join(\",\")", "return sessionProfile.value(values.join(\",\"))")
  for (
    const [name, expected] of Object.entries({
      "strider.fill": 2,
      "strider.click": 3,
      "strider.goto": 3,
      "playwright.fill": 2,
      "playwright.click": 3,
      "playwright.goto": 3,
      "playwright.close": 2
    })
  ) {
    if (region.split(JSON.stringify(name)).length !== expected + 1) {
      throw new Error(`Scenario instrumentation count changed: ${name}`)
    }
  }
  return source.slice(0, start) + region + source.slice(end)
}
