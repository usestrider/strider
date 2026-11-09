import type * as Socket from "effect/socket/Socket"
import { spawnSync } from "node:child_process"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { describe, expect, it } from "vitest"
import { browserLines, connection, lineCharacters, packet, PacketFile } from "./integration/firefoxPackets.ts"
import { instrument } from "./integration/tracePlugin.ts"

describe("temporary Firefox packet capture", () => {
  it("keeps root IDs without recording nested cookie values or mistaking nested IDs for packet IDs", () => {
    expect(packet("{\"type\":\"success\",\"id\":8749,\"result\":{\"cookies\":[{\"value\":\"secret\"}]}}"))
      .toMatchObject({
        id: 8749,
        method: null,
        type: "success"
      })
    expect(packet("{\"type\":\"event\",\"method\":\"script.realmCreated\",\"params\":{\"id\":9}}")).toMatchObject({
      id: null,
      method: "script.realmCreated"
    })
    expect(packet("{\"id\":8749,\"method\":\"storage.getCookies\",\"params\":{\"type\":\"storageKey\"}}"))
      .toMatchObject({
        id: 8749,
        method: "storage.getCookies",
        type: null
      })
  })

  it("observes native callbacks before the simulated reader and keeps send arguments and exceptions", () => {
    const events: Array<{ kind: string; data: object }> = []
    const listeners: Array<(event: Socket.WebSocketEvent) => void> = []
    const socket: Socket.WebSocketLike = {
      readyState: 1,
      addEventListener: (_type, listener) => {
        listeners.push(listener)
      },
      removeEventListener: () => {},
      close: () => {},
      send(data) {
        expect(this).toBe(socket)
        events.push({ kind: "actual-send", data: { data } })
        throw new Error("send failed")
      }
    }
    const capture = connection("ws://localhost:9222/session", {
      active: true,
      record: (kind, data) => {
        events.push({ kind, data })
      }
    })
    expect(capture.native(socket)).toBe(socket)
    listeners.push(() => capture.record("transport-receive", "{\"type\":\"success\",\"id\":8749}"))
    for (const listener of listeners) listener({ data: "{\"type\":\"success\",\"id\":8749}" } as Socket.WebSocketEvent)
    expect(() => socket.send("{\"id\":8749,\"method\":\"storage.getCookies\"}")).toThrow("send failed")
    expect(events.map((entry) => entry.kind)).toEqual([
      "native-connection",
      "native-message",
      "transport-receive",
      "native-send",
      "actual-send",
      "native-send-error"
    ])
    const identities = events.filter((entry) => entry.kind !== "actual-send").map((entry) =>
      (entry.data as { connection: string }).connection
    )
    expect(new Set(identities).size).toBe(1)
  })

  it("reassembles browser stderr chunks and preserves the browser clock separately, with bounded lines", () => {
    const events: Array<{ kind: string; data: object }> = []
    const collect = browserLines(42, {
      active: true,
      record: (kind, data) => {
        events.push({ kind, data })
      }
    })
    collect("1794176493954\tRemoteAgent\tDEBUG\tWebDriverBiDiConnec")
    collect("tion abc -> {\"id\":8749,\"method\":\"storage.getCookies\",\"params\":\"")
    collect("x".repeat(lineCharacters * 2))
    collect(
      "\"}\n1794176503563\tRemoteAgent\tDEBUG\tWebDriverBiDiConnection abc <- {\"type\":\"success\",\"id\":8749}\n"
    )
    expect(events).toHaveLength(2)
    expect(events[0]!.data).toMatchObject({
      browserPid: 42,
      browserEpochMs: "1794176493954",
      browserConnection: "abc",
      direction: "->",
      id: 8749
    })
    expect((events[0]!.data as { omittedLineCharacters: number }).omittedLineCharacters).toBeGreaterThan(0)
    expect(events[1]!.data).toMatchObject({ browserEpochMs: "1794176503563", direction: "<-", id: 8749 })
    expect(JSON.stringify(events)).not.toContain("x".repeat(30))
  })

  it("persists without a test-failure callback and stops at the disk budget with an explicit marker", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "firefox-packets-"))
    try {
      const file = path.join(directory, "packets.ndjson")
      const capture = new PacketFile(file, 2048)
      for (let index = 0; index < 50; index++) capture.record("packet", { id: index })
      const rows = fs.readFileSync(file, "utf8").trim().split("\n").map((line) => JSON.parse(line))
      expect(rows.at(-1)).toMatchObject({ kind: "capture-limit", limit: 2048 })
      expect(rows[0]).toMatchObject({ hostUtc: expect.any(String), hostMonotonicNs: expect.any(String) })
      expect(fs.statSync(file).size).toBeLessThanOrEqual(2048)
      const before = fs.readFileSync(file, "utf8")
      capture.record("packet", { id: 900 })
      expect(fs.readFileSync(file, "utf8")).toBe(before)
    } finally {
      fs.rmSync(directory, { recursive: true })
    }
  })

  it("enables Firefox logs and merges dump output into the existing stderr stream without losing arguments", () => {
    const module = new URL("./integration/firefoxPackets.ts", import.meta.url).href
    const script = `
      import { command, preferences } from ${JSON.stringify(module)};
      import { spawnSync } from "node:child_process";
      const original = [process.execPath, ["-e", "process.stdout.write('DUMP'); process.stderr.write(process.argv[1])", "argument with spaces"]];
      const [file, args] = command(original, "/tmp/firefox");
      const child = spawnSync(file, args, { encoding: "utf8" });
      console.log(JSON.stringify({ code: child.status, stdout: child.stdout, stderr: child.stderr,
        prefs: preferences({ own: true }),
        limited: command(["/bin/sh", ["-c", 'ulimit -c 0; exec "$@"', "sh", "/tmp/firefox", "--headless"]], "/tmp/firefox") }));
    `
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
      encoding: "utf8",
      env: { ...process.env, STRIDER_INTEGRATION_JOB: "firefox" }
    })
    expect(result.status, result.stderr).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual({
      code: 0,
      stdout: "",
      stderr: "DUMPargument with spaces",
      prefs: { own: true, "remote.log.level": "Debug", "remote.log.truncate": true },
      limited: ["/bin/sh", ["-c", "ulimit -c 0; exec \"$@\" 1>&2", "sh", "/tmp/firefox", "--headless"]]
    })
  })

  it("keeps packet files after both successful and failed child exits", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "firefox-packet-exits-"))
    try {
      for (const code of [0, 1]) {
        const file = path.join(directory, `${code}.ndjson`)
        const module = new URL("./integration/firefoxPackets.ts", import.meta.url).href
        const script = `import { PacketFile } from ${JSON.stringify(module)}; new PacketFile(${
          JSON.stringify(file)
        }).record("packet", { id: 8749 }); process.exitCode = ${code}`
        const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8" })
        expect(result.status, result.stderr).toBe(code)
        expect(JSON.parse(fs.readFileSync(file, "utf8"))).toMatchObject({ kind: "packet", id: 8749 })
      }
    } finally {
      fs.rmSync(directory, { recursive: true })
    }
  })

  it("intercepts the real Firefox launch and WebSocket source without shipping production edits", () => {
    for (
      const file of ["../src/internal/firefoxLauncher.ts", "../src/internal/launch.ts", "../src/protocol/Transport.ts"]
    ) {
      const url = new URL(file, import.meta.url)
      const source = fs.readFileSync(url, "utf8")
      const output = instrument(source, url.pathname)!
      expect(output.code).toContain("__firefoxPackets")
      expect(output.code.split("\n").length).toBe(source.split("\n").length)
      if (file.endsWith("Transport.ts")) {
        expect(output.code).toContain("__packets.record(\"transport-receive\", frame)")
        expect(output.code).toContain("__packets.native(construct(")
      }
    }
  })
})
