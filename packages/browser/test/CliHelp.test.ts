/** CLI help is discoverable before a session or browser has been started. */
import { assert, describe, it } from "@effect/vitest"
import { spawnSync } from "node:child_process"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import * as Tools from "../src/internal/tools.ts"

const bin = new URL("../src/bin/strider.ts", import.meta.url).pathname

const invoke = (...args: ReadonlyArray<string>) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "strider-help-"))
  try {
    const started = performance.now()
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
    if (process.env.STRIDER_HELP_TIMINGS === "1") {
      process.stderr.write(`strider ${args.join(" ")}: ${(performance.now() - started).toFixed(3)} ms\n`)
    }
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
  it("shows root help without a session selector", () => {
    const text = help()
    assert.match(text, /^\s+select\b/m)
    assert.match(text, /^\s+mcp\b/m)
    for (const tool of Object.values(Tools.toolkit.tools)) {
      if (tool.name !== "newPage" && tool.name !== "dialog") {
        assert.include(text.replace(/\s+/g, " "), tool.description!.slice(0, 65), tool.name)
      }
    }
  })

  it("shows short select help without a session selector", () => {
    const result = invoke("select", "-h")
    assert.strictEqual(result.code, 0, result.text)
    assert.include(result.text, "role=")
  })

  for (const args of [["select", "target", "label"], ["fill", "target", "--", "--help"]]) {
    it(`forwards ${args.join(" ")} to the selected session`, () => {
      const result = invoke("-s", "help-check", ...args)
      assert.strictEqual(result.code, 20, result.text)
      assert.include(result.text, "No session named help-check is running")
    })
  }

  it("keeps local argument errors after the argument terminator", () => {
    const result = invoke("sessions", "--", "--help")
    assert.notStrictEqual(result.code, 0)
    assert.include(result.text, "Unexpected positional argument: \"--help\"")
  })

  for (const args of [["browsers"], ["sessions"], ["select"], ["page", "new"]]) {
    it(`preserves local flags in ${args.join(" ")} help`, () => {
      const text = help(...args)
      assert.include(text, "--json")
      if (args.length === 2) {
        assert.include(text.replace(/\s+/g, " "), Tools.toolkit.tools.newPage.description!.slice(0, 65), "newPage")
      }
    })
  }
  it("discovers session and page commands with a session selector before starting a browser", () => {
    const text = help("-s", "help-check")
    for (const command of ["page", "find", "snapshot", "select", "click", "history", "stop"]) {
      assert.match(text, new RegExp(`^\\s+${command}\\b`, "m"), `Missing ${command} from help:\n${text}`)
    }
    for (
      const command of [
        "start",
        "browsers",
        "sessions",
        "prune",
        "mcp",
        "pages",
        "snapshot",
        "find",
        "screenshot",
        "goto",
        "back",
        "click",
        "fill",
        "press",
        "select",
        "scroll",
        "next",
        "await",
        "expect",
        "history",
        "route",
        "dialog",
        "remove",
        "page",
        "tabs",
        "control",
        "release",
        "run",
        "state",
        "export",
        "stop"
      ]
    ) {
      assert.match(text, new RegExp(`^ +${command} +\\S`, "m"), `Missing description for ${command}`)
    }
  })

  it("shows select's target and labels through command help without connecting to a session", () => {
    const text = help("-s", "help-check", "select")
    assert.match(text, /USAGE/)
    assert.match(text, /\btarget\b/)
    assert.match(text, /\blabel\b/)
    assert.include(text, "role=")
  })

  it("discovers page subcommands with a session selector", () => {
    assert.match(help("-s", "help-check", "page"), /^\s+new\b/m)
  })

  it("reaches page new argument help with a session selector", () => {
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

  it("shows mcp help and describes its flags", () => {
    const text = help("mcp")
    assert.include(text, "strider mcp")
    for (
      const flag of [
        "start",
        "keep",
        "session",
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
      const row = text.split("\n").find((line) => new RegExp(`^\\s+--${flag}(?:, -s)? `).test(line))
      assert.isDefined(row, `Missing --${flag}:\n${text}`)
      assert.match(
        row!,
        flag === "start" || flag === "keep" ? /^\s+--\S+\s{2,}\S/ : /^\s+--\S+(?: -s)?\s+\S+\s{2,}\S/,
        `Missing description for --${flag}`
      )
    }
    assert.include(text, "-s")
    assert.include(text, "STRIDER_SESSION")
    assert.include(text, "mcp-<pid>")
    assert.include(text, "--keep")
  })

  it("shows mcp help with a session selector", () => {
    assert.include(help("-s", "help-check", "mcp"), "strider mcp")
  })

  it("shows mcp help with start and keep flags", () => {
    assert.include(help("mcp", "--start", "--chromium", "/no/browser", "--keep"), "strider mcp")
  })
  for (
    const [group, commands] of [["page", ["new", "name"]], ["dialog", ["handle"]], ["state", ["save"]], ["export", [
      "test"
    ]]] as const
  ) {
    it(`describes nested ${group} commands`, () => {
      const text = help(group)
      for (const command of commands) {
        assert.match(text, new RegExp(`^ +${command} +\\S`, "m"), `Missing description for ${group} ${command}`)
      }
    })
  }

  it("reuses the dialog toolkit description in dialog handle help", () => {
    const text = help("dialog", "handle")
    assert.include(text.replace(/\s+/g, " "), Tools.toolkit.tools.dialog.description!.slice(0, 65), "dialog")
  })
})
