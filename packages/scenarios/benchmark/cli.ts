import { execFileSync, spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import * as fs from "node:fs"
import * as path from "node:path"
import { compare, type Report, type Run } from "./report.ts"

const root = path.resolve(import.meta.dirname, "../../..")
const runs = path.join(root, ".data/upstream/runs")
const help = `Usage:
  pnpm benchmark:upstream [--name NAME] [--output DIRECTORY] [--samples N] [FILE_FILTER...]
  pnpm benchmark:compare BEFORE AFTER

Runs default to five samples plus one warmup, sequentially, on pinned Chromium.
Results are saved in .data/upstream/runs/NAME (or --output); existing directories are never overwritten.
BEFORE and AFTER can be run names, directories, or results.json paths.
Known test failures still save results and exit nonzero. Comparison includes their status, without timing deltas.
`
const sha = (content: string | Buffer) => createHash("sha256").update(content).digest("hex")
const git = (...args: Array<string>) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim()

const benchmarkHash = () => {
  const hash = createHash("sha256")
  const add = (relative: string) => {
    const absolute = path.join(root, relative)
    const stat = fs.lstatSync(absolute)
    if (stat.isDirectory()) {
      for (const name of fs.readdirSync(absolute).sort()) add(`${relative}/${name}`)
    } else {
      hash.update(relative).update("\0").update(
        stat.isSymbolicLink() ? fs.readlinkSync(absolute) : fs.readFileSync(absolute)
      ).update("\0")
    }
  }
  for (
    const file of [
      "packages/scenarios/test/upstream",
      "packages/scenarios/upstream",
      "packages/scenarios/benchmark",
      "vitest.upstream.config.ts",
      "vitest.config.ts",
      "vitest.setup.ts",
      "packages/browser/test/integration/environment.ts"
    ]
  ) add(file)
  return hash.digest("hex")
}

const read = (input: string): Report => {
  let file = path.resolve(input)
  if (!fs.existsSync(file)) file = path.join(runs, input)
  if (fs.statSync(file).isDirectory()) file = path.join(file, "results.json")
  return JSON.parse(fs.readFileSync(file, "utf8")) as Report
}

const main = () => {
  const [command, ...args] = process.argv.slice(2)
  if (args.includes("--help") || args.includes("-h")) {
    process.stdout.write(help)
    return
  }
  if (command === "compare") {
    if (args.length !== 2) throw new Error(help)
    process.stdout.write(compare(read(args[0]!), read(args[1]!)))
    return
  }
  if (command !== "run") throw new Error(help)
  let name: string | undefined
  let output: string | undefined
  let samples = 5
  const filters: Array<string> = []
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!
    if (["--name", "--output", "--samples"].includes(arg)) {
      const value = args[++i]
      if (value === undefined || value.startsWith("--")) throw new Error(`${arg} requires a value.`)
      if (arg === "--name") name = value
      else if (arg === "--output") output = path.resolve(value)
      else samples = Number(value)
    } else if (arg.startsWith("-")) throw new Error(`Unknown option: ${arg}\n${help}`)
    else filters.push(arg)
  }
  if (!Number.isInteger(samples) || samples < 2 || samples > 20) {
    throw new Error("--samples must be an integer from 2 to 20.")
  }
  if (name !== undefined && !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(name)) {
    throw new Error(
      "--name must start with a letter or digit and contain only letters, digits, dots, underscores or hyphens."
    )
  }
  const startedAt = new Date().toISOString()
  const commit = git("rev-parse", "HEAD")
  name ??= `${startedAt.replaceAll(":", "-")}-${commit.slice(0, 8)}`
  const metadata: Run = {
    name,
    startedAt,
    git: {
      commit,
      branch: git("branch", "--show-current"),
      status: git("status", "--porcelain=v1", "--untracked-files=all"),
      diffSha256: sha(execFileSync("git", ["diff", "HEAD", "--binary"], { cwd: root, maxBuffer: 64 * 1024 * 1024 }))
    },
    benchmarkSha256: benchmarkHash(),
    lockfileSha256: sha(fs.readFileSync(path.join(root, "pnpm-lock.yaml"))),
    nixSha256: sha(
      Buffer.concat([fs.readFileSync(path.join(root, "flake.nix")), fs.readFileSync(path.join(root, "flake.lock"))])
    ),
    filters
  }
  const directory = output ?? path.join(runs, name)
  fs.mkdirSync(path.dirname(directory), { recursive: true })
  fs.mkdirSync(directory)
  fs.writeFileSync(path.join(directory, "run.json"), JSON.stringify(metadata, null, 2) + "\n", { flag: "wx" })
  process.stdout.write(
    `Benchmark ${name}\nResults: ${directory}\nRevision: ${commit}${metadata.git.status ? " (dirty worktree)" : ""}\n`
  )
  const result = spawnSync("pnpm", ["test:upstream", ...filters, "--no-file-parallelism", "--maxWorkers", "1"], {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, STRIDER_UPSTREAM_SAMPLES: String(samples), STRIDER_UPSTREAM_RUN: directory }
  })
  fs.writeFileSync(
    path.join(directory, "exit.json"),
    JSON.stringify(
      {
        finishedAt: new Date().toISOString(),
        code: result.status,
        signal: result.signal,
        error: result.error?.message
      },
      null,
      2
    ) + "\n",
    { flag: "wx" }
  )
  if (result.error !== undefined) throw result.error
  if (!fs.existsSync(path.join(directory, "results.json"))) {
    throw new Error(`No results were produced. See the test output and ${directory}/exit.json.`)
  }
  process.stdout.write(`\nSaved benchmark: ${directory}\n`)
  process.exitCode = result.status ?? 1
}

try {
  main()
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
}
