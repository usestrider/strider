#!/usr/bin/env node
// strider-utils <command>: repository tools.
//   barrel [--check]   write (or check) the package's barrels in Effect's format, from a package directory
//   barrel version [--check]
//                      the same, then write (or check) src/internal/version.ts from the package's version
//   clean              remove the published packages' build output, from the repository root
//   pack-check         check what the published packages would be, from the repository root, after `pnpm build`
//   readme [--check]   write (or check) the README npm shows from the repository's, from the repository root
const [command, ...args] = process.argv.slice(2)
if (command === "barrel") {
  const { barrel } = await import("./barrel.mjs")
  const check = args.includes("--check")
  process.exitCode = barrel(process.cwd(), check)
  if (args.includes("version")) {
    const { version } = await import("./version.mjs")
    process.exitCode = Math.max(process.exitCode, version(process.cwd(), check))
  }
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
  process.stderr.write("usage: strider-utils barrel [version] [--check] | clean | pack-check | readme [--check]\n")
  process.exitCode = 1
}
