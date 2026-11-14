/**
 * Playwright's `tests/library/role-utils.spec.ts`: the accessible name and role Strider computes for elements, checked
 * against the WPT accname pages, the axe-core cases, and the hand-written cases of the original.
 *
 * What the port changes:
 * - `getNameAndRole(page, selector)` ran Playwright's injected `getElementAccessibleNameText` and `getAriaRole` in
 *   the page. Strider's snapshot node carries both: its role, and its accessible name (`""` when the node has none).
 *   `nameAndRole` reads that node, so the port asserts the name Strider computes, not a value read from the DOM. A
 *   node Strider names `generic` is an element without a role, which Playwright's `getAriaRole` returns `null` for.
 * - `page.$eval(…)` with the injected script runs in the page's main world: `page.evaluateInMainWorld`. Strider's own
 *   reads of attributes (`readAttribute`) and counts (`count`, `nth`) stand in for the original's loops over elements.
 * - `expect.soft` doesn't stop at a failed check, so each soft check is collected and the test fails at the end with
 *   every mismatch, as the original reports them (`softly`). A plain `expect` throws at once, as in the original.
 * - The snapshot node is the one read of role and name that stays quick when they differ, and its name is computed as
 *   `getByRole`'s `name` is (the engine's `accessibleName`, hidden content excluded). Its role is `roleOf`'s, except that
 *   an element with no role, or `presentation` or `none`, is not a node of its own and reads as `generic`; the cases
 *   that expect `presentation` read the role with `Expect.toHaveRole` instead.
 * - `expect(page.getByRole(…)).toHaveCount(1)` and `toBeVisible` are `Expect.toHaveCount` and `Expect.toBeVisible`.
 * - `locator.ariaSnapshot()` is the YAML of the accessibility tree; the port asserts the node's role and name and that
 *   it has no children, which is what the YAML line `- textbox "…"` says (AR-159).
 * - The original's `addInitScript` functions (the `ATTAcomm` and `AriaUtils` stubs of the WPT pages) are page scripts
 *   too, and they're installed the same way.
 * - AR-143 and AR-144 expect each file's accessible description as well as its name. Strider has no accessible
 *   description read (the matrix row `method-locator-description`), so the description checks are left out and the
 *   name checks are kept. Each place says so. AR-143's `ATTAcomm` steps for descriptions are skipped by `property`.
 * - AR-143 loops over four ranges of the manual pages; each is registered as a `variant` of the test.
 * - AR-144 requests the shadow DOM pages as `/wpt/accname/name/shadowdom` followed by the file name, with no slash,
 *   as the original does. Those URLs 404 in the original, so `window.__selector` is never set and no element is
 *   checked. The port requests the same URLs, so it checks nothing there either. The 404 is recorded in the server's
 *   `missing` list.
 * - The axe-core cases are CommonJS modules; they're evaluated from the vendored files, which the server checks against
 *   their SHA-256, since this package is an ES module.
 * - `test.info().annotations` (the issue links on AR-152, AR-153, AR-157, AR-159, AR-160, AR-161, AR-162, AR-163) are
 *   report metadata, not checks, so they aren't ported.
 */
import { assert } from "@effect/vitest"
import { Expect, type Locator, type Page } from "@usestrider/browser"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Result from "effect/Result"
import * as fs from "node:fs"
import { isDeepStrictEqual } from "node:util"
import { assetPath } from "../../harness/playwright.ts"
import { upstream } from "../../harness/upstream.ts"

/**
 * Playwright's `getNameAndRole`: an element's role and accessible name, from its node in the accessibility snapshot.
 * The role is `null` when the element has none (Strider names that `generic`), and the name is `""` when it has none.
 */
const nameAndRole = Effect.fnUntraced(function*(locator: Locator.ReadonlyLocator) {
  const { root } = yield* locator.snapshot({ sources: "aria" })
  return {
    role: root.role.role === "generic" ? null : root.role.role,
    name: root.name._tag === "None" ? "" : root.name.value
  }
})

const roleAndName = (page: Page.Page, selector: string) => nameAndRole(page.locator(selector))

/**
 * Playwright's `expect.soft`: a mismatch doesn't stop the test. The checks run in order, and `done` fails the test with
 * every mismatch, which is how the original reports them.
 */
const softly = () => {
  const mismatches: Array<string> = []
  return {
    equal: (what: string, actual: unknown, expected: unknown) => {
      if (!isDeepStrictEqual(actual, expected)) {
        mismatches.push(`${what}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`)
      }
    },
    expectation: Effect.fnUntraced(function*(what: string, check: Effect.Effect<void, unknown>) {
      const result = yield* Effect.result(check)
      if (Result.isFailure(result)) mismatches.push(`${what}: ${String(result.failure)}`)
    }),
    // Fails with every mismatch listed, so a run says what differs; it passes only when there are none.
    done: () => {
      if (mismatches.length > 0) {
        assert.fail(`${mismatches.length} mismatches:\n${mismatches.join("\n")}`)
      }
    }
  }
}

/** The shape of one axe-core case in `axe-core/<name>.js`, a CommonJS module of the vendored assets. */
interface AxeCase {
  readonly html: string
  readonly target: string | ReadonlyArray<string>
  readonly role?: string | null
  readonly accessibleText?: string | ReadonlyArray<string>
}

/**
 * The cases of a vendored axe-core module. They're evaluated as CommonJS in this realm, from the file the SHA-256 check
 * covers, where the original `require`s them.
 */
const axeCases = (name: string): ReadonlyArray<AxeCase> => {
  const source = fs.readFileSync(assetPath("playwright", `axe-core/${name}.js`), "utf8")
  const module = { exports: [] as ReadonlyArray<AxeCase> }
  new Function("module", source)(module)
  return module.exports
}

const toArray = <A>(x: A | ReadonlyArray<A>): ReadonlyArray<A> => Array.isArray(x) ? x : [x as A]

/** The WPT manual pages the original skips, for the reasons its comments give. */
const skippedManual = [
  "name_test_case_659-manual.html",
  "name_test_case_660-manual.html",
  "name_test_case_751-manual.html",
  "name_file-title-manual.html",
  "description_1.0_combobox-focusable-manual.html"
]

/** The ranges the original splits the manual pages into, one test each. */
const manualRanges = [
  "name_1.0_combobox-focusable-alternative-manual.html",
  "name_test_case_539-manual.html",
  "name_test_case_721-manual.html"
]

/** The steps a WPT manual page records through `ATTAcomm`: each checked property of an element, with its expected value. */
interface AccnameStep {
  readonly selector: string
  readonly property: "name" | "description"
  readonly value: string
}

/**
 * The `ATTAcomm` and `AriaUtils` stubs of the WPT pages: the original's `addInitScript`, which records each page's
 * expectations on `window` for the port to read. Its `ATTAcomm` keeps the `name` and `description` steps.
 */
const attaCommStub = () => {
  const self = window as unknown as Record<string, unknown>
  self.setup = () => {}
  self.ATTAcomm = class {
    constructor(data: { steps: Array<{ element: string; test: { ATK?: Array<Array<unknown>> } }> }) {
      self.steps = []
      for (const step of data.steps) {
        if (!step.test.ATK) continue
        for (const atk of step.test.ATK) {
          if (
            atk[0] !== "property" || (atk[1] !== "name" && atk[1] !== "description") || atk[2] !== "is" ||
            typeof atk[3] !== "string"
          ) continue
          ;(self.steps as Array<unknown>).push({ selector: "#" + step.element, property: atk[1], value: atk[3] })
        }
      }
    }
  }
}

const accnameStub = () => {
  const self = window as unknown as Record<string, unknown>
  self.AriaUtils = {}
  const utils = self.AriaUtils as Record<string, unknown>
  utils.verifyLabelsBySelector = (selector: string) => {
    self.__selector = selector
  }
}

/** Playwright's `tests/library/role-utils.spec.ts`, its `AR-` cases in order. */
upstream(import.meta.filename, {}, (test) => {
  for (let range = 0; range <= manualRanges.length; range++) {
    test("AR-143", { variant: `range ${range}` }, ({ page, server }) =>
      Effect.gen(function*() {
        yield* page.addInitScript(attaCommStub)
        const testFiles = fs.readdirSync(assetPath("playwright", "wpt/accname/manual"), { withFileTypes: true })
          .filter((entry) => entry.isFile() && entry.name.endsWith(".html"))
          .map((entry) => entry.name)
        const check = softly()
        for (const testFile of testFiles) {
          if (skippedManual.includes(testFile)) continue
          const included = (range === 0 || testFile >= manualRanges[range - 1]!) &&
            (range === manualRanges.length || testFile < manualRanges[range]!)
          if (!included) continue
          yield* page.goto(server.PREFIX + `/wpt/accname/manual/` + testFile)
          const steps = yield* page.evaluateInMainWorld(
            () => (window as unknown as { steps: Array<AccnameStep> }).steps
          )
          for (const step of steps) {
            // Descriptions aren't read: Strider has no accessible description (matrix row `method-locator-description`)
            if (step.property !== "name") continue
            const received = (yield* nameAndRole(page.locator(step.selector))).name
            check.equal(`checking "${step.selector}" in ${testFile}`, received, step.value)
          }
        }
        check.done()
      }))
  }

  test("AR-144", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.addInitScript(accnameStub)
      // The original's failing titles: the names Strider isn't expected to match yet, which are computed but not checked
      const failing = [
        // Chromium thinks it should use "3" from the span, but Safari does not. Spec is unclear.
        "checkbox label with embedded combobox (span)",
        "checkbox label with embedded combobox (div)",

        // We do not allow nested visible elements inside parent invisible. Chromium does, but Safari does not. Spec is unclear.
        "heading with name from content, containing element that is visibility:hidden with nested content that is visibility:visible",

        // TODO: dd/dt elements have roles that prohibit naming. However, both Chromium and Safari still support naming.
        "label valid on dd element",
        "label valid on dt element",

        // TODO: recursive bugs
        "heading with link referencing image using aria-labelledby, that in turn references text element via aria-labelledby",
        "heading with link referencing image using aria-labelledby, that in turn references itself and another element via aria-labelledby",
        "button's hidden referenced name (visibility:hidden) with hidden aria-labelledby traversal falls back to aria-label",

        // TODO: preserve "tab" character and non-breaking-spaces from "aria-label" attribute
        "link with text node, with tab char",
        "nav with trailing nbsp char aria-label is valid (nbsp is preserved in name)",
        "button with leading nbsp char in aria-label is valid (and uses aria-label)"
      ]

      const testFiles = fs.readdirSync(assetPath("playwright", "wpt/accname/name"), { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith(".html"))
        .map((entry) => `/wpt/accname/name/` + entry.name)
      // The original's shadow DOM path has no slash before the file name, so it requests `shadowdombasic.html` and so on
      testFiles.push(
        ...fs.readdirSync(assetPath("playwright", "wpt/accname/name/shadowdom"), { withFileTypes: true })
          .filter((entry) => entry.isFile() && entry.name.endsWith(".html"))
          .map((entry) => `/wpt/accname/name/shadowdom` + entry.name)
      )
      const check = softly()
      for (const testFile of testFiles) {
        yield* page.goto(server.PREFIX + testFile)
        // `querySelectorAll(undefined)` matches the tag `undefined`, which is what the port's selector is when none was set
        const selector = String(
          yield* page.evaluateInMainWorld(() => (window as unknown as { __selector?: string }).__selector)
        )
        const elements = page.locator(selector)
        const count = yield* elements.count
        for (let index = 0; index < count; index++) {
          const element = elements.nth(index)
          const title = Option.getOrNull(yield* element.readAttribute("data-testname"))
          const expected = Option.getOrNull(yield* element.readAttribute("data-expectedlabel"))
          if (title !== null && failing.includes(title)) continue
          const received = (yield* nameAndRole(element)).name
          check.equal(`${testFile}: ${title}`, received, expected)
        }
      }
      check.done()
    }))

  test("AR-145", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE)
      const check = softly()
      for (const testCase of axeCases("implicit-role")) {
        yield* page.setContent(`
        <body>
          ${testCase.html}
        </body>
      `)
        const target = String(testCase.target)
        if (testCase.role === "presentation") {
          // The snapshot leaves out presentational elements (they read as `generic`), so the role is read by the matcher
          yield* check.expectation(
            `checking ${JSON.stringify(testCase)}`,
            Expect.toHaveRole(page.locator(target).first, "presentation")
          )
          continue
        }
        const received = (yield* nameAndRole(page.locator(target).first)).role
        check.equal(`checking ${JSON.stringify(testCase)}`, received, testCase.role)
      }
      check.done()
    }))

  test("AR-146", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE)
      const check = softly()
      for (const testCase of axeCases("accessible-text")) {
        yield* page.setContent(`
        <body>
          ${testCase.html}
        </body>
        <script>
          for (const template of document.querySelectorAll("template[shadow]")) {
            const shadowRoot = template.parentElement.attachShadow({ mode: 'open' });
            shadowRoot.appendChild(template.content);
            template.remove();
          }
        </script>
      `)
        // The original's first element matching each target, read through the injected selector engine
        const targets = toArray(testCase.target)
        const expected = toArray(testCase.accessibleText)
        const received: Array<string> = []
        for (const target of targets) {
          received.push((yield* nameAndRole(page.locator(target).first)).name)
        }
        check.equal(`checking ${JSON.stringify(testCase)}`, received, expected)
      }
      check.done()
    }))

  test("AR-147", ({ page }) =>
    Effect.gen(function*() {
      const check = softly()
      // Text "foo" is assigned to the slot, should not be used twice.
      yield* page.setContent(`
    <button><div>foo</div></button>
    <script>
      (() => {
        const container = document.querySelector('div');
        const shadow = container.attachShadow({ mode: 'open' });
        const slot = document.createElement('slot');
        shadow.appendChild(slot);
      })();
    </script>
  `)
      check.equal("button with an assigned slot", yield* roleAndName(page, "button"), { role: "button", name: "foo" })

      // Text "foo" is assigned to the slot, should be used instead of slot content.
      yield* page.setContent(`
    <div>foo</div>
    <script>
      (() => {
        const container = document.querySelector('div');
        const shadow = container.attachShadow({ mode: 'open' });
        const button = document.createElement('button');
        shadow.appendChild(button);
        const slot = document.createElement('slot');
        button.appendChild(slot);
        const span = document.createElement('span');
        span.textContent = 'pre';
        slot.appendChild(span);
      })();
    </script>
  `)
      check.equal("button with slot content and an assigned node", yield* roleAndName(page, "button"), {
        role: "button",
        name: "foo"
      })

      // Nothing is assigned to the slot, should use slot content.
      yield* page.setContent(`
    <div></div>
    <script>
      (() => {
        const container = document.querySelector('div');
        const shadow = container.attachShadow({ mode: 'open' });
        const button = document.createElement('button');
        shadow.appendChild(button);
        const slot = document.createElement('slot');
        button.appendChild(slot);
        const span = document.createElement('span');
        span.textContent = 'pre';
        slot.appendChild(span);
      })();
    </script>
  `)
      check.equal("button with slot content and nothing assigned", yield* roleAndName(page, "button"), {
        role: "button",
        name: "pre"
      })

      // Text "foo" is not assigned to any slot, should not be used.
      yield* page.setContent(`
    <div role=button>foo</div>
    <script>
      (() => {
        const container = document.querySelector('div');
        const shadow = container.attachShadow({ mode: 'open' });
        shadow.appendChild(document.createTextNode('bar'));
      })();
    </script>
  `)
      check.equal("button with an unassigned light DOM text", yield* roleAndName(page, "div"), {
        role: "button",
        name: "bar"
      })
      check.done()
    }))

  test("AR-148", ({ page }) =>
    Effect.gen(function*() {
      const check = softly()
      yield* page.setContent(`
    <button aria-labelledby="details"></button>
    <details id="details">
      <summary>Summary</summary>
      Details
    </details>
  `)
      check.equal("closed details", yield* roleAndName(page, "button"), { role: "button", name: "Summary" })
      yield* page.evaluateInMainWorld(() => {
        document.querySelector("details")!.open = true
      })
      check.equal("open details", yield* roleAndName(page, "button"), { role: "button", name: "Summary Details" })
      check.done()
    }))

  test("AR-149", ({ page }) =>
    Effect.gen(function*() {
      const check = softly()
      yield* page.setContent(`
    <div role=treeitem id=target>
      <span>Top-level</span>
      <div role=group>
        <div role=treeitem><span>Nested 1</span></div>
        <div role=treeitem><span>Nested 2</span></div>
      </div>
    </div>
  `)
      check.equal("nested treeitem", yield* roleAndName(page, "#target"), { role: "treeitem", name: "Top-level" })
      check.done()
    }))

  test("AR-150", ({ page }) =>
    Effect.gen(function*() {
      const check = softly()
      yield* page.setContent(`
    <div>
      <svg width="162" height="30" viewBox="0 0 162 30" fill="none" xmlns="http://www.w3.org/2000/svg">
        <title>Submit</title>
        <g>
          <title>Hello</title>
        </g>
        <a href="example.com" xlink:title="a link"><circle cx="50" cy="40" r="35" /></a>
      </svg>
    </div>
  `)
      check.equal("svg", yield* roleAndName(page, "svg"), { role: "img", name: "Submit" })
      check.equal("g", yield* roleAndName(page, "g"), { role: null, name: "Hello" })
      check.equal("a", yield* roleAndName(page, "a"), { role: "link", name: "a link" })
      check.done()
    }))

  test("AR-151", ({ page }) =>
    Effect.gen(function*() {
      const check = softly()
      yield* page.setContent(`
    <label for="text1">TEXT1</label><input id="text1" type=text>
    <input id="text2" type=text title="TEXT2">
    <input id="text3" type=text placeholder="TEXT3">
    <input id="number1" type=number placeholder="NUMBER1">

    <label for="image1">IMAGE1</label><input id="image1" type=image>
    <input id="image2" type=image alt="IMAGE2">
    <label for="image3">IMAGE3</label><input id="image3" type=image alt="MORE3">

    <label for="button1">BUTTON1</label><button id="button1" role="combobox">button</button>
    <button id="button2" role="combobox">BUTTON2</button>
    <button id="button3">BUTTON3</button>
    <button id="button4" title="BUTTON4"></button>

    <input id="file1" type=file>
    <label for="file2">FILE2</label><input id="file2" type=file>
  `)

      check.equal("#text1", yield* roleAndName(page, "#text1"), { role: "textbox", name: "TEXT1" })
      check.equal("#text2", yield* roleAndName(page, "#text2"), { role: "textbox", name: "TEXT2" })
      check.equal("#text3", yield* roleAndName(page, "#text3"), { role: "textbox", name: "TEXT3" })
      check.equal("#number1", yield* roleAndName(page, "#number1"), { role: "spinbutton", name: "NUMBER1" })
      check.equal("#image1", yield* roleAndName(page, "#image1"), { role: "button", name: "IMAGE1" })
      check.equal("#image2", yield* roleAndName(page, "#image2"), { role: "button", name: "IMAGE2" })
      check.equal("#image3", yield* roleAndName(page, "#image3"), { role: "button", name: "IMAGE3" })
      check.equal("#button1", yield* roleAndName(page, "#button1"), { role: "combobox", name: "BUTTON1" })
      check.equal("#button2", yield* roleAndName(page, "#button2"), { role: "combobox", name: "" })
      check.equal("#button3", yield* roleAndName(page, "#button3"), { role: "button", name: "BUTTON3" })
      check.equal("#button4", yield* roleAndName(page, "#button4"), { role: "button", name: "BUTTON4" })
      check.equal("#file1", yield* roleAndName(page, "#file1"), { role: "button", name: "Choose File" })
      check.equal("#file2", yield* roleAndName(page, "#file2"), { role: "button", name: "FILE2" })
      check.done()
    }))

  test("AR-152", ({ page }) =>
    Effect.gen(function*() {
      const check = softly()
      yield* page.setContent(`
    <input id="search1" type=search>
    <input id="search2" type=search list=nope>
    <input id="search3" type=search list=dv><div id=dv></div>
    <input id="search4" type=search list=dl><datalist id=dl></datalist>
  `)
      check.equal("#search1", yield* roleAndName(page, "#search1"), { role: "searchbox", name: "" })
      check.equal("#search2", yield* roleAndName(page, "#search2"), { role: "searchbox", name: "" })
      check.equal("#search3", yield* roleAndName(page, "#search3"), { role: "searchbox", name: "" })
      check.equal("#search4", yield* roleAndName(page, "#search4"), { role: "combobox", name: "" })
      check.done()
    }))

  test("AR-153", ({ page }) =>
    Effect.gen(function*() {
      const check = softly()
      yield* page.setContent(`
    <label for="meter1">Battery</label><meter id="meter1" value=0.5></meter>
    <label for="progress1">Loading</label><progress id="progress1" value=0.3></progress>
    <label>Charge <meter id="meter2" value=0.5></meter></label>
    <label for="meter3">Ignored</label><meter id="meter3" aria-label="Overridden" value=0.5></meter>
  `)
      check.equal("#meter1", yield* roleAndName(page, "#meter1"), { role: "meter", name: "Battery" })
      check.equal("#progress1", yield* roleAndName(page, "#progress1"), { role: "progressbar", name: "Loading" })
      check.equal("#meter2", yield* roleAndName(page, "#meter2"), { role: "meter", name: "Charge" })
      check.equal("#meter3", yield* roleAndName(page, "#meter3"), { role: "meter", name: "Overridden" })
      check.done()
    }))

  test("AR-154", ({ page }) =>
    Effect.gen(function*() {
      const check = softly()
      yield* page.setContent(`
    <label id="for-text1">TEXT1</label><input aria-labelledby="for-text1" id="text1" type=text>
    <label id="for-text2">TEXT2</label><input aria-labelledby="for-text2 text2" id="text2" type=text>
    <label id="for-text3" for="text3">TEXT3</label><input aria-labelledby="for-text3 text3" id="text3" type=text>

    <label id="for-submit1" for="submit1">SUBMIT1</label><input aria-labelledby="for-submit1 submit1" id="submit1" type=submit>
    <label id="for-image1" for="image1">IMAGE1</label><input aria-labelledby="for-image1 image1" id="image1" type=image alt="MORE1">
    <label id="for-image2" for="image2">IMAGE2</label><img aria-labelledby="for-image2 image2" id="image2" alt="MORE2" src="data:image/svg,<g></g>">

    <label id="for-button1">BUTTON1</label><button aria-labelledby="for-button1" id="button1">MORE1</button>
    <label id="for-button2">BUTTON2</label><button aria-labelledby="for-button2 button2" id="button2">MORE2</button>
    <label id="for-button3" for="button3">BUTTON3</label><button aria-labelledby="for-button3 button3" id="button3">MORE3</button>
    <label id="for-button4" for="button4">BUTTON4</label><button aria-labelledby="for-button4" id="button4">MORE4</button>
    <label id="for button5">BUTTON5</label><button aria-labelledby="for button5\n\tbutton5" id="button5">MORE5</button>

    <label id="for-textarea1" for="textarea1">TEXTAREA1</label><textarea aria-labelledby="for-textarea1 textarea1" id="textarea1" placeholder="MORE1">MORE2</textarea>
  `)

      check.equal("#text1", yield* roleAndName(page, "#text1"), { role: "textbox", name: "TEXT1" })
      check.equal("#text2", yield* roleAndName(page, "#text2"), { role: "textbox", name: "TEXT2" })
      check.equal("#text3", yield* roleAndName(page, "#text3"), { role: "textbox", name: "TEXT3" })
      check.equal("#submit1", yield* roleAndName(page, "#submit1"), { role: "button", name: "SUBMIT1 Submit" })
      check.equal("#image1", yield* roleAndName(page, "#image1"), { role: "button", name: "IMAGE1 MORE1" })
      check.equal("#image2", yield* roleAndName(page, "#image2"), { role: "img", name: "IMAGE2 MORE2" })
      check.equal("#button1", yield* roleAndName(page, "#button1"), { role: "button", name: "BUTTON1" })
      check.equal("#button2", yield* roleAndName(page, "#button2"), { role: "button", name: "BUTTON2 MORE2" })
      check.equal("#button3", yield* roleAndName(page, "#button3"), { role: "button", name: "BUTTON3 MORE3" })
      check.equal("#button4", yield* roleAndName(page, "#button4"), { role: "button", name: "BUTTON4" })
      check.equal("#button5", yield* roleAndName(page, "#button5"), { role: "button", name: "BUTTON5 MORE5" })
      check.equal("#textarea1", yield* roleAndName(page, "#textarea1"), { role: "textbox", name: "TEXTAREA1 MORE2" })
      check.done()
    }))

  test("AR-155", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
    <button style='display: contents;'>yo</button>
  `)
      yield* Expect.toHaveCount(page.getByRole("button"), 1)
    }))

  test("AR-156", ({ page }) =>
    Effect.gen(function*() {
      const check = softly()
      yield* page.setContent(`
    <button>1­2​3</button>
  `)
      check.equal("button", yield* roleAndName(page, "button"), { role: "button", name: "123" })
      check.done()
    }))

  test("AR-157", ({ page }) =>
    Effect.gen(function*() {
      const check = softly()
      yield* page.setContent(`
    <body>
      <div id="case1">
        <button aria-labelledby="label1" type="button"></button>
        <tool-tip id="label1" for="button-preview" popover="manual" aria-hidden="true" role="tooltip">Label1</tool-tip>
      </div>
      <div id="case2">
        <label for="button2" aria-hidden="true"><div id="label2">Label2</div></label>
        <button id="button2" type="button"></button>
      </div>
    </body>
  `)
      // The original attaches a shadow root with a slot to each label with `$$eval`, in the page's main world
      yield* page.evaluateInMainWorld(() => {
        document.querySelectorAll("#label1, #label2").forEach((element) => {
          element.attachShadow({ mode: "open" }).appendChild(document.createElement("slot"))
        })
      })
      check.equal("#case1 button", yield* roleAndName(page, "#case1 button"), { role: "button", name: "Label1" })
      check.equal("#case2 button", yield* roleAndName(page, "#case2 button"), { role: "button", name: "Label2" })
      check.done()
    }))

  test("AR-158", ({ page }) =>
    Effect.gen(function*() {
      const check = softly()
      // This is taken from https://w3c.github.io/accname/#example-5-0
      yield* page.setContent(`
    <h1>Files</h1>
    <ul>
      <li>
        <a id="file_row1" href="./files/Documentation.pdf">Documentation.pdf</a>
        <span role="button" tabindex="0" id="del_row1" aria-label="Delete" aria-labelledby="del_row1 file_row1"></span>
      </li>
      <li>
        <a id="file_row2" href="./files/HolidayLetter.pdf">HolidayLetter.pdf</a>
        <span role="button" tabindex="0" id="del_row2" aria-label="Delete" aria-labelledby="del_row2 file_row2"></span>
      </li>
    </ul>
  `)
      check.equal("#del_row1", yield* roleAndName(page, "#del_row1"), {
        role: "button",
        name: "Delete Documentation.pdf"
      })
      check.equal("#del_row2", yield* roleAndName(page, "#del_row2"), {
        role: "button",
        name: "Delete HolidayLetter.pdf"
      })
      check.done()
    }))

  test("AR-159", ({ page }) =>
    Effect.gen(function*() {
      const check = softly()
      yield* page.setContent(`
    <label for="flash">
      <input type="checkbox" id="flash">
      Flash the screen <span tabindex="0" role="textbox" aria-label="number of times" contenteditable>5</span> times.
    </label>
  `)
      check.equal("input", yield* roleAndName(page, "input"), { role: "checkbox", name: "Flash the screen 5 times." })
      check.equal("span", yield* roleAndName(page, "span"), { role: "textbox", name: "number of times" })
      check.equal("label", yield* roleAndName(page, "label"), { role: null, name: "" })

      yield* page.setContent(`
    <input type="text" id="flash">
    <label for="flash">
      Flash the screen
      <div role="combobox">
        <div role="textbox"></div>
        <ul role="listbox" style="list-style-type: none">
          <li role="option" aria-selected="True">1</li>
          <li role="option" aria-selected="false">2</li>
          <li role="option">3</li>
        </ul>
      </div>
      times.
    </label>
  `)
      // The YAML `- textbox "Flash the screen 1 times."` is one node with that role and name and no children
      const { root } = yield* page.locator("#flash").snapshot({ sources: "aria" })
      check.equal("ariaSnapshot of #flash", {
        role: root.role.role,
        name: root.name._tag === "None" ? undefined : root.name.value,
        children: root.children.length
      }, { role: "textbox", name: "Flash the screen 1 times.", children: 0 })
      // The original's plain `expect` fails the test, and Playwright reports the soft mismatches before it too, so this
      // one joins them: the test fails either way, and the report shows both.
      yield* check.expectation(
        "getByRole('textbox', { name: 'Flash the screen 1 times.', exact: true }) has id flash",
        Expect.toHaveAttribute(
          page.getByRole("textbox", { name: "Flash the screen 1 times.", exact: true }),
          "id",
          "flash"
        )
      )
      check.done()
    }))

  test("AR-160", ({ page }) =>
    Effect.gen(function*() {
      const check = softly()
      yield* page.setContent(`
    <h1>
      <input type="text" value="Foo bar">
    </h1>
  `)
      check.equal("h1", yield* roleAndName(page, "h1"), { role: "heading", name: "Foo bar" })
      check.done()
    }))

  test("AR-161", ({ page }) =>
    Effect.gen(function*() {
      const check = softly()
      yield* page.setContent(`
    <button id="b1" aria-labelledby="l1"></button><div id="l1" hidden><input type="text" value="Query"></div>
    <button id="b2" aria-labelledby="l2"></button><div id="l2" hidden><input type="search" value="Query"></div>
    <label for="c1">Flash the screen <input type="search" value="5"> times.</label>
    <input type="checkbox" id="c1">
    <h1><input type="search" value="Foo bar"></h1>
  `)
      check.equal("#b1", yield* roleAndName(page, "#b1"), { role: "button", name: "Query" })
      check.equal("#b2", yield* roleAndName(page, "#b2"), { role: "button", name: "Query" })
      check.equal("#c1", yield* roleAndName(page, "#c1"), { role: "checkbox", name: "Flash the screen 5 times." })
      check.equal("h1", yield* roleAndName(page, "h1"), { role: "heading", name: "Foo bar" })
      check.done()
    }))

  test("AR-162", ({ page, server }) =>
    Effect.gen(function*() {
      const check = softly()
      yield* page.goto(server.EMPTY_PAGE)
      yield* page.setContent(`
\t\t<img src="pptr.png" alt="Code is Poetry." />
\t\t<svg viewBox="0 0 100 100" width="16" height="16" xmlns="http://www.w3.org/2000/svg" role="presentation" focusable="false"><circle cx="50" cy="50" r="50"></circle></svg>
  `)
      check.equal("img", yield* roleAndName(page, "img"), { role: "img", name: "Code is Poetry." })
      // The snapshot leaves out presentational elements (they read as `generic`), so the role is read by the matcher
      yield* check.expectation("svg role", Expect.toHaveRole(page.locator("svg"), "presentation"))
      check.equal("svg name", (yield* roleAndName(page, "svg")).name, "")
      check.done()
    }))

  test("AR-163", ({ page }) =>
    Effect.gen(function*() {
      const check = softly()
      yield* page.setContent(`
\t\t<form aria-label="my form">
      <input name="tagName" value="hello" title="tagName input">
      <input name="localName" value="hello" title="localName input">
    </form>
  `)
      check.equal("form", yield* roleAndName(page, "form"), { role: "form", name: "my form" })
      check.done()
    }))

  test("AR-164", ({ page }) =>
    Effect.gen(function*() {
      const check = softly()
      yield* page.setContent(`
    <div id=mylabel style="display:none">
      <template shadowrootmode=open>
        <style>span { color: red; }</style>
        <span>hello</span>
      </template>
    </div>
    <input aria-labelledby=mylabel type=text>
  `)
      check.equal("input", yield* roleAndName(page, "input"), { role: "textbox", name: "hello" })
      check.done()
    }))

  test("AR-165", ({ page }) =>
    Effect.gen(function*() {
      const check = softly()
      yield* page.setContent(`
    <style>
      span:before {
        content: 'world';
        display: none;
      }
      div:after {
        content: 'bye';
        visibility: hidden;
      }
    </style>
    <a href="http://example.com">
      <span>hello</span>
      <div>hello</div>
    </a>
  `)
      check.equal("a", yield* roleAndName(page, "a"), { role: "link", name: "hello hello" })
      check.done()
    }))

  test("AR-166", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
    <style>
    .stars:before {
      display: block;
      content: attr(data-hello);
    }
    </style>
    <a href="http://example.com">
      <div class="stars" data-hello="hello">world</div>
    </a>
  `)
      assert.deepStrictEqual(yield* roleAndName(page, "a"), { role: "link", name: "hello world" })
    }))

  test("AR-167", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
    <style>
      .with-content:before {
        content: url("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'></svg>") / "alternative text";
      }
    </style>
    <div role="button" class="with-content"> inner text</div>
  `)
      assert.deepStrictEqual(yield* roleAndName(page, "div"), { role: "button", name: "alternative text inner text" })
    }))

  test("AR-168", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
    <style>
      .with-content-1 {
        content: url("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'></svg>") / "alternative text";
      }
      .with-content-2 {
        content: url("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'></svg>");
      }
    </style>
    <div id="button1" role="button" class="with-content-1">inner text</div>
    <div id="button2" role="button" class="with-content-2">inner text</div>
  `)
      assert.deepStrictEqual(yield* roleAndName(page, "#button1"), { role: "button", name: "alternative text" })
      assert.deepStrictEqual(yield* roleAndName(page, "#button2"), { role: "button", name: "inner text" })
    }))

  test("AR-169", ({ page }) =>
    Effect.gen(function*() {
      const check = softly()
      yield* page.setContent(`
    <label>
      <span>Text here</span>
      <input type=text aria-labelledby="does-not-exist">
    </label>
  `)
      check.equal("input", yield* roleAndName(page, "input"), { role: "textbox", name: "Text here" })
      check.done()
    }))

  test("AR-170", ({ page }) =>
    Effect.gen(function*() {
      const check = softly()
      yield* page.setContent(`
    <search id=search1 aria-label="example">
      Hello
    </search>
    <search id=search2>
      World
    </search>
  `)
      check.equal("#search1", yield* roleAndName(page, "#search1"), { role: "search", name: "example" })
      check.equal("#search2", yield* roleAndName(page, "#search2"), { role: "search", name: "" })
      yield* check.expectation(
        "getByRole('search', { name: 'example' }) visible",
        Expect.toBeVisible(page.getByRole("search", { name: "example" }))
      )
      check.done()
    }))
})
