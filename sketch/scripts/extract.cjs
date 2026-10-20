const ts = require(process.cwd() + "/node_modules/typescript")
const fs = require("fs"), path = require("path")
const groups = JSON.parse(process.argv[2])
const squash = s => s.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\s+/g, " ").replace(/\( /g, "(").replace(/ \)/g, ")").trim()
const cut = (s, n) => s.length > n ? s.slice(0, n - 1) + "…" : s
function isNew(sf, node) {
  // a marker counts if it is on the node's first line, in a trailing comment on its last line, or on a comment line above it;
  // not in the previous member's trailing comment, which TypeScript files under this node's leading trivia
  const text = sf.text, start = node.getStart(sf), end = node.getEnd()
  const lineEnd = text.indexOf("\n", end)
  const tail = text.slice(end, lineEnd === -1 ? undefined : lineEnd)
  const lead = text.slice(node.getFullStart(), start)
  const nl = lead.indexOf("\n")
  const above = nl === -1 ? "" : lead.slice(nl)
  const firstLine = text.slice(start, end).split("\n")[0]
  return [tail, above, firstLine].some(s => /new in the sketch/i.test(s))
}
function members(sf, typeNode) {
  const out = []
  const visit = t => {
    if (!t) return
    if (ts.isTypeLiteralNode(t)) for (const m of t.members) out.push({ t: cut(squash(m.getText(sf)).replace(/;$/, ""), 150), n: isNew(sf, m) })
    else if (ts.isIntersectionTypeNode(t)) t.types.forEach(visit)
    else out.push({ t: cut("…" + squash(t.getText(sf)), 150), n: false })
  }
  visit(typeNode)
  return out
}
const result = groups.map(([gname, mods]) => ({ name: gname, modules: mods.map(([mname, files]) => {
  const decls = []
  for (const f of files) {
    const sf = ts.createSourceFile(f, fs.readFileSync(f, "utf8"), ts.ScriptTarget.Latest, true)
    // a file whose header says "new in the sketch" is new throughout; a "// ── X (new in the sketch) ──" section header
    // marks every declaration until the next section header
    const first = sf.statements[0]
    const fileNew = first ? /new in the sketch/i.test(sf.text.slice(0, first.getStart(sf))) : false
    let sectionNew = false
    for (const st of sf.statements) {
      const leading = sf.text.slice(st.getFullStart(), st.getStart(sf))
      const header = leading.split("\n").filter(l => /\/\/ ──/.test(l)).pop()
      if (header !== undefined) sectionNew = /new in the sketch/i.test(header)
      const exported = st.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)
      if (!exported) continue
      const declNew = fileNew || sectionNew || isNew(sf, st)
      if (ts.isInterfaceDeclaration(st)) {
        const heritage = st.heritageClauses ? " " + squash(st.heritageClauses.map(h => h.getText(sf)).join(" ")) : ""
        decls.push({ k: "interface", name: st.name.text + squash((st.typeParameters ? "<" + st.typeParameters.map(p => p.getText(sf)).join(", ") + ">" : "")), extra: cut(heritage, 120),
          m: st.members.map(m => ({ t: cut(squash(m.getText(sf)).replace(/;$/, ""), 150), n: !declNew && isNew(sf, m) })), n: declNew })
      } else if (ts.isTypeAliasDeclaration(st)) {
        decls.push({ k: "type", name: st.name.text + (st.typeParameters ? "<" + st.typeParameters.map(p => squash(p.getText(sf))).join(", ") + ">" : ""), extra: cut(" = " + squash(st.type.getText(sf)), 220), m: [], n: declNew })
      } else if (ts.isVariableStatement(st)) {
        for (const d of st.declarationList.declarations) decls.push({ k: "const", name: d.name.getText(sf), extra: "", m: members(sf, d.type).map(x => declNew ? { ...x, n: false } : x), n: declNew })
      } else if (ts.isClassDeclaration(st)) {
        decls.push({ k: "class", name: st.name.text, extra: cut(" " + squash(st.heritageClauses.map(h => h.getText(sf)).join(" ")), 220), m: [], n: false })
      }
    }
  }
  return { name: mname, files, decls }
}) }))
process.stdout.write(JSON.stringify(result))
