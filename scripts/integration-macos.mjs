/** Install immutable upstream builds, verify bytes, then run only the macOS integration project. */
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { createReadStream } from "node:fs"
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises"
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
const videoPins = JSON.parse(await readFile(new URL("./ffmpeg.macos.json", import.meta.url), "utf8"))
const opensslPrefix = spawnSync("brew", ["--prefix", "openssl@3"], { encoding: "utf8" })
if (opensslPrefix.status !== 0) throw new Error("Install the TLS fixture tool with brew install openssl@3")
const openssl = path.join(opensslPrefix.stdout.trim(), "bin/openssl")
const opensslCheck = spawnSync(openssl, ["version"], { encoding: "utf8" })
if (opensslCheck.error || opensslCheck.status !== 0) {
  throw new Error(`Cannot run ${openssl}: install the TLS fixture tool with brew install openssl@3`, {
    cause: opensslCheck.error ?? new Error(opensslCheck.stderr)
  })
}
const directory = await mkdtemp(path.join(tmpdir(), "strider-macos-"))
const run = (command, args, env = process.env) => {
  const result = spawnSync(command, args, { cwd: root, env, stdio: "inherit" })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${command} exited with ${result.status} (${result.signal})`)
}
try {
  for (const [name, pin] of Object.entries({ ...pins, ...videoPins })) {
    const archive = path.join(
      directory,
      name === "chromium" ? "chrome.zip" : name === "firefox" ? "firefox.dmg" : `${name}.zip`
    )
    run("curl", ["--fail", "--location", "--retry", "3", "--output", archive, pin.url])
    const hash = createHash("sha256")
    for await (const chunk of createReadStream(archive)) hash.update(chunk)
    if (hash.digest("hex") !== pin.sha256) throw new Error(`${name}: download SHA-256 mismatch`)
    console.log(`${name} ${pin.version}: SHA-256 verified`)
  }
  for (const name of ["ffmpeg", "ffprobe"]) {
    run("ditto", ["-x", "-k", path.join(directory, `${name}.zip`), directory])
    run("chmod", ["+x", path.join(directory, name)])
    run(path.join(directory, name), ["-version"])
  }
  run("ditto", ["-x", "-k", path.join(directory, "chrome.zip"), directory])
  const mount = path.join(directory, "firefox-volume")
  run("hdiutil", ["attach", path.join(directory, "firefox.dmg"), "-readonly", "-nobrowse", "-mountpoint", mount])
  try {
    run("ditto", [path.join(mount, "Firefox.app"), path.join(directory, "Firefox.app")])
  } finally {
    run("hdiutil", ["detach", mount])
  }
  const crashDatabase = process.env.STRIDER_MACOS_CRASH_DATABASE
  if (crashDatabase) await mkdir(crashDatabase, { recursive: true })
  // BREAKPAD_DUMP_LOCATION overrides DIR_CRASH_DUMPS on macOS. It is independent of --user-data-dir.
  // CHROME_HEADLESS marks an unattended bot, disabling uploads even if user consent is present.
  // No Chromium flags or test deadlines change. The workflow collects the database after profile cleanup.
  // Headed Chromium uses the runner's native WindowServer, never Xvfb. Browser profiles remain scope-owned.
  run("pnpm", ["exec", "vitest", "--run", "--config", "vitest.integration.macos.config.ts", ...process.argv.slice(2)], {
    ...process.env,
    ...(crashDatabase ? { BREAKPAD_DUMP_LOCATION: crashDatabase, CHROME_HEADLESS: "1" } : {}),
    STRIDER_ENVIRONMENT: "macos-integration",
    STRIDER_CHROMIUM: path.join(
      directory,
      "chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"
    ),
    STRIDER_FIREFOX: path.join(directory, "Firefox.app/Contents/MacOS/firefox"),
    STRIDER_OPENSSL: openssl,
    STRIDER_FFMPEG: path.join(directory, "ffmpeg"),
    STRIDER_FFPROBE: path.join(directory, "ffprobe"),
    TZ: "UTC",
    LANG: "en_US.UTF-8",
    LC_ALL: "en_US.UTF-8"
  })
} finally {
  await rm(directory, { recursive: true, force: true })
}
