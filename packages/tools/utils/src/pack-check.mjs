// Checks what the published packages would be: each package `pnpm pack` writes, in a
// temporary directory, with nothing of the workspace's. Run from the repository root after `pnpm build`.
//
// - every `exports` target and `bin` of the packed `package.json` exists, a `.d.ts` beside each `.js`;
// - the tarball holds only what `files` names: no tests, fixtures or `.data`, and no output of an earlier build
//   whose source is gone;
// - it packs a `LICENSE`, the repository's, which `pnpm pack` copies into a package that has none, and declares MIT;
// - no `dependencies`: only peers;
// - a project with only the packages and their peers installed imports every subpath under Node, type-checks an
//   import of each with `moduleResolution: "nodenext"`, and runs `strider --help`, which, without its optional
//   peer `@effect/platform-node`, says to install it.
// - `packages/cli`, the command to install globally, packs its bin and `LICENSE`, and is the one package with
//   `dependencies`, the library and what the command runs on, so it runs under pnpm's isolated layout, as a global
//   install lays it out, where the library's optional peer would otherwise never be linked. It also runs with Bun
//   and no Node on the path.
import { execFileSync } from "node:child_process"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { packages } from "./clean.mjs"

const run = (command, args, options = {}) =>
  execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...options })

const walk = (directory, base = directory) =>
  fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name)
    return entry.isDirectory() ? walk(full, base) : [path.relative(base, full)]
  })

/** What a pattern key's `*` matches in a subpath, or `undefined` where it doesn't match. */
const matchKey = (key, subpath) => {
  const star = key.indexOf("*")
  if (star === -1) return key === subpath ? "" : undefined
  const prefix = key.slice(0, star)
  const suffix = key.slice(star + 1)
  return subpath.length >= key.length && subpath.startsWith(prefix) && subpath.endsWith(suffix)
    ? subpath.slice(prefix.length, subpath.length - suffix.length)
    : undefined
}

/** The target Node resolves a subpath to: an exact key, or else the pattern with the longest prefix, then key. */
const resolveExport = (exports, subpath) => {
  if (Object.hasOwn(exports, subpath)) return exports[subpath]
  const [best] = Object.keys(exports)
    .filter((key) => key.includes("*") && matchKey(key, subpath) !== undefined)
    .sort((a, b) => b.indexOf("*") - a.indexOf("*") || b.length - a.length)
  if (best === undefined) return undefined
  const target = exports[best]
  return typeof target === "string" ? target.replace("*", matchKey(best, subpath)) : null
}

/**
 * The subpaths a package's `exports` offers: its exact keys, and each packed file a pattern's target matches whose
 * subpath Node resolves to it, so that a `null` key leaves it out.
 */
const subpaths = (pkg, files) => {
  const exports = pkg.exports ?? {}
  const found = new Map()
  for (const [key, target] of Object.entries(exports)) {
    if (typeof target !== "string" || key === "./package.json") continue
    if (!key.includes("*")) {
      found.set(key, target)
      continue
    }
    for (const file of files) {
      const matched = matchKey(target, `./${file}`)
      if (matched === undefined) continue
      const subpath = key.replace("*", matched)
      if (resolveExport(exports, subpath) === `./${file}`) found.set(subpath, `./${file}`)
    }
  }
  return [...found].map(([key, target]) => ({ key, target }))
}

const failures = []
const fail = (message) => failures.push(message)

export const packCheck = (root) => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "strider-pack-check-"))
  try {
    const packed = []
    for (const directory of packages) {
      const name = JSON.parse(fs.readFileSync(path.join(root, directory, "package.json"), "utf8")).name
      const out = path.join(work, "tarballs")
      fs.mkdirSync(out, { recursive: true })
      const before = new Set(fs.readdirSync(out))
      run("pnpm", ["pack", "--pack-destination", out], { cwd: path.join(root, directory) })
      const tarball = fs.readdirSync(out).find((file) => !before.has(file))
      const unpacked = path.join(work, "unpacked", path.basename(directory))
      fs.mkdirSync(unpacked, { recursive: true })
      run("tar", ["-xzf", path.join(out, tarball), "-C", unpacked])
      const content = path.join(unpacked, "package")
      const pkg = JSON.parse(fs.readFileSync(path.join(content, "package.json"), "utf8"))
      const files = walk(content)

      // What it holds
      const offered = subpaths(pkg, files)
      for (const { key, target } of offered) {
        if (!files.includes(path.normalize(target))) fail(`${name}: export ${key} names ${target}, which isn't packed`)
      }
      for (const file of files.filter((file) => file.startsWith("dist/") && file.endsWith(".js"))) {
        if (!files.includes(file.replace(/\.js$/, ".d.ts"))) fail(`${name}: ${file} has no .d.ts beside it`)
        // Output whose source is gone is an earlier build's, which `pnpm build` cleans first
        const source = file.replace(/^dist\//, "src/").replace(/\.js$/, ".ts")
        if (!files.includes(source)) fail(`${name}: ${file} has no source, ${source}: an earlier build's output`)
      }
      for (
        const [command, target] of Object.entries(typeof pkg.bin === "string" ? { [pkg.name]: pkg.bin } : pkg.bin ?? {})
      ) {
        if (!files.includes(path.normalize(target))) fail(`${name}: bin ${command} names ${target}, which isn't packed`)
      }
      for (const file of files) {
        // The workspace's own: its tests, scenarios and data; `src/test/` is a module, `@usestrider/browser/test`
        if (
          /^(test|tests|typetest|scenarios)\//.test(file) || /(^|\/)(fixtures|\.data|\.vitest)\//.test(file) ||
          file.endsWith(".test.ts")
        ) {
          fail(`${name}: ${file} is packed, which is the workspace's`)
        }
      }
      // Its license
      if (!files.includes("LICENSE")) fail(`${name}: LICENSE isn't packed`)
      if (pkg.license !== "MIT") fail(`${name}: license ${pkg.license}, not MIT`)
      // What it needs
      if (Object.keys(pkg.dependencies ?? {}).length > 0) {
        fail(`${name}: dependencies ${Object.keys(pkg.dependencies).join(", ")}; only peers are allowed`)
      }
      packed.push({ name, pkg, offered, tarball: path.join(out, tarball) })
    }

    // A project with only the packages and their peers
    const consumer = path.join(work, "consumer")
    fs.mkdirSync(consumer)
    const peers = {}
    for (const { pkg } of packed) {
      for (const [peer, range] of Object.entries(pkg.peerDependencies ?? {})) {
        if (!packed.some((each) => each.name === peer)) peers[peer] = range
      }
    }
    fs.writeFileSync(
      path.join(consumer, "package.json"),
      JSON.stringify(
        {
          name: "strider-pack-check",
          private: true,
          type: "module",
          dependencies: {
            ...Object.fromEntries(packed.map(({ name, tarball }) => [name, `file:${tarball}`])),
            ...peers
          }
        },
        null,
        2
      )
    )
    // Laid out flat, with the peers of peers installed, as npm installs, so that a package resolves its peers where
    // the project's are
    run("pnpm", [
      "install",
      "--prefer-offline",
      "--ignore-workspace",
      "--config.auto-install-peers=true",
      "--config.node-linker=hoisted"
    ], { cwd: consumer })

    // Every subpath imports under Node, and type-checks under `nodenext`
    const imports = packed.flatMap(({ name, offered }) =>
      offered.map(({ key }) => (key === "." ? name : `${name}/${key.slice(2)}`))
    )
    fs.writeFileSync(
      path.join(consumer, "imports.mjs"),
      imports.map((specifier, index) => `import * as m${index} from ${JSON.stringify(specifier)}`).join("\n") +
        `\nconsole.log(${imports.length})\n`
    )
    try {
      run("node", ["imports.mjs"], { cwd: consumer })
    } catch (error) {
      const lines = String(error.stderr || error.message).trim().split("\n")
      fail(`importing the subpaths under Node:\n${lines.slice(0, 12).join("\n")}`)
    }
    fs.writeFileSync(path.join(consumer, "imports.ts"), fs.readFileSync(path.join(consumer, "imports.mjs"), "utf8"))
    fs.writeFileSync(
      path.join(consumer, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          module: "nodenext",
          moduleResolution: "nodenext",
          target: "es2022",
          strict: true,
          noEmit: true,
          skipLibCheck: false,
          types: []
        },
        files: ["imports.ts"]
      })
    )
    try {
      run(path.join(root, "node_modules", ".bin", "tsc"), ["-p", consumer])
    } catch (error) {
      fail(`type-checking the subpaths under nodenext:\n${String(error.stdout || error.message).trim()}`)
    }

    // A real installed public getter exports its caller, including next to src/ and in encoded install paths.
    const traceCaller = path.join("node_modules", "@usestrider", "browser", "src-neighbor", "caller.mjs")
    fs.mkdirSync(path.dirname(path.join(consumer, traceCaller)), { recursive: true })
    fs.copyFileSync(path.join(root, "packages/tools/utils/test/trace-sources.mjs"), path.join(consumer, traceCaller))
    const checkTraceSources = (directory) => {
      for (const flags of [[], ["--enable-source-maps"]]) {
        const label = `${path.basename(directory)} ${flags.length === 0 ? "plain" : "source maps"}`
        try {
          const result = run("node", [...flags, traceCaller], { cwd: directory, timeout: 30_000 })
          process.stdout.write(`pack-check: ${label}: ${result}`)
        } catch (error) {
          fail(`trace source caller (${label}):\n${String(error.stderr || error.message).trim()}`)
        }
      }
    }
    checkTraceSources(consumer)
    const encodedConsumer = path.join(work, `consumer space %2F # café${process.platform === "win32" ? "" : " \\"}`)
    fs.renameSync(consumer, encodedConsumer)
    try {
      checkTraceSources(encodedConsumer)
    } finally {
      fs.renameSync(encodedConsumer, consumer)
    }

    // The command runs from the installed package, and says what it needs where its optional peer is missing
    const strider = path.join(consumer, "node_modules", ".bin", "strider")
    try {
      run(strider, ["--help"], { cwd: consumer })
    } catch (error) {
      fail(`strider --help: ${String(error.stderr || error.message).trim().split("\n")[0]}`)
    }
    const platform = path.join(consumer, "node_modules", "@effect", "platform-node")
    fs.renameSync(platform, `${platform}.away`)
    try {
      run(strider, ["--help"], { cwd: consumer })
      fail("strider --help without @effect/platform-node succeeded")
    } catch (error) {
      if (!String(error.stderr).includes("pnpm add @effect/platform-node")) {
        fail(`strider --help without @effect/platform-node: ${String(error.stderr || error.message).trim()}`)
      }
    } finally {
      fs.renameSync(`${platform}.away`, platform)
    }

    // The command to install globally, in a project of its own laid out as a global install is
    const cliOut = path.join(work, "cli-tarball")
    fs.mkdirSync(cliOut)
    run("pnpm", ["pack", "--pack-destination", cliOut], { cwd: path.join(root, "packages/cli") })
    const cliTarball = path.join(cliOut, fs.readdirSync(cliOut)[0])
    const cliUnpacked = path.join(work, "unpacked", "cli")
    fs.mkdirSync(cliUnpacked, { recursive: true })
    run("tar", ["-xzf", cliTarball, "-C", cliUnpacked])
    const cliPkg = JSON.parse(fs.readFileSync(path.join(cliUnpacked, "package", "package.json"), "utf8"))
    const cliFiles = walk(path.join(cliUnpacked, "package"))
    if (!cliFiles.includes("LICENSE")) fail(`${cliPkg.name}: LICENSE isn't packed`)
    if (cliPkg.license !== "MIT") fail(`${cliPkg.name}: license ${cliPkg.license}, not MIT`)
    if (!cliFiles.includes(path.normalize(cliPkg.bin.strider))) {
      fail(`${cliPkg.name}: bin ${cliPkg.bin.strider} isn't packed`)
    }
    const cliDependencies = Object.keys(cliPkg.dependencies ?? {}).sort().join(", ")
    if (cliDependencies !== "@effect/platform-node, @usestrider/browser, effect") {
      fail(`${cliPkg.name}: dependencies ${cliDependencies}`)
    }
    const library = packed.find(({ name }) => name === "@usestrider/browser")
    const cliConsumer = path.join(work, "cli-consumer")
    fs.mkdirSync(cliConsumer)
    fs.writeFileSync(
      path.join(cliConsumer, "package.json"),
      JSON.stringify({
        name: "strider-pack-check-cli",
        private: true,
        dependencies: { [cliPkg.name]: `file:${cliTarball}` }
      })
    )
    // The library isn't on the registry here: the project's own workspace file points the command at the packed one
    fs.writeFileSync(
      path.join(cliConsumer, "pnpm-workspace.yaml"),
      `overrides:\n  ${JSON.stringify(library.name)}: ${JSON.stringify(`file:${library.tarball}`)}\n`
    )
    run("pnpm", ["install", "--prefer-offline"], { cwd: cliConsumer })
    try {
      run(path.join(cliConsumer, "node_modules", ".bin", "strider"), ["--help"], { cwd: cliConsumer })
    } catch (error) {
      fail(`${cliPkg.name}: strider --help: ${String(error.stderr || error.message).trim().split("\n")[0]}`)
    }
    // With Bun alone on the path, the launcher runs it there, daemon's runtime and all
    const bunOnly = path.join(work, "bun-only")
    fs.mkdirSync(bunOnly)
    const launcher = path.join(cliConsumer, "node_modules", "@usestrider", "cli", "strider.js")
    try {
      fs.symlinkSync(run("sh", ["-c", "command -v bun"]).trim(), path.join(bunOnly, "bun"))
      const help = run(launcher, ["--help"], { cwd: cliConsumer, env: { ...process.env, PATH: bunOnly } })
      if (!help.includes("USAGE")) fail(`${cliPkg.name}: strider --help on Bun printed no usage`)
    } catch (error) {
      fail(`${cliPkg.name}: strider --help on Bun: ${String(error.stderr || error.message).trim().split("\n")[0]}`)
    }
  } finally {
    fs.rmSync(work, { recursive: true, force: true })
  }
  for (const failure of failures) process.stderr.write(`pack-check: ${failure}\n`)
  if (failures.length === 0) process.stdout.write(`pack-check: ${packages.join(", ")} as published\n`)
  return failures.length === 0 ? 0 : 1
}
