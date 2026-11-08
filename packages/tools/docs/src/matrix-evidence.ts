// Evidence checks shared by the CLI and clean-checkout regression tests. No generated website is read here.
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import ts from "typescript"

export interface Api {
  readonly module: string
  /** An exported name, or the fully qualified declaring type and member. */
  readonly symbol: string
  readonly url: string
}
export interface Decision {
  readonly file: string
  readonly anchor: string
  readonly quote: string
  readonly revision?: string | undefined
}
const cache = new Map<string, Map<string, string>>()
export const sourceSymbols = (module: string): Map<string, string> => {
  const cached = cache.get(module)
  if (cached) return cached
  const file = `packages/browser/src/${module}.ts`
  const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true)
  const symbols = new Map<string, string>()
  for (const statement of source.statements) {
    if (
      !ts.canHaveModifiers(statement) ||
      !ts.getModifiers(statement)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
    ) continue
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) symbols.set(declaration.name.text, declaration.name.text)
      }
    } else if ("name" in statement && statement.name && ts.isIdentifier(statement.name as ts.Node)) {
      const name = (statement.name as ts.Identifier).text
      symbols.set(name, name)
      if (ts.isInterfaceDeclaration(statement) || ts.isClassDeclaration(statement)) {
        // The reference lists members separately if any own member has documentation.
        const listed = statement.members.some((member) => member.getFullText(source).includes("/**"))
        for (const member of statement.members) {
          if (member.name && (ts.isIdentifier(member.name) || ts.isStringLiteral(member.name))) {
            const symbol = `${name}.${member.name.text}`
            symbols.set(symbol, listed ? symbol : name)
          }
        }
      }
    }
  }
  cache.set(module, symbols)
  return symbols
}
export const assertApiLink = (api: Api): void => {
  const anchor = sourceSymbols(api.module).get(api.symbol)
  assert.ok(anchor, `API symbol ${api.module}.${api.symbol} is not a public declaration`)
  assert.equal(
    api.url,
    `/docs/api/browser/${api.module}#${anchor}`,
    `API symbol/anchor mismatch: ${api.module}.${api.symbol}`
  )
}
const normalized = (text: string) => text.replace(/\s+/g, " ").trim()
export const assertDecision = (decision: Decision): void => {
  assert.equal(decision.file, "docs/decisions.md")
  assert.ok(
    typeof decision.quote === "string" && decision.quote.length >= 40,
    "Decision needs a specific verified quotation"
  )
  const source = readFileSync(decision.file, "utf8")
  const marker = `<a id="${decision.anchor}"></a>`
  let start = source.indexOf(marker)
  if (start >= 0) start += marker.length
  else {
    assert.ok(
      !["principles", "the-public-api-l2", "the-browser-model-l1"].includes(decision.anchor),
      "A section heading is not a specific decision"
    )
    const headings = [...source.matchAll(/^## (.+)$/gm)]
    const heading = headings.find((match) =>
      match[1]!.toLowerCase().replace(/[^\w -]/g, "").replaceAll(" ", "-") === decision.anchor
    )
    assert.ok(heading, `Missing decision anchor ${decision.anchor}`)
    start = heading.index! + heading[0].length
  }
  const rest = source.slice(start).trimStart()
  // Keep the quotation inside this decision, never another paragraph's decision in the same chapter.
  const next = rest.slice(rest.indexOf("\n") + 1).search(/^(?:<a id=|#{2,3} |\*\*)/m)
  const block = next < 0 ? rest : rest.slice(0, rest.indexOf("\n") + 1 + next)
  assert.ok(normalized(block).includes(normalized(decision.quote)), `Quotation is not in decision ${decision.anchor}`)
  assert.match(decision.revision ?? "", /^[a-f0-9]{40}$/, "Decision link needs a committed source revision")
}
export interface GapRow {
  readonly id: string
  readonly status: string
  readonly upstream: ReadonlyArray<string>
  readonly option?: string | undefined
  readonly value?: string | undefined
  readonly gaps?: ReadonlyArray<string> | undefined
  readonly parent?: string | undefined
  readonly valueCoverage?:
    | ReadonlyArray<{ readonly value: string; readonly status: string; readonly gap?: string | undefined }>
    | undefined
}
export const assertValueGaps = (rows: ReadonlyArray<GapRow>): void => {
  const byId = new Map(rows.map((row) => [row.id, row]))
  for (const row of rows) {
    for (const gapId of row.gaps ?? []) {
      const gap = byId.get(gapId)
      assert.ok(
        gap && gap.status === "missing" && gap.value !== undefined && gap.parent === row.id,
        `${row.id}: invalid linked value gap ${gapId}`
      )
      assert.deepEqual(gap.upstream, row.upstream, `${gapId}: wrong upstream owner`)
      assert.equal(gap.option, row.option, `${gapId}: wrong option owner`)
    }
    for (const entry of row.valueCoverage ?? []) {
      if (entry.status !== "missing" || (row.status === "missing" && !entry.gap)) continue
      assert.ok(
        entry.gap && row.gaps?.includes(entry.gap),
        `${row.id}: missing value ${entry.value} must have a discoverable gap row`
      )
      assert.equal(byId.get(entry.gap)?.value, entry.value, `${row.id}: wrong value in gap row`)
    }
    if (row.value !== undefined) {
      assert.ok(row.parent && byId.get(row.parent)?.gaps?.includes(row.id), `${row.id}: orphan value gap`)
    }
  }
}
