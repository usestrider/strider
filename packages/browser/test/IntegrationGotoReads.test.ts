/**
 * No integration case uses a page it navigated with a bare `goto`. `goto` returns at commit by default, before the
 * new document's body is parsed, so a one-shot read in the next step, such as an evaluation, a snapshot, a
 * locator's `readText` or `count`, or an added script or style tag, races the parser: it finds the fixture half
 * built, or without its `<head>`, and fails only sometimes. A case that reads right after navigating states
 * `waitUntil` as a string: `"load"` (or `"domContentLoaded"`) for the parsed document, or `"commit"` when the early
 * read is what it tests.
 *
 * The check parses every file under `test/integration/`. A `goto` is bare when its options don't state `waitUntil`
 * as a string literal. After a bare `x.goto`, it follows the statements that run an effect until the first one that
 * uses `x`, or a name declared from it, such as a locator or a frame; that statement is a finding when it reads
 * through one of them, and statements on other pages pass by. An `Effect.gen` body that ends after the `goto`
 * hands the window to the statements after it. A function that runs later, such as a helper, whose last effect is
 * a bare `goto` is a finding at that `goto` whoever calls it, named by its first caller's read in the same file;
 * a helper meant to return at commit states `"commit"`. Expectations, which retry, and actions, which wait for
 * their element, are not reads. The check doesn't follow calls: a read inside a function the case calls, or in
 * another file, isn't seen at the call.
 */
import { assert, describe, it } from "@effect/vitest"
import { readdirSync, readFileSync } from "node:fs"
import { relative } from "node:path"
import { fileURLToPath } from "node:url"
// The workspace's `typescript` is the native compiler, which has no JavaScript API; this alias is the last that does
import ts from "typescript-js-api"

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
const expectation = (node: ts.Node): boolean =>
  ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) &&
  ts.isIdentifier(node.expression.expression) && node.expression.expression.text === "Expect"

/** An `Effect.gen` body, which runs in place. */
const inline = (node: ts.Node): node is ts.FunctionExpression =>
  ts.isFunctionExpression(node) && node.asteriskToken !== undefined && ts.isCallExpression(node.parent) &&
  ts.isPropertyAccessExpression(node.parent.expression) && node.parent.expression.name.text === "gen"

/** A function that runs later, if at all. */
const deferred = (node: ts.Node): node is ts.SignatureDeclaration => ts.isFunctionLike(node) && !inline(node)

/** Visits a node's descendants, but not the functions it declares that run later, nor expectations. */
const visit = (node: ts.Node, f: (node: ts.Node) => void): void => {
  f(node)
  if (deferred(node) || expectation(node)) return
  ts.forEachChild(node, (child) => visit(child, f))
}

const within = (node: ts.Node, test: (node: ts.Node) => boolean): Array<ts.Node> => {
  const found: Array<ts.Node> = []
  ts.forEachChild(node, (child) =>
    visit(child, (descendant) => {
      if (test(descendant)) found.push(descendant)
    }))
  return found
}

/** The identifier an expression's chain of members and calls starts from: `page` in `page.frame(x).locator(y)`. */
const rootOf = (node: ts.Expression): string | undefined => {
  while (
    ts.isPropertyAccessExpression(node) || ts.isCallExpression(node) || ts.isElementAccessExpression(node) ||
    ts.isNonNullExpression(node) || ts.isParenthesizedExpression(node)
  ) node = node.expression
  return ts.isIdentifier(node) ? node.text : undefined
}

/** A `goto` call that leaves the wait to its default: no options, or none whose `waitUntil` is a string literal. */
const bareGoto = (node: ts.Node): node is ts.CallExpression & { expression: ts.PropertyAccessExpression } => {
  if (!ts.isCallExpression(node)) return false
  const callee = node.expression
  if (!ts.isPropertyAccessExpression(callee) || callee.name.text !== "goto") return false
  const options = node.arguments[1]
  return options === undefined || !ts.isObjectLiteralExpression(options) ||
    !options.properties.some((property) =>
      ts.isPropertyAssignment(property) && ts.isIdentifier(property.name) && property.name.text === "waitUntil" &&
      ts.isStringLiteralLike(property.initializer)
    )
}

const runsEffect = (statement: ts.Statement): boolean => within(statement, ts.isYieldExpression).length > 0

/** Whether a node names one of the names anywhere in it, callbacks included, as a value rather than a member. */
const mentions = (node: ts.Node, names: ReadonlySet<string>): boolean => {
  let found = false
  const walk = (child: ts.Node): void => {
    if (found) return
    if (
      ts.isIdentifier(child) && names.has(child.text) &&
      !(ts.isPropertyAccessExpression(child.parent) && child.parent.name === child)
    ) found = true
    else ts.forEachChild(child, walk)
  }
  walk(node)
  return found
}

/** Effect's own modules, whose `all` combines effects rather than reading a page. */
const combinator = (node: ts.Expression): boolean =>
  ts.isIdentifier(node) && ["Array", "Effect", "Option", "Promise", "Stream"].includes(node.text)

/** The first read in a statement through one of the names, as its receiver or an argument; with none, any read. */
const readThrough = (statement: ts.Statement, names: ReadonlySet<string>): string | undefined => {
  const through = (node: ts.Expression) => {
    const name = rootOf(node)
    return name !== undefined && names.has(name)
  }
  const read = within(
    statement,
    (node) =>
      ts.isPropertyAccessExpression(node) && isRead(node.name.text) && !combinator(node.expression) &&
      (names.size === 0 || through(node.expression) ||
        (ts.isCallExpression(node.parent) && node.parent.expression === node && node.parent.arguments.some(through)))
  )[0]
  return read !== undefined && ts.isPropertyAccessExpression(read) ? read.name.text : undefined
}

const bindingNames = (name: ts.BindingName): Array<string> =>
  ts.isIdentifier(name)
    ? [name.text]
    : name.elements.flatMap((element) => ts.isBindingElement(element) ? bindingNames(element.name) : [])

/** The names, and every name declared in the scope from one of them, until nothing more joins. */
const aliases = (scope: ts.Node, names: Iterable<string>): Set<string> => {
  const found = new Set(names)
  const declarations = within(scope, ts.isVariableDeclaration) as Array<ts.VariableDeclaration>
  for (let grew = found.size > 0; grew;) {
    grew = false
    for (const declaration of declarations) {
      if (declaration.initializer === undefined || !mentions(declaration.initializer, found)) continue
      for (const name of bindingNames(declaration.name)) {
        if (!found.has(name)) grew = found.add(name) !== undefined
      }
    }
  }
  return found
}

/** The statement of a block that holds a node, with its block, or the function that runs later and holds it. */
const holder = (node: ts.Node): { statement: ts.Statement; block: ts.Block | ts.SourceFile } | ts.Node => {
  for (let child = node; child.parent !== undefined; child = child.parent) {
    const parent = child.parent
    if ((ts.isBlock(parent) || ts.isSourceFile(parent)) && ts.isStatement(child)) {
      return { statement: child, block: parent }
    }
    if (deferred(parent)) return parent
  }
  return node
}

type Window = { readonly read: string } | { readonly ended: true } | { readonly returns: ts.Node }

/** The names a block declares in its own statements. */
const declares = (block: ts.Block | ts.SourceFile): Array<string> =>
  block.statements.flatMap((statement) =>
    ts.isVariableStatement(statement)
      ? statement.declarationList.declarations.flatMap((declaration) => bindingNames(declaration.name))
      : []
  )

/**
 * Follows the statements after a node until one that runs an effect uses one of the names, and says whether it
 * reads through them. Past the end of a block, the window goes on after the statement that holds the block, until
 * it leaves a function that runs later: the node that function returns to. A name the block declares goes out of
 * scope there, and the window ends with it, unless the block returns it, as an `Effect.gen` body that returns
 * the page, whose result is then one of the names.
 */
const follow = (start: ts.Node, names: ReadonlySet<string>): Window => {
  let at = holder(start)
  let live = new Set(names)
  while ("statement" in at) {
    const { block, statement } = at
    for (const next of block.statements.slice(block.statements.indexOf(statement) + 1)) {
      if (!runsEffect(next) || (live.size > 0 && !mentions(next, live))) continue
      const read = readThrough(next, live)
      return read === undefined ? { ended: true } : { read }
    }
    if (ts.isSourceFile(block)) return { ended: true }
    const parent = holder(block)
    const leaving = declares(block).filter((name) => live.has(name))
    if (leaving.length > 0 && "statement" in parent) {
      const returned = block.statements.some((each) =>
        ts.isReturnStatement(each) && each.expression !== undefined && mentions(each.expression, live)
      )
      if (!returned) return { ended: true }
      live = new Set([...live].filter((name) => !leaving.includes(name)))
    }
    at = parent
  }
  return { returns: at }
}

/** The test runner's own calls, whose functions are cases and suites rather than helpers. */
const runner = new Set(["describe", "it", "layer", "suite", "test"])

/** The name a helper is declared as, through the calls that wrap it, as `Effect.fnUntraced(function*() {})`. */
const helperName = (helper: ts.Node): string | undefined => {
  if (ts.isFunctionDeclaration(helper)) return helper.name?.text
  let node = helper
  while (ts.isCallExpression(node.parent) || ts.isParenthesizedExpression(node.parent)) {
    if (ts.isCallExpression(node.parent) && runner.has(rootOf(node.parent.expression) ?? "")) return undefined
    node = node.parent
  }
  return ts.isVariableDeclaration(node.parent) && ts.isIdentifier(node.parent.name) ? node.parent.name.text : undefined
}

/** Whether a function is a case or a suite: an argument of the runner's calls, directly or through others. */
const isCase = (helper: ts.Node): boolean => {
  for (let node = helper; ts.isCallExpression(node.parent) || ts.isParenthesizedExpression(node.parent);) {
    node = node.parent
    if (ts.isCallExpression(node) && runner.has(rootOf(node.expression) ?? "")) return true
  }
  return false
}

/** The first read after a call of the helper in the same file, through the names its result is declared as. */
const callerRead = (source: ts.SourceFile, name: string): string | undefined => {
  const calls = all(
    source,
    (node): node is ts.CallExpression =>
      ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === name
  )
  for (const call of calls) {
    let node: ts.Node = call
    while (!ts.isVariableDeclaration(node) && !ts.isStatement(node)) node = node.parent
    if (!ts.isVariableDeclaration(node)) continue
    const scope = ts.findAncestor(node, deferred) ?? source
    const window = follow(node, aliases(scope, bindingNames(node.name)))
    if ("read" in window) return window.read
  }
  return undefined
}

/** Each bare `goto` whose page is used once before anything waits, as `file:line, then <member>`. */
const flagged = (path: string, text = readFileSync(path, "utf8")): Array<string> => {
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true)
  const found: Array<string> = []
  for (const goto of all(source, bareGoto)) {
    const receiver = rootOf(goto.expression.expression)
    const scope = ts.findAncestor(goto, deferred) ?? source
    const window = follow(goto, aliases(scope, receiver === undefined ? [] : [receiver]))
    const then = "read" in window
      ? window.read
      : "returns" in window && !isCase(window.returns)
      ? callerRead(source, helperName(window.returns) ?? "") ?? "returns it"
      : undefined
    if (then === undefined) continue
    const { line } = source.getLineAndCharacterOfPosition(goto.getStart(source))
    found.push(`${relative(root, path)}:${line + 1}, then ${then}`)
  }
  return found
}

/** Every node in a file that passes the test, functions included. */
const all = <A extends ts.Node>(node: ts.Node, test: (node: ts.Node) => node is A): Array<A> => {
  const found: Array<A> = []
  const walk = (child: ts.Node): void => {
    if (test(child)) found.push(child)
    ts.forEachChild(child, walk)
  }
  walk(node)
  return found
}

const files = (directory: string): Array<string> =>
  readdirSync(directory, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".ts"))
    .map((entry) => `${entry.parentPath}/${entry.name}`)
    .sort()

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

  it("flags navigation in a shared helper before its caller reads the page", () => {
    const sample = `
const open = Effect.fnUntraced(function*() {
  const page = yield* Browser.newPage()
  yield* page.goto(url)
  return page
})
describe("fixture", () => {
  it.effect("reads the fixture", () => Effect.gen(function*() {
    const page = yield* open()
    yield* page.evaluateInMainWorld(() => document.body.textContent)
  }))
})`
    assert.deepStrictEqual(flagged(`${integration}sample.ts`, sample), [
      "test/integration/sample.ts:4, then evaluateInMainWorld"
    ])
  })

  it("does not treat loading a second page as readiness of the first", () => {
    const sample = `
Effect.gen(function*() {
  yield* first.goto(url)
  yield* second.goto(otherUrl, { waitUntil: "load" })
  yield* first.evaluateInMainWorld(() => document.body.textContent)
})`
    assert.deepStrictEqual(flagged(`${integration}sample.ts`, sample), [
      "test/integration/sample.ts:3, then evaluateInMainWorld"
    ])
  })

  it("treats an undefined waitUntil as the default commit wait", () => {
    const sample = `
Effect.gen(function*() {
  yield* page.goto(url, { waitUntil: undefined })
  yield* page.evaluateInMainWorld(() => document.body.textContent)
})`
    assert.deepStrictEqual(flagged(`${integration}sample.ts`, sample), [
      "test/integration/sample.ts:3, then evaluateInMainWorld"
    ])
  })

  it("checks frames and second pages across synchronous statements", () => {
    const sample = `
Effect.gen(function*() {
  yield* frame.goto(url)
  source = "x"
  assert.isTrue(source.length > 0)
  yield* frame.evaluateInMainWorld(() => document.body.textContent)
  yield* second.goto(url)
  yield* second.locator("p").readText
})`
    assert.deepStrictEqual(flagged(`${integration}sample.ts`, sample), [
      "test/integration/sample.ts:3, then evaluateInMainWorld",
      "test/integration/sample.ts:7, then readText"
    ])
  })

  it("ends the window where the navigated page goes out of scope", () => {
    const sample = `
Effect.gen(function*() {
  yield* Effect.scoped(Effect.gen(function*() {
    const page = yield* newPage
    yield* page.goto(url)
  }))
  yield* Effect.scoped(Effect.gen(function*() {
    const page = yield* newPage
    yield* page.evaluateInMainWorld(() => document.title)
  }))
  const kept = yield* Effect.gen(function*() {
    const page = yield* newPage
    yield* page.goto(url)
    return page
  })
  yield* kept.evaluateInMainWorld(() => document.title)
})`
    assert.deepStrictEqual(flagged(`${integration}sample.ts`, sample), [
      "test/integration/sample.ts:13, then evaluateInMainWorld"
    ])
  })

  it("finds no case that reads the page right after a bare goto", () => {
    assert.deepStrictEqual(files(integration).flatMap((path) => flagged(path)), [])
  })
})
