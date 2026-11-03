#!/bin/sh
':' //; if command -v node >/dev/null 2>&1; then exec node "$0" "$@"; else exec bun "$0" "$@"; fi
// The line above is a shell command to sh and a string and a comment to JavaScript: the command runs on Node where
// there is one, and on Bun otherwise, whose Node compatibility runs @effect/platform-node.
//
// The `strider` command of @usestrider/browser, for a global install. The library keeps @effect/platform-node an
// optional peer, which a global install never links to it, so this package depends on both: it runs the bin the
// library declares, whatever its published layout, and the library then finds the peer.
const { readFileSync } = await import("node:fs")

const manifest = import.meta.resolve("@usestrider/browser/package.json")
const { bin } = JSON.parse(readFileSync(new URL(manifest), "utf8"))
await import(new URL(bin.strider, manifest).href)
