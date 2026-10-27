#!/usr/bin/env node
/**
 * strider-codegen: builds each backend's protocol model and emits the generated modules.
 *
 *   strider-codegen model <backend> [--check]      write protocols/<backend>/model.json
 *   strider-codegen generate <backend> [--check]   the model, then packages/browser/src/<backend>/*.ts and
 *                                                  protocols/<backend>/coverage.json
 *   strider-codegen audit <backend> [--check]      which corrections the vendored spec has absorbed; run on
 *                                                  each roll (`--check` fails if any has)
 *   strider-codegen keyboards [--check]            packages/browser/src/internal/keyboardLayouts.ts, from
 *                                                  CLDR's keyboard data in keyboards/source
 *   strider-codegen trace-contract <checkout>      whether a Playwright checkout's snapshot files are the ones the
 *                                                  trace capture's contract was read from (trace-contract.json;
 *                                                  research/playwright-trace-snapshots.md); run on each roll
 *
 * Run from the repository root. `--check` regenerates in memory and fails if anything differs from what is
 * committed, so CI never regenerates.
 */
import * as NodeRuntime from "@effect/platform-node/NodeRuntime"
import * as NodeServices from "@effect/platform-node/NodeServices"
import { Argument, Command, Flag } from "effect/cli"
import * as Console from "effect/Console"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Path from "effect/Path"
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { CodegenError, fromThrown } from "./CodegenError.ts"
import { emit } from "./Emit.ts"
import * as Keyboards from "./Keyboards.ts"
import { auditCorrections, Backend, build, outputs, protocolDirectory, serialize } from "./Pipeline.ts"

const sources: Record<Backend, string> = {
  cdp: "the Chrome DevTools Protocol, devtools-protocol 0.0.1696802 (Chrome 155)",
  bidi: "WebDriver BiDi's CDDL, w3c/webdriver-bidi f922e6a (2026-10-08), and the Permissions spec's module",
  "webkit-stock": "the WebKit inspector protocol as WebKit ships it, WebKitGTK 2.54.1",
  "webkit-automation": "WebKit's Automation protocol, WebKitGTK 2.54.1"
}

const writeOrCheck = Effect.fnUntraced(function*(
  file: string,
  content: string,
  check: boolean,
  fix: string = "pnpm codegen:protocol"
) {
  const fs = yield* FileSystem.FileSystem
  const current = (yield* fs.exists(file)) ? yield* fs.readFileString(file) : undefined
  if (current === content) return false
  if (check) return yield* new CodegenError({ message: `${file} is out of date; run ${fix}` })
  yield* fs.writeFileString(file, content)
  return true
})

/** Formats generated source with the repository's dprint configuration, as if the file were at `file`. */
const format = (root: string, file: string, source: string) =>
  Effect.try({
    try: () =>
      execFileSync(`${root}/node_modules/.bin/dprint`, ["fmt", "--stdin", file], {
        cwd: root,
        input: source,
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024
      }),
    catch: (cause) => new CodegenError({ message: `dprint couldn't format ${file}`, cause })
  })

const backend = Argument.Literals("backend", Backend.literals)
const check = Flag.Boolean("check").pipe(Flag.withDefault(false))

const model = Command.make("model", { backend, check }, ({ backend, check }) =>
  Effect.gen(function*() {
    const path = yield* Path.Path
    const root = process.cwd()
    const built = yield* build(root, backend)
    yield* writeOrCheck(path.join(yield* protocolDirectory(root, backend), "model.json"), serialize(built), check)
    yield* Console.log(`${backend} ${built.revision}: ${Object.keys(built.shapes).length} shapes`)
  }))

const generate = Command.make("generate", { backend, check }, ({ backend, check }) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const root = process.cwd()
    const directory = yield* protocolDirectory(root, backend)
    const built = yield* build(root, backend)
    yield* writeOrCheck(path.join(directory, "model.json"), serialize(built), check)

    const { coverage, modules } = yield* Effect.try({
      try: () => emit(built, { description: sources[backend], output: outputs[backend], directory: backend }),
      catch: fromThrown
    })
    const output = path.join(root, "packages/browser/src", outputs[backend])
    yield* fs.makeDirectory(output, { recursive: true })
    let written = 0
    for (const [name, source] of modules) {
      const file = path.join(output, name)
      const formatted = yield* format(root, path.relative(root, file), source)
      if (yield* writeOrCheck(file, formatted, check)) written++
    }
    const stale = (yield* fs.readDirectory(output)).filter((name) => name !== "index.ts" && !modules.has(name))
    for (const name of stale) {
      if (check) return yield* new CodegenError({ message: `${path.join(output, name)} is no longer generated` })
      yield* fs.remove(path.join(output, name))
    }
    yield* writeOrCheck(path.join(directory, "coverage.json"), JSON.stringify(coverage, null, 2) + "\n", check)

    const { counts } = coverage
    yield* Console.log(
      `${backend} ${built.revision}: ${counts.domains} domains, ${counts.types} types, ${counts.commands} commands, ` +
        `${counts.events} events; ${counts.excluded} excluded, ${counts.approximated} approximated` +
        (check ? "; up to date" : `; ${written} modules written, ${stale.length} removed`)
    )
  }))

const auditCommand = Command.make("audit", { backend, check }, ({ backend, check }) =>
  Effect.gen(function*() {
    const entries = yield* auditCorrections(process.cwd(), backend)
    for (const entry of entries) yield* Console.log(`${backend} ${entry.file}: ${entry.verdict}`)
    if (entries.length === 0) yield* Console.log(`${backend}: no corrections`)
    const absorbed = entries.filter((entry) => entry.verdict === "absorbed")
    if (check && absorbed.length > 0) {
      return yield* new CodegenError({
        message: `The spec absorbed ${absorbed.map((entry) => entry.file).join(", ")}; delete them and regenerate`
      })
    }
  }))

const keyboards = Command.make("keyboards", { check }, ({ check }) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const root = process.cwd()
    const directory = path.join(root, "packages/tools/codegen/keyboards/source")
    const layouts: Array<readonly [string, string, Keyboards.Layout]> = []
    for (const [name, file] of Keyboards.sources) {
      layouts.push([name, file, Keyboards.parse(yield* fs.readFileString(path.join(directory, file)))])
    }
    const file = path.join(root, "packages/browser/src/internal/keyboardLayouts.ts")
    const formatted = yield* format(root, path.relative(root, file), Keyboards.emit(layouts))
    const written = yield* writeOrCheck(file, formatted, check, "pnpm codegen:keyboards")
    yield* Console.log(
      `keyboards: ${
        layouts.map(([name, , layout]) => `${name} ${layout.keys.size}+${layout.composed.size}`).join(", ")
      }` +
        (check ? "; up to date" : written ? "; written" : "; unchanged")
    )
  }))

const traceContract = Command.make(
  "trace-contract",
  { checkout: Argument.String("checkout") },
  ({ checkout }) =>
    Effect.gen(function*() {
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const contract = JSON.parse(
        yield* fs.readFileString(path.join(process.cwd(), "packages/tools/codegen/trace-contract.json"))
      ) as { readonly release: string; readonly files: Readonly<Record<string, string>> }
      const changed: Array<string> = []
      for (const [file, expected] of Object.entries(contract.files)) {
        const bytes = yield* fs.readFile(path.join(checkout, file))
        const actual = createHash("sha256").update(bytes).digest("hex")
        if (actual !== expected) changed.push(file)
        yield* Console.log(`${file}: ${actual === expected ? "as read" : "changed"}`)
      }
      if (changed.length > 0) {
        return yield* new CodegenError({
          message: `Changed since ${contract.release}: reread them for the contract, then update trace-contract.json`
        })
      }
    })
)

const cli = Command.make("strider-codegen").pipe(
  Command.withSubcommands([model, generate, auditCommand, keyboards, traceContract])
)

Command.run(cli, { version: "0.0.0" }).pipe(Effect.provide(NodeServices.layer), NodeRuntime.runMain)
