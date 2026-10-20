// Links AGENTS.md and CLAUDE.md at the root to .agents/AGENTS.md, so every agent finds the same instructions.
// Runs on `pnpm install`.
import * as fs from "node:fs"

const source = ".agents/AGENTS.md"
for (const target of ["AGENTS.md", "CLAUDE.md"]) {
  try {
    fs.lstatSync(target)
  } catch (error) {
    if (error?.code !== "ENOENT") throw error
    fs.symlinkSync(source, target)
  }
}
