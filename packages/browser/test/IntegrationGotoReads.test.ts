/**
 * No integration case uses a page it navigated with a bare `goto`. `goto` returns at commit by default, before the
 * new document's body is parsed, so a one-shot read in the next step, such as an evaluation, a snapshot, a
 * locator's `readText` or `count`, or an added script or style tag, races the parser: it finds the fixture half
 * built, or without its `<head>`, and fails only sometimes. A case that reads right after navigating states
 * `waitUntil`: `"load"` (or `"domcontentloaded"`) for the parsed document, or `"commit"` when the early read is what
 * it tests.
 *
 * The check parses every file under `test/integration/` and flags a `goto` whose options don't state `waitUntil`
 * when the next statement that runs an effect after it uses the page once. Expectations, which retry, and actions,
 * which wait for their element, are not reads.
 */
import { assert, describe, it } from "@effect/vitest"
import { readdirSync, readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { relative } from "node:path"
import { fileURLToPath } from "node:url"
import type * as Ts from "../../tools/docs/node_modules/typescript/lib/typescript.d.ts"

// The workspace's own `typescript` is the native compiler, which has no JavaScript API; the docs tools pin the last
// one that does.
const ts: typeof Ts = createRequire(new URL("../../tools/docs/package.json", import.meta.url))("typescript")

const root = fileURLToPath(new URL("../", import.meta.url))
const integration = fileURLToPath(new URL("integration/", import.meta.url))

/**
 * The members that use the document once, as it is, without waiting for what they read: reads, and the script and
 * style tags, which add an element to whatever of the document exists.
 */
const reads = new Set([
  "addScriptTag",
  "addStyleTag",
  "all",
  "boundingBox",
  "content",
  "count",
  "history",
  "isChecked",
  "isEditable",
  "isEnabled",
  "isVisible",
  "readAttribute",
  "readHtml",
  "readText",
  "readValue",
  "snapshot",
  "title"
])

const isRead = (name: string) => reads.has(name) || name.startsWith("evaluate")

/** An expectation, which retries what it reads until it holds. */
const expectation = (node: Ts.Node): boolean =>
  ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) &&
  ts.isIdentifier(node.expression.expression) && node.expression.expression.text === "Expect"

/** A function that runs later, if at all; a generator is taken to be an `Effect.gen` body, which runs in place. */
const deferred = (node: Ts.Node): boolean =>
  ts.isFunctionLike(node) && !(ts.isFunctionExpression(node) && node.asteriskToken !== undefined)

/** Visits a node's descendants, but not the functions it declares that run later, nor expectations. */
const visit = (node: Ts.Node, f: (node: Ts.Node) => void): void => {
  f(node)
  if (deferred(node) || expectation(node)) return
  ts.forEachChild(node, (child) => visit(child, f))
}

const within = (node: Ts.Node, test: (node: Ts.Node) => boolean): Array<Ts.Node> => {
  const found: Array<Ts.Node> = []
  ts.forEachChild(node, (child) =>
    visit(child, (descendant) => {
      if (test(descendant)) found.push(descendant)
    }))
  return found
}

/** A `goto` call that leaves the wait to its default: no options, or an options literal without `waitUntil`. */
const bareGoto = (node: Ts.Node): boolean => {
  if (!ts.isCallExpression(node)) return false
  const callee = node.expression
  if (!ts.isPropertyAccessExpression(callee) || callee.name.text !== "goto") return false
  const options = node.arguments[1]
  if (options === undefined) return true
  return ts.isObjectLiteralExpression(options) &&
    !options.properties.some((property) =>
      property.name !== undefined && ts.isIdentifier(property.name) && property.name.text === "waitUntil"
    )
}

const readsPage = (node: Ts.Node): node is Ts.PropertyAccessExpression =>
  ts.isPropertyAccessExpression(node) && isRead(node.name.text) &&
  !(ts.isIdentifier(node.expression) &&
    ["Effect", "Stream", "Array", "Promise", "Option"].includes(node.expression.text))

const runsEffect = (statement: Ts.Statement): boolean =>
  within(statement, (node) => ts.isYieldExpression(node)).length > 0

const files = (directory: string): Array<string> =>
  readdirSync(directory, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".ts"))
    .map((entry) => `${entry.parentPath}/${entry.name}`)
    .sort()

/**
 * Whether nothing runs after a `goto` within the statement that holds it, as when an `Effect.gen` body navigates
 * and returns the page: the statement's successor is then the `goto`'s next step.
 */
const endsWith = (goto: Ts.Node, statement: Ts.Statement): boolean => {
  for (let node = goto; node !== statement; node = node.parent) {
    const parent = node.parent
    if ((ts.isBlock(parent) || ts.isSourceFile(parent)) && ts.isStatement(node)) {
      const after = parent.statements.slice(parent.statements.indexOf(node) + 1)
      if (after.some(runsEffect)) return false
    }
  }
  return true
}

/** Each bare `goto` the next effect of whose block reads the page, as `file:line`. */
const flagged = (path: string, text = readFileSync(path, "utf8")): Array<string> => {
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true)
  const found: Array<string> = []
  const check = (node: Ts.Node): void => {
    if (ts.isBlock(node) || ts.isSourceFile(node)) {
      const statements = node.statements
      statements.forEach((statement, index) => {
        const gotos = within(statement, bareGoto).filter((goto) => endsWith(goto, statement))
        if (gotos.length === 0) return
        const next = statements.slice(index + 1).find(runsEffect)
        const read = next === undefined ? undefined : within(next, readsPage)[0]
        if (read === undefined || !ts.isPropertyAccessExpression(read)) return
        const { line } = source.getLineAndCharacterOfPosition(gotos[0]!.getStart(source))
        found.push(`${relative(root, path)}:${line + 1}, then ${read.name.text}`)
      })
    }
    ts.forEachChild(node, check)
  }
  check(source)
  return found
}

describe("Integration goto reads", () => {
  it("flags a read right after a bare goto, and nothing else", () => {
    const sample = `
Effect.gen(function*() {
  yield* page.goto(url)
  const source = "x"
  yield* page.evaluate(() => document.head.append(source))
  yield* page.goto(url, { accept: ["download"] })
  assert.strictEqual(yield* page.locator("p").readText, "x")
  yield* page.goto(url, { waitUntil: "commit" })
  yield* page.evaluate(() => 1)
  yield* page.goto(url, { waitUntil: "load" })
  yield* page.locator("p").count
  yield* page.goto(url)
  yield* Expect.that(page.locator("p").readText, (text) => text === "x")
  yield* page.goto(url)
  yield* page.locator("button").click()
  const opened = yield* Effect.gen(function*() {
    yield* page.goto(url)
    return page
  })
  yield* opened.evaluate(() => document.title)
  yield* Effect.gen(function*() {
    yield* page.goto(url)
    yield* page.route(url, () => Route.abort())
  })
  yield* page.locator("p").readText
})`
    assert.deepStrictEqual(flagged(`${integration}sample.ts`, sample), [
      "test/integration/sample.ts:3, then evaluate",
      "test/integration/sample.ts:6, then readText",
      "test/integration/sample.ts:17, then evaluate"
    ])
  })

  it("finds no case that reads the page right after a bare goto", () => {
    assert.deepStrictEqual(files(integration).flatMap((path) => flagged(path)), [])
  })
})
