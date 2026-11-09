import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import * as fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { test } from "node:test"

const root = path.resolve(import.meta.dirname, "../..")
const run = (cwd, command, args) => execFileSync(command, args, { cwd, encoding: "utf8", stdio: "pipe" })
const json = (file) => JSON.parse(fs.readFileSync(file, "utf8"))
const write = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n")
const temporary = (body) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "strider-generated-"))
  try {
    return body(dir)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

test("a clean checkout generates indexes before packing both public packages", () =>
  temporary((dir) => {
    for (const name of ["browser", "vitest"]) {
      const pkg = json(`${root}/packages/${name}/package.json`)
      assert.match(pkg.scripts.prepack, /index/)
      assert.match(pkg.scripts.build, /index/)
      const target = `${dir}/packages/${name}`
      fs.mkdirSync(`${target}/src`, { recursive: true })
      write(`${target}/package.json`, {
        name: `@fixture/${name}`,
        version: "1.0.0",
        type: "module",
        files: ["src", "INDEX.md"],
        exports: { ".": "./src/index.ts" },
        scripts: { prepack: pkg.scripts.prepack }
      })
      fs.writeFileSync(`${target}/src/index.ts`, "export * as Example from \"./Example.ts\"\n")
      fs.writeFileSync(`${target}/src/Example.ts`, "export interface Example { readonly first: string }\n")
    }
    fs.cpSync(`${root}/packages/tools/docs`, `${dir}/packages/tools/docs`, { recursive: true })
    fs.symlinkSync(`${root}/node_modules`, `${dir}/node_modules`, "dir")
    for (const name of ["browser", "vitest"]) {
      const target = `${dir}/packages/${name}`
      assert.equal(fs.existsSync(`${target}/INDEX.md`), false)
      run(target, "pnpm", ["pack", "--pack-destination", dir])
      const archive = fs.readdirSync(dir).find((file) => file.endsWith(`${name}-1.0.0.tgz`))
      assert.ok(archive)
      const index = run(dir, "tar", ["-xOf", `${dir}/${archive}`, "package/INDEX.md"])
      assert.match(index, /readonly first: string/)
    }
  }))

test("independent public members and matrix rows validate and merge without generated conflicts", () =>
  temporary((dir) => {
    const copy = (file) => {
      fs.mkdirSync(path.dirname(`${dir}/${file}`), { recursive: true })
      fs.cpSync(`${root}/${file}`, `${dir}/${file}`, { recursive: true })
    }
    for (
      const file of [
        "scripts",
        "packages/tools/docs",
        "packages/tools/utils",
        "packages/browser/src",
        "packages/browser/package.json",
        "docs/decisions.md",
        ".gitignore"
      ]
    ) copy(file)
    fs.symlinkSync(`${root}/node_modules`, `${dir}/node_modules`, "dir")
    const metadata = json(`${dir}/scripts/playwright-matrix/metadata.json`)
    for (const file of metadata.evidence) if (!file.startsWith("node_modules/")) copy(file)
    const node = (args) => run(dir, process.execPath, args)
    node([
      "--input-type=module",
      "-e",
      "import { capabilities } from \"./packages/tools/docs/src/capabilities.mjs\"; await capabilities(process.cwd(), \".data/api-reference\")"
    ])
    run(dir, "git", ["init", "-b", "main"])
    run(dir, "git", ["config", "user.email", "test@example.com"])
    run(dir, "git", ["config", "user.name", "Test"])
    run(dir, "git", ["add", "."])
    run(dir, "git", ["commit", "-m", "Initial fixture"])
    const validate = () => {
      node(["scripts/playwright-matrix.mjs"])
      node(["packages/tools/docs/src/bin.mjs", "index", "--package", "browser"])
      assert.equal(run(dir, "git", ["status", "--porcelain"]), "")
    }
    for (
      const [branch, module, id] of [["first", "Page", "method-page-pdf"], [
        "second",
        "Locator",
        "method-locator-innertext"
      ]]
    ) {
      run(dir, "git", ["checkout", "-b", branch, "main"])
      fs.appendFileSync(
        `${dir}/packages/browser/src/${module}.ts`,
        `\nexport interface Independent${branch} { readonly ${branch}: string }\n`
      )
      const file = `${dir}/scripts/playwright-matrix/rows/${id}.json`
      const row = json(file)
      row.notes += ` Independent ${branch} evidence.`
      row.api.push({
        module,
        symbol: `Independent${branch}.${branch}`,
        url: `/docs/api/browser/${module}#Independent${branch}`
      })
      write(file, row)
      run(dir, "git", ["add", "."])
      run(dir, "git", ["commit", "-m", `Add ${branch} public member`])
      validate()
    }
    run(dir, "git", ["checkout", "main"])
    run(dir, "git", ["merge", "--no-edit", "first"])
    run(dir, "git", ["merge", "--no-edit", "second"])
    validate()
    const output = json(`${dir}/.data/playwright-matrix/matrix.json`)
    for (const name of ["first", "second"]) {
      assert.ok(output.rows.some((row) => row.api.some((api) => api.symbol === `Independent${name}.${name}`)))
      assert.match(fs.readFileSync(`${dir}/packages/browser/INDEX.md`, "utf8"), new RegExp(`readonly ${name}: string`))
    }
    // A stale derived field cannot silently become curated evidence.
    const file = `${dir}/scripts/playwright-matrix/rows/method-page-pdf.json`
    const row = json(file)
    write(file, { ...row, browsers: {} })
    assert.throws(() => node(["scripts/playwright-matrix.mjs"]), /derived|browsers/)
    write(file, {
      ...row,
      api: [{ module: "Page", symbol: "doesNotExist", url: "/docs/api/browser/Page#doesNotExist" }]
    })
    assert.throws(() => node(["scripts/playwright-matrix.mjs"]), /not a public declaration/)
    // Tracked code generation must still detect drift.
    fs.appendFileSync(`${dir}/packages/browser/src/index.ts`, "\n// stale\n")
    assert.throws(
      () => run(`${dir}/packages/browser`, process.execPath, ["../tools/utils/src/bin.mjs", "barrel", "--check"]),
      /stale/
    )
  }))
