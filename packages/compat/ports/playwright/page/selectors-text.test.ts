/**
 * Playwright's `tests/page/selectors-text.spec.ts`: text matching, through `getByText` and `filter({ hasText })`: quoted
 * and unquoted text, case, whitespace, regular expressions, text across child elements, text in comments and in
 * `head`, `script`, and `style`, `input` buttons, empty text, text in open shadow roots, and chains of text queries.
 * SE-028 to SE-032, SE-034 to SE-044, and SE-046 to SE-049 are ported; SE-033 and SE-045 are `needsFeature` (see the ledger).
 *
 * What the port changes:
 * - `text=x` is `getByText(x)`, a case-insensitive substring that matches the smallest element containing it. `text="x"`
 *   is `getByText(x, { exact: true })`, and `:text-is`, `:text`, and `:text-matches` are the same calls. A regular
 *   expression is passed as a `RegExp`, so the escapes in a selector string (`\\'`, `\\"`, `\\x`, `\\\\`) are the escapes
 *   of the JavaScript string the regular expression or text is written with.
 * - Strider's text is the element's text with whitespace collapsed (`readText` and `getByText`), and an exact match
 *   compares that whole text, as Playwright's own `getByText` with `exact` does. Playwright's legacy quoted `text="…"`
 *   and `:text-is` compare an element's own text-node runs instead, which `getByText` has no form of. SE-033 turns
 *   wholly on that and is `needsFeature`. SE-031 has four such assertions (`:text-is("Hello, world!")` and
 *   `text="Hello, world!"` find nothing, `:text-is("Hello")` and `text="Hello"` find the div), left out; the rest of the
 *   test is ported. SE-028's quoted forms agree with whole-text matching, since each of its elements holds only that text.
 * - `div >> text=x` matches the `div` itself where its own text is the match; Strider's `page.locator("div").getByText(x)`
 *   searches only below each div. So the port keeps the divs whose own text matches: `filter({ hasText })` for a
 *   substring or pattern, and `page.locator("div").and(page.getByText(x, { exact: true }))` for an exact one, which is
 *   also how `div:text(…)`, `div:text-is(…)`, and `div:text-matches(…)` are ported. SE-030, SE-044, and SE-048 do this.
 *   SE-049's `div` filters already test each div's own text.
 * - Playwright's `text=a >> text=b` chain is `getByText(a).getByText(b)`. The spellings of one chain (`text=yo>> text`,
 *   `'yo'>>"ya"`, `text=yo >>text=`, quote and space variants of the same text) are one call here: Playwright's selector
 *   parser reads them, and each one has the same meaning. Only one is ported.
 * - Playwright's selector errors (`page.$('"')`, `:text("foo", "bar")`, `:has-text(foo > bar)`, and the other syntax
 *   errors) have no Strider form: a `getByText` takes any string, so there's no error to check. They are left out.
 * - `:light`, the light-DOM-only suffix in SE-041 (`text:light=root1`), has no Strider form: text matching crosses open
 *   shadow roots. Those three assertions are left out, and the rest of the test is ported.
 * - Unquoted text with a leading space before its quote (`text= "ya"`) reads its quotes as text, so the port searches
 *   for `"ya"` with the quotes.
 * - `e.textContent` is `readText`, which collapses whitespace; the texts these tests read have single spaces, or none,
 *   so the collapsed text is the same. `e.outerHTML` is `readHtml`. `e.id` is `readAttribute("id")`.
 * - `page.$eval` and `page.$` take the first match, which is `.first`; `page.$$eval` and `page.$$` take all matches,
 *   which are `all` or `count`. The strict reads (`readHtml`, `readText`, `readAttribute`) fail on several matches, as
 *   Playwright's `$eval` doesn't; SE-042 turns on that.
 * - The original's `page.$eval("input", …)` and DOM edits run in the main world: `page.evaluateInMainWorld`.
 * - SE-036 asserts nothing: its loop only runs each query, so each count here only runs the query.
 * - SE-032's `issue` annotation is reporting metadata, not a step, and is left out.
 */
import { assert } from "@effect/vitest"
import { Deadline, Expect, type Locator } from "@usestrider/browser"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Option from "effect/Option"
import { startWaiting } from "../../harness/playwright.ts"
import { upstream } from "../../harness/upstream.ts"

/** Playwright's default for `expect`, which waits 5 seconds; a Strider expectation otherwise runs to the test's deadline. */
const expectDeadline = Deadline.within("5 seconds")

/** The uppercase tag of the one match, read from its outer HTML: `<section id="x">` is `SECTION`. */
const tagOf = Effect.fnUntraced(function*(locator: Locator.ReadonlyLocator) {
  const html = yield* locator.readHtml
  const start = /^<([A-Za-z][^\s/>]*)/.exec(html)
  assert(start !== null, `no start tag in ${html}`)
  return (start[1] ?? "").toUpperCase()
})

/** The `id` of the one match, or `undefined` when it has none. */
const idOf = (locator: Locator.ReadonlyLocator) => Effect.map(locator.readAttribute("id"), Option.getOrUndefined)

/** Each match's outer HTML, in order: Playwright's `$$eval(…, els => els.map(e => e.outerHTML))`. */
const htmlsOf = Effect.fnUntraced(function*(locator: Locator.ReadonlyLocator) {
  return yield* Effect.forEach(yield* locator.all, (match) => match.readHtml)
})

/** Each match's `id`, in order. */
const idsOf = Effect.fnUntraced(function*(locator: Locator.ReadonlyLocator) {
  return yield* Effect.forEach(yield* locator.all, (match) => idOf(match))
})

upstream(import.meta.filename, {}, (test) => {
  test("SE-028", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<div>yo</div><div>ya</div><div>\nye  </div>`)
      assert.strictEqual(yield* page.getByText("ya").first.readHtml, "<div>ya</div>")
      assert.strictEqual(yield* page.getByText("ya", { exact: true }).first.readHtml, "<div>ya</div>")
      assert.strictEqual(yield* page.getByText(/^[ay]+$/).first.readHtml, "<div>ya</div>")
      assert.strictEqual(yield* page.getByText(/Ya/i).first.readHtml, "<div>ya</div>")
      assert.strictEqual(yield* page.getByText("ye").first.readHtml, "<div>\nye  </div>")
      assert.include(yield* page.getByText("ye").first.readHtml, ">\nye  </div>")

      yield* page.setContent(`<div> ye </div><div>ye</div>`)
      assert.strictEqual(yield* page.getByText("ye", { exact: true }).first.readHtml, "<div> ye </div>")
      assert.include(yield* page.getByText("ye", { exact: true }).first.readHtml, "> ye </div>")

      yield* page.setContent(`<div>yo</div><div>"ya</div><div> hello world! </div>`)
      // `text="\\"ya"`: the quotes are the selector's, and the escaped quote is the text's own `"`.
      assert.strictEqual(yield* page.getByText("\"ya", { exact: true }).first.readHtml, "<div>\"ya</div>")
      assert.strictEqual(yield* page.getByText(/hello/).first.readHtml, "<div> hello world! </div>")
      assert.strictEqual(yield* page.getByText(/^\s*heLLo/i).first.readHtml, "<div> hello world! </div>")

      yield* page.setContent(`<div>yo<div>ya</div>hey<div>hey</div></div>`)
      assert.strictEqual(yield* page.getByText("hey").first.readHtml, "<div>hey</div>")
      // `text=yo>>text="ya"`: the chain's spellings (`text=yo>> text`, `'yo'>>"ya"`, `text=yo >>text='ya'`) are one call.
      assert.strictEqual(
        yield* page.getByText("yo").getByText("ya", { exact: true }).first.readHtml,
        "<div>ya</div>"
      )

      yield* page.setContent(
        `<div>yo<span id="s1"></span></div><div>yo<span id="s2"></span><span id="s3"></span></div>`
      )
      assert.strictEqual(
        (yield* htmlsOf(page.getByText("yo"))).join("\n"),
        "<div>yo<span id=\"s1\"></span></div>\n<div>yo<span id=\"s2\"></span><span id=\"s3\"></span></div>"
      )

      yield* page.setContent(`<div>'</div><div>"</div><div>\\</div><div>x</div>`)
      // Each quoted form of a text is the same exact match: the escapes belong to the selector string.
      assert.strictEqual(yield* page.getByText("'", { exact: true }).first.readHtml, "<div>'</div>")
      assert.strictEqual(yield* page.getByText("\"", { exact: true }).first.readHtml, "<div>\"</div>")
      assert.strictEqual(yield* page.getByText("x", { exact: true }).first.readHtml, "<div>x</div>")
      assert.strictEqual(yield* page.getByText("\\", { exact: true }).first.readHtml, "<div>\\</div>")

      yield* page.setContent(`<div> ' </div><div> " </div>`)
      assert.strictEqual(yield* page.getByText("\"", { exact: true }).first.readHtml, "<div> \" </div>")
      assert.strictEqual(yield* page.getByText("'", { exact: true }).first.readHtml, "<div> ' </div>")

      yield* page.setContent(`<div>Hi''&gt;&gt;foo=bar</div>`)
      assert.strictEqual(
        yield* page.getByText("Hi''>>foo=bar", { exact: true }).first.readHtml,
        `<div>Hi''&gt;&gt;foo=bar</div>`
      )
      yield* page.setContent(`<div>Hi'"&gt;&gt;foo=bar</div>`)
      assert.strictEqual(
        yield* page.getByText("Hi'\">>foo=bar", { exact: true }).first.readHtml,
        `<div>Hi'"&gt;&gt;foo=bar</div>`
      )

      yield* page.setContent(`<div>Hi&gt;&gt;<span></span></div>`)
      assert.strictEqual(yield* page.getByText("Hi>>", { exact: true }).locator("span").first.readHtml, `<span></span>`)
      assert.strictEqual(yield* page.getByText(/Hi>>/).locator("span").first.readHtml, `<span></span>`)

      yield* page.setContent(`<div>a<br>b</div><div>a</div>`)
      assert.strictEqual(yield* page.getByText("a").first.readHtml, "<div>a<br>b</div>")
      assert.strictEqual(yield* page.getByText("b").first.readHtml, "<div>a<br>b</div>")
      assert.strictEqual(yield* page.getByText("ab").first.readHtml, "<div>a<br>b</div>")
      assert.strictEqual(yield* page.getByText("abc").count, 0)
      assert.strictEqual(yield* page.getByText("a").count, 2)
      assert.strictEqual(yield* page.getByText("b").count, 1)
      assert.strictEqual(yield* page.getByText("ab").count, 1)
      assert.strictEqual(yield* page.getByText("abc").count, 0)

      yield* page.setContent(`<div></div><span></span>`)
      yield* page.evaluateInMainWorld(() => {
        const div = document.querySelector("div") as HTMLElement
        div.appendChild(document.createTextNode("hello"))
        div.appendChild(document.createTextNode("world"))
        const span = document.querySelector("span") as HTMLElement
        span.appendChild(document.createTextNode("hello"))
        span.appendChild(document.createTextNode("world"))
      })
      assert.strictEqual(yield* page.getByText("lowo").first.readHtml, "<div>helloworld</div>")
      assert.strictEqual(
        (yield* htmlsOf(page.getByText("lowo"))).join(""),
        "<div>helloworld</div><span>helloworld</span>"
      )

      yield* page.setContent(`<span>Sign&nbsp;in</span><span>Hello\n \nworld</span>`)
      assert.strictEqual(yield* page.getByText("Sign in").first.readHtml, "<span>Sign&nbsp;in</span>")
      assert.strictEqual(yield* page.getByText("Sign \tin").count, 1)
      assert.strictEqual(yield* page.getByText("Sign in", { exact: true }).count, 1)
      assert.strictEqual(yield* page.getByText("lo wo").first.readHtml, "<span>Hello\n \nworld</span>")
      assert.strictEqual(
        yield* page.getByText("Hello world", { exact: true }).first.readHtml,
        "<span>Hello\n \nworld</span>"
      )
      assert.strictEqual(yield* page.getByText("lo wo", { exact: true }).count, 0)
      assert.strictEqual(yield* page.getByText("lo \nwo").count, 1)
      assert.strictEqual(yield* page.getByText("lo \nwo", { exact: true }).count, 0)

      yield* page.setContent(`<div>let's<span>hello</span></div>`)
      assert.strictEqual(yield* page.getByText(/let's/i).locator("span").first.readHtml, "<span>hello</span>")
      // `text=/let\\'s/i`: the regular expression escape of the apostrophe is the same expression.
      assert.strictEqual(yield* page.getByText(/let's/i).locator("span").first.readHtml, "<span>hello</span>")
    }))

  test("SE-029", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<div>yo</div><div>ya</div><div>\nHELLO   \n world  </div>`)
      assert.strictEqual(yield* page.getByText("ya").first.readHtml, "<div>ya</div>")
      assert.strictEqual(yield* page.getByText("ya", { exact: true }).first.readHtml, "<div>ya</div>")
      assert.strictEqual(yield* page.getByText("y").first.readHtml, "<div>yo</div>")
      assert.strictEqual(yield* page.getByText("Y", { exact: true }).count, 0)
      assert.strictEqual(
        yield* page.getByText("hello world").first.readHtml,
        "<div>\nHELLO   \n world  </div>"
      )
      assert.strictEqual(
        yield* page.getByText("HELLO world", { exact: true }).first.readHtml,
        "<div>\nHELLO   \n world  </div>"
      )
      assert.strictEqual(yield* page.getByText("lo wo").first.readHtml, "<div>\nHELLO   \n world  </div>")
      assert.strictEqual(yield* page.getByText("lo wo", { exact: true }).count, 0)
      assert.strictEqual(yield* page.getByText(/^[ay]+$/).first.readHtml, "<div>ya</div>")
      assert.strictEqual(yield* page.getByText(/y/g).first.readHtml, "<div>yo</div>")
      assert.strictEqual(yield* page.getByText(/Y/i).first.readHtml, "<div>yo</div>")
      assert.strictEqual(yield* page.getByText(/^y$/).count, 0)
      // `:text("foo", "bar")` and `:text(foo > bar)` are selector syntax errors; a getByText takes one string.
    }))

  test("SE-030", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<div></div><div>ya</div><div>\nHELLO   \n world  </div>`)
      // `div:text-is("")`, `div:text("")`, and `div:text-matches("")`: a div that is also the text's smallest match.
      const div = page.locator("div")
      assert.strictEqual(yield* div.and(page.getByText("", { exact: true })).first.readHtml, "<div></div>")
      assert.strictEqual(yield* div.and(page.getByText("", { exact: true })).count, 1)
      assert.strictEqual(yield* div.and(page.getByText("")).first.readHtml, "<div></div>")
      assert.strictEqual(yield* div.and(page.getByText("")).count, 3)
      // `div >> text=""`: Playwright's chain matches the div itself, so the port keeps the divs whose own text is empty.
      assert.strictEqual(yield* div.filter({ hasText: /^$/ }).first.readHtml, "<div></div>")
      assert.strictEqual(yield* div.filter({ hasText: /^$/ }).count, 1)
      assert.strictEqual(yield* div.and(page.getByText(new RegExp(""))).first.readHtml, "<div></div>")
      assert.strictEqual(yield* div.and(page.getByText(new RegExp(""))).count, 3)
    }))

  test("SE-031", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<div id=target1>Hello<i>,</i> <span id=target2>world</span><b>!</b></div>`)

      assert.strictEqual(yield* idOf(page.getByText("Hello, world!").first), "target1")
      assert.strictEqual(yield* idOf(page.getByText("Hello").first), "target1")
      assert.strictEqual(yield* idOf(page.getByText("world").first), "target2")
      assert.strictEqual(yield* page.getByText("world").count, 1)
      assert.strictEqual(yield* page.getByText("hello world").count, 0)
      // `div:text("world")`: the smallest element for "world" is the span, so no div is also a match.
      assert.strictEqual(yield* page.locator("div").and(page.getByText("world")).count, 0)

      // `:text-is("world")` and `text="world"`. Playwright's quoted `text="…"` and `:text-is` compare an element's own
      // text-node runs, so `"Hello"` matches the div and `"Hello, world!"` nothing. getByText's `exact`, Playwright's own
      // and Strider's, compares the whole text instead; those four assertions have no Strider form (see the header).
      assert.strictEqual(yield* idOf(page.getByText("world", { exact: true }).first), "target2")
      assert.strictEqual(yield* page.getByText("world", { exact: true }).count, 1)

      // `:text-matches(".*")` is the first element a regular expression matches, which is the `<i>` in document order.
      assert.strictEqual(yield* tagOf(page.getByText(/.*/).first), "I")
      assert.strictEqual(yield* idOf(page.getByText(/world?/).first), "target2")
      assert.strictEqual(yield* page.getByText(/world/).count, 1)
      assert.strictEqual(yield* page.locator("div").and(page.getByText(/.*/)).count, 0)
    }))

  test("SE-032", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<div id=me>hel<!-- comment -->lo\n  <!-- comment -->\n  world</div>`)
      assert.strictEqual(yield* idOf(page.getByText("hello world", { exact: true }).first), "me")
      assert.strictEqual(yield* idOf(page.locator("div").filter({ hasText: "hello world" })), "me")
      assert.strictEqual(yield* idOf(page.getByText("hello world", { exact: true })), "me")
    }))

  test("SE-034", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<div id=target1>text</div><div id=target2>text</div>`)
      const setText = (value: string) =>
        page.evaluateInMainWorld((text: string) => {
          ;(document.querySelector("#target1") as HTMLElement).textContent = text
        }, value)

      yield* setText("text")
      assert.strictEqual(yield* idOf(page.getByText("text").first), "target1")
      yield* setText("foo")
      assert.strictEqual(yield* idOf(page.getByText("text").first), "target2")

      yield* setText("text")
      assert.strictEqual(yield* idOf(page.getByText("text").first), "target1")
      yield* setText("foo")
      assert.strictEqual(yield* idOf(page.getByText("text").first), "target2")

      yield* setText("text")
      assert.strictEqual(yield* page.getByText("text").count, 2)
      yield* setText("foo")
      assert.strictEqual(yield* page.getByText("text").count, 1)

      yield* setText("text")
      assert.strictEqual(yield* page.getByText("text").count, 2)
      yield* setText("foo")
      assert.strictEqual(yield* page.getByText("text").count, 1)
    }))

  test("SE-035", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
    <input id=input2>
    <div id=div1>
      <span>  Find me  </span>
      or
      <wrap><span id=span2>maybe me  </span></wrap>
      <div><input id=input1></div>
    </div>
  `)
      // `:has-text("find me")` matches any element containing the text; the first in document order is `html`.
      assert.strictEqual(yield* tagOf(page.locator("*").filter({ hasText: "find me" }).first), "HTML")
      assert.strictEqual(
        yield* page.locator("span").filter({ hasText: "find me" }).first.readHtml,
        "<span>  Find me  </span>"
      )
      assert.strictEqual(yield* idOf(page.locator("div").filter({ hasText: "find me" }).first), "div1")
      assert.strictEqual(
        yield* idOf(page.locator("div").filter({ hasText: "find me" }).locator("input").first),
        "input1"
      )
      assert.strictEqual(yield* idOf(page.locator("*").filter({ hasText: "find me" }).locator("input").first), "input2")
      assert.strictEqual(yield* idOf(page.locator("div").filter({ hasText: "find me or maybe me" }).first), "div1")
      assert.strictEqual(yield* page.locator("div").filter({ hasText: "find noone" }).count, 0)
      assert.strictEqual(
        (yield* idsOf(page.locator(":is(div,span)").filter({ hasText: "maybe" }))).join(";"),
        "div1;span2"
      )
      assert.strictEqual(
        yield* tagOf(
          page.locator("div").filter({ hasText: "find me" }).locator("*").filter({ hasText: "maybe me" })
            .first
        ),
        "WRAP"
      )
      assert.strictEqual(
        yield* idOf(
          page.locator("div").filter({ hasText: "find me" }).locator("span").filter({ hasText: "maybe me" }).first
        ),
        "span2"
      )

      yield* page.setContent(`<div id=me>hello
  wo"r>>ld</div>`)
      assert.strictEqual(yield* idOf(page.locator("div").filter({ hasText: "hello wo\"r>>ld" }).first), "me")
      // `div:has-text("hello\\a wo\\"r>>ld")`: the CSS escape `\a` is the newline, which the text's whitespace already is.
      assert.strictEqual(yield* idOf(page.locator("div").filter({ hasText: "hello\nwo\"r>>ld" }).first), "me")
    }))

  test("SE-036", ({ page }) =>
    Effect.gen(function*() {
      yield* page.evaluateInMainWorld(() => {
        let id = 0
        const next = (tag: string) => {
          const e = document.createElement(tag)
          const eid = ++id
          e.textContent = "id" + eid
          e.id = "id" + eid
          return e
        }
        const generate = (depth: number): HTMLElement => {
          const div = next("div")
          const span1 = next("span")
          const span2 = next("span")
          div.appendChild(span1)
          div.appendChild(span2)
          if (depth > 0) {
            div.appendChild(generate(depth - 1))
            div.appendChild(generate(depth - 1))
          }
          return div
        }
        document.body.appendChild(generate(12))
      })
      // The original asserts nothing: each query must run over the large DOM.
      yield* page.locator("*").filter({ hasText: "id18" }).count
      yield* page.locator("*").filter({ hasText: "id12345" }).count
      yield* page.locator("*").filter({ hasText: "id" }).count
      // `:text(…)` and `text=…` are the same calls here.
      yield* page.getByText("id18").count
      yield* page.getByText("id12345").count
      yield* page.getByText("id").count
      yield* page.getByText(/id12345/i).count
      yield* page.locator("#id18").count
      yield* page.locator("#id12345").count
      yield* page.locator("*").count
    }))

  test("SE-037", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<div>yo</div><div>ya</div><div>\nye  </div>`)
      assert.strictEqual(yield* page.getByText("yA").first.readHtml, "<div>ya</div>")
      assert.strictEqual(yield* page.getByText("yA", { exact: true }).count, 0)
      // `text= "ya"`: the space makes the quotes text, which this page doesn't have.
      assert.strictEqual(yield* page.getByText("\"ya\"").count, 0)
    }))

  test("SE-038", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<div>textwithsubstring</div>`)
      assert.strictEqual(yield* page.getByText("with").first.readHtml, "<div>textwithsubstring</div>")
      assert.strictEqual(yield* page.getByText("with", { exact: true }).count, 0)
    }))

  test("SE-039", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
    <head>
      <title>title</title>
      <script>var script</script>
      <style>.style {}</style>
    </head>
    <body>
      <script>var script</script>
      <style>.style {}</style>
      <div>title script style</div>
    </body>`)
      for (const text of ["title", "script", "style"]) {
        assert.strictEqual(yield* tagOf(page.getByText(text).first), "DIV")
        assert.strictEqual(yield* page.getByText(text).count, 1)
        for (const root of ["head", "title", "body script", "body style"]) {
          assert.strictEqual(yield* page.locator(root).getByText(text).count, 0, `${root} >> text=${text}`)
        }
      }
    }))

  test("SE-040", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(
        `<input type="submit" value="hello"><input type="button" value="world"><input type="reset" value="clear">`
      )
      assert.strictEqual(yield* page.getByText("hello").first.readHtml, "<input type=\"submit\" value=\"hello\">")
      assert.strictEqual(yield* page.getByText("world").first.readHtml, "<input type=\"button\" value=\"world\">")
      assert.strictEqual(yield* page.getByText("clear").first.readHtml, "<input type=\"reset\" value=\"clear\">")
    }))

  test("SE-041", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/deep-shadow.html")
      // `textContent` is read as `readText`: these texts have single spaces, so the collapsed text is the same.
      assert.strictEqual(yield* page.getByText("root1").first.readText, "Hello from root1")
      assert.strictEqual(yield* page.getByText("root2").first.readText, "Hello from root2")
      assert.strictEqual(yield* page.getByText("root3").first.readText, "Hello from root3")
      // `#root1` is the host of the shadow root that holds the text. A chained step doesn't enter its scope's own shadow
      // root, so this finds nothing: Strider's behavior, not the port's.
      assert.strictEqual(
        yield* page.locator("#root1").getByText("from root3").first.readText,
        "Hello from root3"
      )
      // `#target >> text=from root2`: the span is the text's own element, which Playwright's chain matches as the scope.
      assert.strictEqual(
        yield* page.locator("#target").filter({ hasText: "from root2" }).readText,
        "Hello from root2"
      )
      // `text:light=root1`, `text:light=root2`, and `text:light=root3` (null): see the header.
    }))

  test("SE-042", ({ page }) =>
    Effect.gen(function*() {
      yield* page.evaluateInMainWorld(() => {
        const div = document.createElement("div")
        document.body.appendChild(div)

        div.attachShadow({ mode: "open" })
        const shadowSpan = document.createElement("span")
        shadowSpan.textContent = "Hello from shadow"
        div.shadowRoot?.appendChild(shadowSpan)

        const lightSpan = document.createElement("span")
        lightSpan.textContent = "Hello from light"
        div.appendChild(lightSpan)
      })
      // `div >> text=Hello`: Playwright prefers the light span. Strider's chained step doesn't enter its scope's own shadow
      // root, so the shadow span isn't a candidate and the light span is the only match: the test passes without
      // exercising the preference.
      assert.strictEqual(yield* page.locator("div").getByText("Hello").readText, "Hello from light")
    }))

  test("SE-043", ({ page }) =>
    Effect.gen(function*() {
      const waiting = yield* startWaiting(
        Expect.toBeVisible(page.locator("div").getByText("Hello")).pipe(expectDeadline)
      )
      yield* page.evaluateInMainWorld(() => {
        const div = document.createElement("div")
        document.body.appendChild(div)

        div.attachShadow({ mode: "open" })
        const shadowSpan = document.createElement("span")
        shadowSpan.textContent = "Hello from shadow"
        div.shadowRoot?.appendChild(shadowSpan)
        div.shadowRoot?.appendChild(document.createElement("slot"))

        const lightSpan = document.createElement("span")
        lightSpan.textContent = "Hello from light"
        div.appendChild(lightSpan)
      })
      yield* Fiber.join(waiting.fiber)
      assert.strictEqual(yield* page.locator("div").getByText("Hello").readText, "Hello from light")
    }))

  test("SE-044", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<section>test</section>")
      // `css=section >> text=test`: Playwright's chain includes the section itself, which is the match; `filter` tests
      // the section's own text.
      assert.strictEqual(yield* page.locator("section").filter({ hasText: "test" }).count, 1)
      // `text=test >> text=test`: the section is the first step's match and the second step's too.
      assert.strictEqual(yield* page.getByText("test").filter({ hasText: "test" }).count, 1)
    }))

  test("SE-046", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<button> Add widget </button>`)
      yield* Expect.toBeVisible(page.getByText("Add widget")).pipe(expectDeadline)
      // `text= Add widget `: the query's surrounding spaces are trimmed.
      yield* Expect.toBeVisible(page.getByText(" Add widget ")).pipe(expectDeadline)
    }))

  test("SE-047", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
    <div>hello"world<span>yay</span></div>
    <div>hello'world<span>nay</span></div>
    <div>hello\`world<span>oh</span></div>
    <div>hello\`world<span>oh2</span></div>
  `)
      // `text=lo" >> span`: the spellings with spaces around `text`, `>>`, and `=` are one call.
      assert.strictEqual(yield* page.getByText("lo\"").locator("span").first.readHtml, "<span>yay</span>")
      assert.strictEqual(yield* page.getByText("o\"wor").locator("span").first.readHtml, "<span>yay</span>")

      assert.strictEqual(yield* page.getByText("lo'wor").locator("span").first.readHtml, "<span>nay</span>")
      assert.strictEqual(yield* page.getByText("o'").locator("span").first.readHtml, "<span>nay</span>")

      assert.strictEqual(yield* page.getByText("ello`wor").locator("span").first.readHtml, "<span>oh</span>")
      yield* Expect.toHaveText(page.getByText("ello`wor").locator("span").first, "oh").pipe(expectDeadline)
      yield* Expect.toHaveText(page.getByText("ello`wor").locator("span").nth(1), "oh2").pipe(expectDeadline)
      // `text='wor >> span`, `text=" >> span`, and text=\` >> span` are unpaired quotes that Playwright's selector
      // parser reads at the start of the selector. Their meaning is the parser's, so they are left out.
    }))

  test("SE-048", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<div>pattern "^-?\\d+$"</div>`)
      // Playwright's `expect(...)` without a matcher only runs the read: `isVisible` must still resolve.
      // `div >> text=…` matches the div itself, which is the text's smallest element: `filter` and `and` test the div's own
      // text, where `getByText` chained from the div searches only below it.
      const div = page.locator("div")
      yield* div.filter({ hasText: "pattern \"^-?\\d+$" }).isVisible
      yield* div.filter({ hasText: "pattern \"^-?\\d+$\"" }).isVisible
      yield* div.and(page.getByText("pattern \"^-?\\d+$\"", { exact: true })).isVisible
      yield* Expect.toBeVisible(div.filter({ hasText: "pattern \"^-?\\d+$" })).pipe(expectDeadline)
      yield* Expect.toBeVisible(div.filter({ hasText: "pattern \"^-?\\d+$\"" })).pipe(expectDeadline)
      // Playwright's `text='pattern "^-?\\\\d+$"'`: the quoted text reads its escaped backslash as one.
      yield* Expect.toBeVisible(div.and(page.getByText("pattern \"^-?\\d+$\"", { exact: true }))).pipe(
        expectDeadline
      )
    }))

  test("SE-049", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
    <div id=div1>hello<span>world</span></div>
    <div id=div2>hello</div>
  `)
      yield* Expect.toHaveAttribute(page.getByText("helloworld", { exact: true }), "id", "div1").pipe(expectDeadline)
      yield* Expect.toHaveAttribute(page.getByText("hello", { exact: true }), "id", "div2").pipe(expectDeadline)
      yield* Expect.toHaveAttribute(page.locator("div").filter({ hasText: /^helloworld$/ }), "id", "div1").pipe(
        expectDeadline
      )
      yield* Expect.toHaveAttribute(page.locator("div").filter({ hasText: /^hello$/ }), "id", "div2").pipe(
        expectDeadline
      )

      yield* page.setContent(`
    <div id=div1><span id=span1>hello</span>world</div>
    <div id=div2><span id=span2>hello</span></div>
  `)
      yield* Expect.toHaveAttribute(page.getByText("helloworld", { exact: true }), "id", "div1").pipe(expectDeadline)
      assert.deepStrictEqual(
        yield* idsOf(page.getByText("hello", { exact: true })),
        ["span1", "span2"]
      )
      yield* Expect.toHaveAttribute(page.locator("div").filter({ hasText: /^helloworld$/ }), "id", "div1").pipe(
        expectDeadline
      )
      yield* Expect.toHaveAttribute(page.locator("div").filter({ hasText: /^hello$/ }), "id", "div2").pipe(
        expectDeadline
      )
    }))
})
