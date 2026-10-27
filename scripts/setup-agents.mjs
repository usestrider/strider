// Links AGENTS.md and CLAUDE.md at the root to .agents/AGENTS.md, and .claude/skills to .agents/skills, so every
// agent finds the same instructions and skills. Runs on `pnpm install`.
import * as fs from "node:fs"

/** Makes `target` a link to `source`, given relative to the target's directory, unless something is there */
const link = (source, target) => {
  try {
    fs.lstatSync(target)
  } catch (error) {
    if (error?.code !== "ENOENT") throw error
    fs.symlinkSync(source, target)
  }
}

link(".agents/AGENTS.md", "AGENTS.md")
link(".agents/AGENTS.md", "CLAUDE.md")
fs.mkdirSync(".claude", { recursive: true })
link("../.agents/skills", ".claude/skills")
