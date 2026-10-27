// Removes what `pnpm build` writes for the published packages, so a build starts from nothing: `tsc -b` never
// deletes an output whose source is gone, so a module renamed or removed would stay in `dist` and be published.
// The build information goes too, without which `tsc -b` would think the deleted output current. Run from the
// repository root; `pnpm build` runs it first.
import * as fs from "node:fs"
import * as path from "node:path"

/** The packages published, by directory. */
export const packages = ["packages/browser", "packages/vitest"]

export const clean = (root) => {
  for (const directory of packages) {
    for (const output of ["dist", "tsconfig.tsbuildinfo"]) {
      fs.rmSync(path.join(root, directory, output), { recursive: true, force: true })
    }
  }
  return 0
}
