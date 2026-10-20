// Runs Effect's own JSDoc checker (`effect-jsdocs`) against the sketch. It is a private tool in the Effect
// repository, so it runs from a checkout: set EFFECT_REPO, or keep one at ../../../effect. It only reads the
// checkout, and writes its model to .data/jsdocs.json here. Run with `npm run jsdocs`.
import { spawnSync } from "node:child_process"
import * as fs from "node:fs"
import * as path from "node:path"

const root = path.resolve(import.meta.dirname, "..")
const repo = path.resolve(root, process.env.EFFECT_REPO ?? "../../../effect")
const bin = path.join(repo, "packages/tools/jsdocs/src/bin.ts")
if (!fs.existsSync(bin)) {
  process.stderr.write(`effect-jsdocs not found at ${bin}; set EFFECT_REPO to an Effect checkout\n`)
  process.exit(1)
}
const result = spawnSync(process.execPath, [bin, "--check", ...process.argv.slice(2)], { cwd: root, stdio: "inherit" })
process.exitCode = result.status ?? 1
