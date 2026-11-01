import * as NodeServices from "@effect/platform-node/NodeServices"
import { Browser, Condition, Deadline, Expect, type Locator, type Page } from "@usestrider/browser"
import { Chromium } from "@usestrider/browser/chromium"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import type * as Scope from "effect/Scope"
import { createHash } from "node:crypto"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { chromium, type Page as PlaywrightPage } from "playwright-core"
import { expect } from "vitest"
import browsers from "../../../browser/test/integration/browsers.json" with { type: "json" }
import sources from "../../upstream/sources.json" with { type: "json" }
import { startTiming } from "./timing.ts"

const executablePath = process.env["STRIDER_CHROMIUM"]
if (process.env["STRIDER_ENVIRONMENT"] !== "nix-integration" || executablePath === undefined) {
  throw new Error("Run these browser tests with `pnpm test:upstream`, in the pinned Nix environment.")
}

const layer = Chromium.layer({ executablePath }).pipe(Layer.provideMerge(NodeServices.layer))

export const withStrider = (run: (page: Page.Page) => Effect.Effect<void, unknown, Scope.Scope>) =>
  Effect.runPromise(
    Effect.scoped(Effect.gen(function*() {
      expect((yield* Browser.Browser).info.version).toBe(browsers.chromium.version)
      const page = yield* Browser.newPage({ emulation: { viewport: { width: 1280, height: 720 } } })
      const finish = startTiming()
      yield* run(page).pipe(Effect.ensuring(Effect.sync(finish)))
    })).pipe(Deadline.within("30 seconds"), Effect.provide(layer))
  )

export const withPlaywright = async (run: (page: PlaywrightPage) => Promise<void>) => {
  const browser = await chromium.launch({ executablePath })
  try {
    expect(browser.version()).toBe(browsers.chromium.version)
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
    page.setDefaultTimeout(30000)
    const finish = startTiming()
    try {
      await run(page)
    } finally {
      finish()
    }
  } finally {
    await browser.close()
  }
}

export const verifyFixture = (name: "vite" | "astro" | "playwright") => {
  const source = sources.find((source) => source.name === name)!
  const upstream = path.resolve(import.meta.dirname, "../../upstream", name)
  for (const file of source.files) {
    const content = fs.readFileSync(path.join(upstream, file.file))
    expect(createHash("sha256").update(content).digest("hex"), file.source).toBe(file.sha256)
  }
  return path.join(upstream, "fixture")
}

/** Each test gets pristine upstream files; HMR edits never touch the vendored originals. */
export const withFixture = async (name: "vite" | "astro" | "playwright", run: (root: string) => Promise<void>) => {
  const fixture = verifyFixture(name)
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), `strider-upstream-${name}-`))
  try {
    fs.cpSync(fixture, temporary, { recursive: true })
    // Use this package's locked dependencies instead of installing the upstream monorepo.
    fs.symlinkSync(path.resolve(import.meta.dirname, "../../node_modules"), path.join(temporary, "node_modules"))
    if (name === "astro") {
      const modules = path.join(temporary, "astro-component/node_modules/@e2e")
      fs.mkdirSync(modules, { recursive: true })
      fs.symlinkSync(path.join(temporary, "_deps/astro-linked-lib"), path.join(modules, "astro-linked-lib"))
    }
    await run(temporary)
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true })
  }
}

export const edit = (root: string, file: string, from: string, to: string) => {
  const target = path.join(root, file)
  const content = fs.readFileSync(target, "utf8")
  expect(content, `edit target in ${file}`).toContain(from)
  fs.writeFileSync(target, content.replace(from, to))
}

/** Strider has no CSS matcher; its public condition API retries the computed-style read. */
export const css = (locator: Locator.ReadonlyLocator, property: string, value: string) =>
  Expect.that(
    locator.evaluate((element, property) => getComputedStyle(element).getPropertyValue(property), property),
    Condition.make(`${property}: ${value}`, (actual) => actual === value)
  )
