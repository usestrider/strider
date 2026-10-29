/** CLI help is discoverable before a session or browser has been started. */
import { assert, describe, it } from "@effect/vitest"
import { spawnSync } from "node:child_process"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"

const bin = new URL("../src/bin/strider.ts", import.meta.url).pathname

const invoke = (...args: ReadonlyArray<string>) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "strider-help-"))
  try {
    const result = spawnSync(process.execPath, [bin, ...args], {
      encoding: "utf8",
      timeout: 10_000,
      env: {
        ...process.env,
        XDG_RUNTIME_DIR: root,
        XDG_STATE_HOME: root,
        NO_COLOR: "1"
      }
    })
    assert.isUndefined(result.error)
    assert.isNull(result.signal)
    return { code: result.status, text: result.stdout + result.stderr }
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
}

const help = (...args: ReadonlyArray<string>) => {
  const result = invoke(...args, "--help")
  assert.strictEqual(result.code, 0, result.text)
  return result.text
}

describe("strider help", () => {
  it("shows root and short command help without a session selector", () => {
    assert.match(help(), /^\s+select\b/m)
    const result = invoke("select", "-h")
    assert.strictEqual(result.code, 0, result.text)
    assert.include(result.text, "role=")
  })

  it("keeps ordinary commands and help after the argument terminator on the forwarding path", () => {
    for (const args of [["select", "target", "label"], ["fill", "target", "--", "--help"]]) {
      const result = invoke("-s", "help-check", ...args)
      assert.strictEqual(result.code, 20, result.text)
      assert.include(result.text, "No session named help-check is running")
    }
  })

  it("keeps local argument errors after the argument terminator", () => {
    const result = invoke("sessions", "--", "--help")
    assert.notStrictEqual(result.code, 0)
    assert.include(result.text, "Unexpected positional argument: \"--help\"")
  })

  it("preserves local command flags in the help tree", () => {
    assert.include(help("browsers"), "--json")
    assert.include(help("sessions"), "--json")
    assert.include(help("select"), "--json")
    assert.include(help("page", "new"), "--json")
  })
  it("discovers session and page commands with a session selector before starting a browser", () => {
    const text = help("-s", "help-check")
    for (const command of ["page", "find", "snapshot", "select", "click", "history", "stop"]) {
      assert.match(text, new RegExp(`^\\s+${command}\\b`, "m"), `Missing ${command} from help:\n${text}`)
    }
  })

  it("shows select's target and labels through command help without connecting to a session", () => {
    const text = help("-s", "help-check", "select")
    assert.match(text, /USAGE/)
    assert.match(text, /\btarget\b/)
    assert.match(text, /\blabel\b/)
    assert.include(text, "role=")
  })

  it("discovers page subcommands and reaches page new's argument help without a session", () => {
    assert.match(help("-s", "help-check", "page"), /^\s+new\b/m)
    const text = help("-s", "help-check", "page", "new")
    assert.match(text, /USAGE/)
    assert.match(text, /\burl\b/)
    assert.include(text, "--name")
  })

  it("describes every start flag, beyond its type", () => {
    const text = help("start")
    for (
      const flag of [
        "name",
        "chromium",
        "firefox",
        "webkit",
        "attach",
        "user-data-dir",
        "state",
        "fork",
        "idle",
        "owner-pid",
        "secret"
      ]
    ) {
      const row = text.split("\n").find((line) => line.trimStart().startsWith(`--${flag} `))
      assert.isDefined(row, `Missing --${flag} from help:\n${text}`)
      assert.match(row!, /^\s+--\S+\s+\S+\s{2,}\S/, `Missing description for --${flag}:\n${text}`)
    }
  })
})
