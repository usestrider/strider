#!/usr/bin/env node
// strider-utils <command>: repository tools.
//   barrel [--check]   write (or check) the package's barrels in Effect's format, from a package directory
//   clean              remove the published packages' build output, from the repository root
//   pack-check         check what the published packages would be, from the repository root, after `pnpm build`
//   readme [--check]   write (or check) the README npm shows from the repository's, from the repository root
const [command, ...args] = process.argv.slice(2)
if (command === "barrel") {
  const { barrel } = await import("./barrel.mjs")
  process.exitCode = barrel(process.cwd(), args.includes("--check"))
} else if (command === "clean") {
  const { clean } = await import("./clean.mjs")
  process.exitCode = clean(process.cwd())
} else if (command === "pack-check") {
  const { packCheck } = await import("./pack-check.mjs")
  process.exitCode = packCheck(process.cwd())
} else if (command === "readme") {
  const { readme } = await import("./readme.mjs")
  process.exitCode = readme(process.cwd(), args.includes("--check"))
} else {
  process.stderr.write("usage: strider-utils barrel [--check] | clean | pack-check | readme [--check]\n")
  process.exitCode = 1
}
