/**
 * The index of an upstream suite: every test in a pinned checkout, read from its source and never run. A checkout is
 * untrusted data, so nothing in it is imported, built, or executed: its files are parsed as text.
 */
import { parse } from "@babel/parser"
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import * as fs from "node:fs"
import * as path from "node:path"

export const root = path.resolve(import.meta.dirname, "..")

export interface Source {
  readonly name: string
  readonly status: "indexed" | "planned"
  readonly repository: string
  readonly revision?: string
  readonly license: string
  readonly include?: ReadonlyArray<string>
  /** How a test is named in the ledger: by the ID its title starts with, or as Puppeteer's runner names it. */
  readonly ids?: "prefixed" | "mocha"
  readonly assets?: string
  readonly expectations?: string
  readonly paths?: ReadonlyArray<string>
  readonly why: string
}

/** Puppeteer's own expectation for a test, as its `TestExpectations.json` states it. */
export interface UpstreamExpectation {
  readonly platforms: ReadonlyArray<string>
  readonly parameters: ReadonlyArray<string>
  readonly expectations: ReadonlyArray<string>
  readonly comment?: string
}

export interface UpstreamTest {
  /** The ledger's key: Playwright's ID (`OO-001`), or Puppeteer's test ID (`[oopif.test] OOPIF should …`). */
  readonly key: string
  readonly title: string
  readonly file: string
  readonly line: number
  readonly describe: ReadonlyArray<string>
  /** `skip`, `fixme`, `fail`, `slow`, or `only`, from the call itself (`it.fixme('…', …)`). */
  readonly modifier?: string
  /** The title is computed, as in a loop: a port expands it into variants. */
  readonly dynamic?: true
  /** The body's leading `it.skip(…)`, `it.fixme(…)`, `it.fail(…)` and `it.slow(…)` calls, as written. */
  readonly annotations?: ReadonlyArray<string>
  readonly upstream?: ReadonlyArray<UpstreamExpectation>
  /** The first 16 hex digits of the SHA-256 of the test's source: it changes when upstream changes the test. */
  readonly hash: string
}

export interface Index {
  readonly source: string
  readonly revision: string
  /** Each file's calls outside any test, such as `it.use({ launchOptions })` or a file-wide `it.skip(…)`. */
  readonly files: Readonly<Record<string, ReadonlyArray<string>>>
  readonly tests: ReadonlyArray<UpstreamTest>
}

export const readSources = (): ReadonlyArray<Source> =>
  (JSON.parse(fs.readFileSync(path.join(root, "sources/sources.json"), "utf8")) as { sources: Array<Source> }).sources

export const source = (name: string): Source => {
  const found = readSources().find((each) => each.name === name)
  if (found === undefined) throw new Error(`No source named ${name} in sources/sources.json`)
  return found
}

export const indexPath = (name: string) => path.join(root, "ledger", `${name}.json`)

export const readIndex = (name: string): Index => JSON.parse(fs.readFileSync(indexPath(name), "utf8")) as Index

/** One test a line, so a roll's diff shows each test that changed. */
export const writeIndex = (index: Index) => {
  const lines = [
    `{"source":${JSON.stringify(index.source)},"revision":${JSON.stringify(index.revision)},`,
    `"files":${JSON.stringify(index.files)},`,
    `"tests":[`,
    index.tests.map((test) => JSON.stringify(test)).join(",\n"),
    `]}`
  ]
  fs.writeFileSync(indexPath(index.source), lines.join("\n") + "\n")
}

interface Node {
  readonly type: string
  readonly start: number
  readonly end: number
  readonly loc: { readonly start: { readonly line: number } }
  readonly [key: string]: unknown
}

const isNode = (value: unknown): value is Node =>
  typeof value === "object" && value !== null && typeof (value as { type?: unknown }).type === "string"

const children = (node: Node): Array<Node> => {
  const found: Array<Node> = []
  for (const [key, value] of Object.entries(node)) {
    if (key === "loc" || key === "leadingComments" || key === "trailingComments" || key === "extra") continue
    if (Array.isArray(value)) found.push(...value.filter(isNode))
    else if (isNode(value)) found.push(value)
  }
  return found
}

/** `it.describe.parallel` as `["it", "describe", "parallel"]`, or undefined for any other callee. */
const chain = (callee: Node): Array<string> | undefined => {
  if (callee.type === "Identifier") return [callee["name"] as string]
  if (callee.type === "MemberExpression" && !callee["computed"]) {
    const object = chain(callee["object"] as Node)
    const property = callee["property"] as Node
    return object === undefined || property.type !== "Identifier" ? undefined : [...object, property["name"] as string]
  }
  return undefined
}

const bases = new Set(["it", "test"])
/** A test function: `it`, `test`, or a fixture-extended one such as Playwright's `browserTest` and `playwrightTest`. */
const isBase = (name: string) => bases.has(name) || /^[a-z][A-Za-z]*Test$/.test(name)
const modifiers = new Set(["only", "skip", "fixme", "fail", "slow"])
const isFunction = (node: Node) => node.type === "ArrowFunctionExpression" || node.type === "FunctionExpression"

/** A title as written: a literal's value, or a computed title's source with `dynamic`. */
const titleOf = (node: Node, code: string): { title: string; dynamic: boolean } | undefined => {
  if (node.type === "StringLiteral") return { title: node["value"] as string, dynamic: false }
  if (node.type === "TemplateLiteral") {
    const quasis = node["quasis"] as Array<Node>
    if ((node["expressions"] as Array<Node>).length === 0) {
      return { title: (quasis[0]!["value"] as { cooked: string }).cooked, dynamic: false }
    }
    return { title: code.slice(node.start + 1, node.end - 1), dynamic: true }
  }
  if (node.type === "BinaryExpression") return { title: code.slice(node.start, node.end), dynamic: true }
  return undefined
}

const sha = (text: string) => createHash("sha256").update(text).digest("hex").slice(0, 16)

const prefixed = /^([A-Z]{2,4}-\d{3})\s+(.*)$/s

const puppeteerId = (file: string, fullTitle: string) => `[${path.basename(file).replace(/\.ts$/, "")}] ${fullTitle}`

const matches = (pattern: string, id: string) =>
  new RegExp(
    "^" + pattern.split("*").map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join("(.*)?") + "$"
  ).test(id)

/** Every test in one file of a checkout. */
export const indexFile = (
  ids: "prefixed" | "mocha",
  file: string,
  code: string,
  expectations: ReadonlyArray<UpstreamExpectation & { readonly testIdPattern: string }>
): { tests: Array<UpstreamTest>; annotations: Array<string> } => {
  const program = parse(code, {
    sourceType: "module",
    plugins: ["typescript"],
    errorRecovery: false
  }) as unknown as Node
  const tests: Array<UpstreamTest> = []
  const annotations: Array<string> = []
  const describe: Array<string> = []

  const leading = (fn: Node): Array<string> => {
    const body = fn["body"] as Node
    if (body.type !== "BlockStatement") return []
    const found: Array<string> = []
    for (const statement of body["body"] as Array<Node>) {
      if (statement.type !== "ExpressionStatement") continue
      const expression = statement["expression"] as Node
      const call = expression.type === "AwaitExpression" ? expression["argument"] as Node : expression
      if (call.type !== "CallExpression") continue
      const names = chain(call["callee"] as Node)
      if (names !== undefined && names.length === 2 && isBase(names[0]!) && modifiers.has(names[1]!)) {
        found.push(code.slice(call.start, call.end))
      }
    }
    return found
  }

  const visit = (node: Node, inTest: boolean) => {
    if (node.type === "CallExpression") {
      const names = chain(node["callee"] as Node)
      const args = node["arguments"] as Array<Node>
      const fn = args.findLast(isFunction)
      const title = args[0] === undefined ? undefined : titleOf(args[0], code)
      if (names !== undefined && names.includes("describe") && fn !== undefined && title !== undefined) {
        describe.push(title.title)
        for (const child of children(node)) visit(child, inTest)
        describe.pop()
        return
      }
      if (
        names !== undefined && isBase(names[0]!) && names.slice(1).every((name) => modifiers.has(name)) &&
        fn !== undefined && title !== undefined && !inTest
      ) {
        const modifier = names[1]
        const fullTitle = [...describe, title.title].join(" ")
        let key: string
        let shown = title.title
        if (ids === "prefixed") {
          const id = prefixed.exec(title.dynamic ? title.title.replace(/^['"`]/, "") : title.title)
          key = id === null ? `${file} > ${fullTitle}` : id[1]!
          if (id !== null) shown = id[2]!
        } else {
          key = puppeteerId(file, fullTitle)
        }
        const leadingCalls = leading(fn)
        const upstream = ids === "mocha"
          ? expectations.filter((expectation) => matches(expectation.testIdPattern, key)).map((expectation) => ({
            platforms: expectation.platforms,
            parameters: expectation.parameters,
            expectations: expectation.expectations,
            ...(expectation.comment === undefined ? {} : { comment: expectation.comment })
          }))
          : []
        tests.push({
          key,
          title: shown,
          file,
          line: node.loc.start.line,
          describe: [...describe],
          ...(modifier === undefined ? {} : { modifier }),
          ...(title.dynamic ? { dynamic: true as const } : {}),
          ...(leadingCalls.length === 0 ? {} : { annotations: leadingCalls }),
          ...(upstream.length === 0 ? {} : { upstream }),
          hash: sha(code.slice(node.start, node.end))
        })
        for (const child of children(node)) visit(child, true)
        return
      }
      if (
        !inTest && names !== undefined && names.length >= 2 && isBase(names[0]!) &&
        (names[1] === "use" || (modifiers.has(names[1]!) && title === undefined))
      ) {
        annotations.push((describe.length === 0 ? "" : `${describe.join(" > ")}: `) + code.slice(node.start, node.end))
      }
    }
    for (const child of children(node)) visit(child, inTest)
  }
  visit(program, false)
  return { tests, annotations }
}

/** Every test in a checkout of `name` at its pinned revision. */
export const indexCheckout = (name: string, checkout: string): Index => {
  const pinned = source(name)
  if (pinned.status !== "indexed" || pinned.include === undefined || pinned.ids === undefined) {
    throw new Error(`${name} isn't an indexed source in sources/sources.json`)
  }
  const head = execFileSync("git", ["-C", checkout, "rev-parse", "HEAD"], { encoding: "utf8" }).trim()
  if (head !== pinned.revision) throw new Error(`${checkout} is at ${head}; ${name} is pinned to ${pinned.revision}`)
  const expectations = pinned.expectations === undefined ? [] : JSON.parse(
    fs.readFileSync(path.join(checkout, pinned.expectations), "utf8")
  ) as Array<UpstreamExpectation & { readonly testIdPattern: string }>
  const files = [...new Set(pinned.include.flatMap((pattern) => fs.globSync(pattern, { cwd: checkout })))].sort()
  const tests: Array<UpstreamTest> = []
  const annotations: Record<string, ReadonlyArray<string>> = {}
  for (const file of files) {
    const indexed = indexFile(pinned.ids, file, fs.readFileSync(path.join(checkout, file), "utf8"), expectations)
    tests.push(...indexed.tests)
    if (indexed.annotations.length > 0) annotations[file] = indexed.annotations
  }
  const seen = new Map<string, UpstreamTest>()
  for (const test of tests) {
    const earlier = seen.get(test.key)
    if (earlier !== undefined) {
      throw new Error(`${name}: ${test.key} is in ${earlier.file}:${earlier.line} and ${test.file}:${test.line}`)
    }
    seen.set(test.key, test)
  }
  return { source: name, revision: head, files: annotations, tests }
}
