/** The macOS stall probe captures a pipe child that never answers, and nothing for one that does. */
import { spawn } from "node:child_process"
import type { ChildProcess } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import * as path from "node:path"
import type { Writable } from "node:stream"
import { afterEach, assert, describe, it } from "vitest"
import { settings } from "../stallProbe.ts"
import type { Capture } from "../stallProbe.ts"

const thresholdMs = 500

describe.runIf(process.platform === "darwin")("stall probe", () => {
  const saved = { ...settings }
  const children: Array<ChildProcess> = []
  const profiles: Array<string> = []
  afterEach(() => {
    Object.assign(settings, { enabled: saved.enabled, thresholdMs: saved.thresholdMs, onCapture: saved.onCapture })
    for (const child of children.splice(0)) child.kill("SIGKILL")
    for (const profile of profiles.splice(0)) rmSync(profile, { recursive: true, force: true })
  })

  // `; :` keeps the shell from exec'ing its last command, so the child has a descendant to find.
  const launch = (script: string) => {
    const profile = mkdtempSync(path.join(tmpdir(), "strider-stall-probe-"))
    profiles.push(profile)
    writeFileSync(path.join(profile, "Local State"), "{}")
    const child = spawn("/bin/sh", ["-c", script, "sh", "--remote-debugging-pipe", `--user-data-dir=${profile}`], {
      stdio: ["ignore", "ignore", "pipe", "pipe", "pipe"]
    })
    children.push(child)
    child.stdio[4]!.on("data", () => {})
    ;(child.stdio[3] as Writable).write("{\"id\":1,\"method\":\"Browser.getVersion\"}\0")
    return child
  }

  const observe = (wait: number) => {
    const captures: Array<Capture> = []
    let resolve: (capture: Capture) => void = () => {}
    const first = new Promise<Capture | undefined>((done) => {
      resolve = done
      setTimeout(() => done(undefined), wait)
    })
    Object.assign(settings, {
      enabled: true,
      thresholdMs,
      onCapture: (capture: Capture) => {
        captures.push(capture)
        resolve(capture)
      }
    })
    return { first, captures }
  }

  it("records the tree, samples, fds and profile of a child that never answers", { timeout: 30_000 }, async () => {
    const { first } = observe(25_000)
    const child = launch("sleep 60; :")
    const capture = await first
    assert.isDefined(capture)
    assert.strictEqual(capture.browserPid, child.pid)
    assert.isAtLeast(capture.afterFirstSendMs, thresholdMs)
    assert.include(capture.tree.output, "--remote-debugging-pipe")
    assert.isAtLeast(capture.descendants.length, 1)
    assert.include(capture.tree.output, "sleep 60")
    const browserSample = capture.samples.find((sample) => sample.pid === child.pid)
    assert.isTrue(browserSample?.ok, browserSample?.error)
    assert.include(browserSample!.output, "Call graph")
    assert.isTrue(capture.fds.ok, capture.fds.error)
    for (const fd of ["2", "3", "4"]) assert.match(capture.fds.output, new RegExp(`\\s${fd}[a-z]?\\s`))
    assert.isTrue(capture.profile.entries.some((entry) => entry.endsWith(" Local State")))
    assert.isTrue(capture.uptime.ok)
    assert.isTrue(capture.vmStat.ok)
  })

  it("records nothing for a child that answers", { timeout: 10_000 }, async () => {
    const { first, captures } = observe(4 * thresholdMs)
    // Copies one byte of the command back, as a reply's first byte.
    launch("head -c 1 <&3 >&4; sleep 60; :")
    assert.isUndefined(await first)
    assert.lengthOf(captures, 0)
  })
})
