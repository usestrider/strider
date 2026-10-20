// Writes INDEX.md: every exported declaration and member of the package, one line each, by entry point, module
// and @category, so the whole API reads on one page. Generated from the sources, so it can't drift. The
// browsable reference comes from the same sources (`pnpm api-reference`). Run with `pnpm index`.
import * as fs from "node:fs"
import * as path from "node:path"
import ts from "typescript"

export const index = (root) => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"))

  const categoryOrder = [
    "services",
    "tags",
    "accessors",
    "layers",
    "models",
    "schemas",
    "constructors",
    "constants",
    "combinators",
    "subscriptions",
    "getters",
    "handlers",
    "matchers",
    "converting",
    "references",
    "configuration",
    "guards",
    "errors",
    "reasons",
    "utility types"
  ]
  const squash = (s) =>
    s.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\s+/g, " ").replace(/\( /g, "(")
      .replace(/ \)/g, ")").replace(/\[ /g, "[").replace(/ \]/g, "]").replace(/,\)/g, ")").replace(/, \}/g, " }").trim()
  const cut = (s, n) => (s.length > n ? s.slice(0, n - 1) + "…" : s)
  const tagOf = (node, name) => {
    const tag = ts.getJSDocTags(node).find((t) => t.tagName.text === name)
    return tag === undefined ? undefined : ts.getTextOfJSDocComment(tag.comment)?.trim()
  }
  const moduleSummary = (sf) => {
    const block = sf.text.match(/^\/\*\*([\s\S]*?)\*\//)?.[1] ?? ""
    const lines = block.split("\n").map((l) => l.replace(/^\s*\* ?/, "").trim())
    const para = []
    for (const line of lines) {
      if (line === "" && para.length > 0) break
      if (line !== "") para.push(line)
    }
    return para.join(" ")
  }
  // Schema.Class<Self>("id")({ a, b }) and friends: the kind of schema, its tag, and its field names
  const schemaClass = (sf, heritage) => {
    const call = heritage.types[0].expression
    if (!ts.isCallExpression(call) || !ts.isCallExpression(call.expression)) {
      return cut(squash(heritage.getText(sf)), 160)
    }
    const base = squash(call.expression.expression.getText(sf)).replace(/<.*$/, "")
    const args = call.arguments
    const fields = args.find((a) => ts.isObjectLiteralExpression(a))
    const tag = args.find((a) => ts.isStringLiteral(a))
    const names = fields
      ? fields.properties.map((p) => p.name?.getText(sf)).filter((n) => n !== undefined && n !== "_tag")
      : []
    return `${base}${tag ? ` "${tag.text}"` : ""} { ${names.join(", ")} }`
  }
  const memberLines = (sf, members) => members.map((m) => cut(squash(m.getText(sf)).replace(/;$/, ""), 160))

  const declarations = (file) => {
    const sf = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true)
    const out = []
    for (const st of sf.statements) {
      const exported = st.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
      const meta = { category: tagOf(st, "category") ?? "other", stability: tagOf(st, "stability") ?? "stable" }
      if (ts.isExportDeclaration(st) && st.exportClause && ts.isNamedExports(st.exportClause)) {
        for (const spec of st.exportClause.elements) {
          const local = sf.statements.flatMap((s) => (ts.isVariableStatement(s) ? s.declarationList.declarations : []))
            .find((d) => d.name.getText(sf) === (spec.propertyName ?? spec.name).getText(sf))
          out.push({
            ...meta,
            category: tagOf(spec, "category") ?? meta.category,
            stability: tagOf(spec, "stability") ?? meta.stability,
            line: `const ${spec.name.getText(sf)}: ${local?.type ? cut(squash(local.type.getText(sf)), 160) : "…"}`,
            members: []
          })
        }
        continue
      }
      if (!exported) continue
      if (ts.isInterfaceDeclaration(st)) {
        const params = st.typeParameters ? `<${st.typeParameters.map((p) => squash(p.getText(sf))).join(", ")}>` : ""
        const heritage = st.heritageClauses ? " " + squash(st.heritageClauses.map((h) => h.getText(sf)).join(" ")) : ""
        out.push({
          ...meta,
          line: `interface ${st.name.text}${params}${cut(heritage, 120)}`,
          members: memberLines(sf, st.members)
        })
      } else if (ts.isTypeAliasDeclaration(st)) {
        const params = st.typeParameters ? `<${st.typeParameters.map((p) => squash(p.getText(sf))).join(", ")}>` : ""
        out.push({
          ...meta,
          line: `type ${st.name.text}${params} = ${cut(squash(st.type.getText(sf)), 200)}`,
          members: []
        })
      } else if (ts.isClassDeclaration(st)) {
        const own = st.members.filter((m) =>
          m.name && !ts.isComputedPropertyName(m.name) && m.name.getText(sf) !== "message"
        )
        out.push({
          ...meta,
          line: `class ${st.name.text}: ${schemaClass(sf, st.heritageClauses[0])}`,
          members: own.filter((m) => !ts.isPropertyDeclaration(m)).map((m) =>
            cut(squash(m.getText(sf).replace(/\{[\s\S]*$/, "")), 160)
          )
        })
      } else if (ts.isVariableStatement(st)) {
        for (const d of st.declarationList.declarations) {
          const name = d.name.getText(sf)
          if (d.type && ts.isTypeLiteralNode(d.type)) {
            out.push({ ...meta, line: `const ${name}`, members: memberLines(sf, d.type.members) })
          } else if (d.type) {
            out.push({ ...meta, line: `const ${name}: ${cut(squash(d.type.getText(sf)), 200)}`, members: [] })
          } else if (d.initializer && ts.isArrowFunction(d.initializer) && d.initializer.type) {
            const fn = d.initializer
            const params = fn.parameters.map((p) => squash(p.getText(sf))).join(", ")
            const generics = fn.typeParameters
              ? `<${fn.typeParameters.map((p) => squash(p.getText(sf))).join(", ")}>`
              : ""
            out.push({
              ...meta,
              line: `const ${name}: ${generics}(${params}) => ${squash(fn.type.getText(sf))}`,
              members: []
            })
          } else if (d.initializer) {
            out.push({ ...meta, line: `const ${name} = ${cut(squash(d.initializer.getText(sf)), 200)}`, members: [] })
          }
        }
      }
    }
    return { summary: moduleSummary(sf), declarations: out }
  }

  const entryPoints = Object.entries(pkg.exports)
    .filter(([, target]) => typeof target === "string" && target.endsWith("/index.ts"))
    .sort(([a], [b]) => (a === "." ? -1 : b === "." ? 1 : a.localeCompare(b)))

  let out = `# ${pkg.name} API index\n\n` +
    "Generated from `src/` by `pnpm index`; don't edit by hand. One line per declaration and member, by entry point, " +
    "module and `@category`. Experimental APIs are marked. The browsable reference is generated from the same sources " +
    "by `pnpm api-reference`.\n"
  let total = 0
  let totalMembers = 0
  for (const [key, target] of entryPoints) {
    const entry = key === "." ? pkg.name : `${pkg.name}/${key.slice(2)}`
    const barrel = path.join(root, target)
    const modules = [...fs.readFileSync(barrel, "utf8").matchAll(/export \* as (\w+) from "\.\/(\w+)\.ts"/g)].map((m) =>
      m[1]
    )
    out += `\n## \`${entry}\`\n`
    if (fs.readFileSync(path.join(path.dirname(barrel), `${modules[0]}.ts`), "utf8").includes(" * Generated from ")) {
      // generated protocol modules are listed in the API reference, not here
      out += `\n${modules.length} generated modules: ${
        modules.join(", ")
      }. Their declarations are in the API reference.\n`
      continue
    }
    for (const name of modules) {
      const { summary, declarations: decls } = declarations(path.join(path.dirname(barrel), `${name}.ts`))
      out += `\n### ${name}\n\n${summary}\n`
      const categories = [...new Set(decls.map((d) => d.category))]
        .sort((a, b) => (categoryOrder.indexOf(a) + 1 || 99) - (categoryOrder.indexOf(b) + 1 || 99))
      for (const category of categories) {
        out += `\n*${category}*\n\n`
        for (const d of decls.filter((d) => d.category === category)) {
          out += `- \`${d.line}\`${d.stability === "experimental" ? " (experimental)" : ""}\n`
          for (const m of d.members) out += `  - \`${m}\`\n`
          total++
          totalMembers += d.members.length
        }
      }
    }
  }
  fs.writeFileSync(path.join(root, "INDEX.md"), out)
  process.stdout.write(`Wrote INDEX.md: ${total} declarations, ${totalMembers} members\n`)
}
