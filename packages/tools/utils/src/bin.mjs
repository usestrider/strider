#!/usr/bin/env node
// strider-utils <command>: repository tools, run from a package directory.
//   barrel [--check]   write (or check) the package's barrels in Effect's format
const [command, ...args] = process.argv.slice(2)
if (command === "barrel") {
  const { barrel } = await import("./barrel.mjs")
  process.exitCode = barrel(process.cwd(), args.includes("--check"))
} else {
  process.stderr.write("usage: strider-utils barrel [--check]\n")
  process.exitCode = 1
}
