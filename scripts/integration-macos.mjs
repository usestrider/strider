/** Install immutable upstream builds, verify bytes, then run only the macOS integration project. */
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { createReadStream } from "node:fs"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import * as path from "node:path"
import { fileURLToPath } from "node:url"

if (process.platform !== "darwin" || process.arch !== "arm64") {
  throw new Error("macOS integration requires an Apple Silicon macOS runner")
}
if (process.env.STRIDER_RECORD) throw new Error("macOS traffic recording is disabled: drift fixtures belong to Linux")
const root = fileURLToPath(new URL("../", import.meta.url))
const pins = JSON.parse(
  await readFile(new URL("../packages/browser/test/integration/browsers.macos.json", import.meta.url), "utf8")
)
const opensslPrefix = spawnSync("brew", ["--prefix", "openssl@3"], { encoding: "utf8" })
if (opensslPrefix.status !== 0) throw new Error("Install the TLS fixture tool with brew install openssl@3")
const openssl = path.join(opensslPrefix.stdout.trim(), "bin/openssl")
const directory = await mkdtemp(path.join(tmpdir(), "strider-macos-"))
const run = (command, args, env = process.env) => {
  const result = spawnSync(command, args, { cwd: root, env, stdio: "inherit" })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${command} exited with ${result.status} (${result.signal})`)
}
try {
  for (const [name, pin] of Object.entries(pins)) {
    const archive = path.join(directory, name === "chromium" ? "chrome.zip" : "firefox.dmg")
    run("curl", ["--fail", "--location", "--retry", "3", "--output", archive, pin.url])
    const hash = createHash("sha256")
    for await (const chunk of createReadStream(archive)) hash.update(chunk)
    if (hash.digest("hex") !== pin.sha256) throw new Error(`${name}: download SHA-256 mismatch`)
    console.log(`${name} ${pin.version}: SHA-256 verified`)
  }
  run("ditto", ["-x", "-k", path.join(directory, "chrome.zip"), directory])
  const mount = path.join(directory, "firefox-volume")
  run("hdiutil", ["attach", path.join(directory, "firefox.dmg"), "-readonly", "-nobrowse", "-mountpoint", mount])
  try {
    run("ditto", [path.join(mount, "Firefox.app"), path.join(directory, "Firefox.app")])
  } finally {
    run("hdiutil", ["detach", mount])
  }
  // Headed Chromium uses the runner's native WindowServer, never Xvfb. Browser profiles remain scope-owned.
  run("pnpm", ["exec", "vitest", "--run", "--config", "vitest.integration.macos.config.ts", ...process.argv.slice(2)], {
    ...process.env,
    STRIDER_ENVIRONMENT: "macos-integration",
    STRIDER_CHROMIUM: path.join(
      directory,
      "chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"
    ),
    STRIDER_FIREFOX: path.join(directory, "Firefox.app/Contents/MacOS/firefox"),
    STRIDER_OPENSSL: openssl,
    TZ: "UTC",
    LANG: "en_US.UTF-8",
    LC_ALL: "en_US.UTF-8"
  })
} finally {
  await rm(directory, { recursive: true, force: true })
}
