/**
 * What every launcher shares: checking the executable a launch names, and looking up nothing else, a profile
 * directory that lives as long as the browser, a child process whose stderr is kept for errors, and the `BrowserError`s a launch fails
 * with (API.md, Modules and backends).
 */
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Option from "effect/Option"
import * as ChildProcess from "effect/process/ChildProcess"
import type * as ChildProcessSpawner from "effect/process/ChildProcessSpawner"
import * as Stream from "effect/Stream"
import * as Browser from "../Browser.ts"
import * as Diagnostics from "../Diagnostics.ts"
import * as Ledger from "../Ledger.ts"
import * as Reason from "../Reason.ts"
import { now } from "./adapter.ts"
import * as Paths from "./paths.ts"
import * as Spans from "./spans.ts"

/** A browser process, started. */
export interface Launched {
  readonly executable: string
  readonly args: ReadonlyArray<string>
  readonly userDataDir: string
  readonly handle: ChildProcessSpawner.ChildProcessHandle
  /** The last 8 KiB the browser wrote to stderr. */
  readonly stderrTail: Effect.Effect<string>
  /**
   * Waits for a line of stderr that matches, and returns its match; `None` if stderr ends first. Made once, as
   * the browser starts: the first call also sees the lines before it (the newest 64 KiB of them), and a later one
   * only the lines that arrive while it waits.
   */
  readonly stderrLine: (pattern: RegExp) => Effect.Effect<Option.Option<RegExpMatchArray>>
}

/** The `Diagnostics` of a launch: one step, never dispatched to a page. */
export const diagnostics = (step: string): Diagnostics.Diagnostics =>
  new Diagnostics.Diagnostics({
    operationId: "launch" as Diagnostics.OperationId,
    dispatch: { _tag: "NotSent" },
    progress: [{ step, state: "rejected", at: now() }],
    lastObserved: Option.none(),
    cleanup: { _tag: "NotNeeded" }
  })

/** What a launch fails with. */
export type LaunchError = Browser.BrowserError

/** Fails a launch with a reason. */
export const fail = (reason: Browser.BrowserErrorReason, step: string) =>
  Effect.fail(new Browser.BrowserError({ reason, diagnostics: diagnostics(step) }))

/** Fails a launch whose browser refused the connection. */
export const refused = (hint: string) => fail(new Browser.ConnectionFailed({ stage: "refused", hint }), "connect")

/** Fails a launch given what it can't take. */
export const invalidInput = (
  input: { readonly input: string; readonly expected: string; readonly hint: string },
  step: string
) => fail(new Reason.InvalidInput(input), step)

/** A launch's span: the executable it named and, where the backend has them, the launch profile it used. */
export const span = (
  name: string,
  options: { readonly executablePath?: string | undefined; readonly profile?: string | undefined },
  profiled = true
) =>
  Spans.operation(name, {
    attributes: {
      "browser.executable": options.executablePath,
      ...(profiled ? { "browser.launch.profile": options.profile ?? "automation" } : {})
    }
  })

/** Whether a path is absolute, on POSIX or Windows; the package doesn't assume Node's `path`. */
export const isAbsolute = Paths.isAbsolute

const lookup = "`strider browsers` lists the browsers it can find, by absolute path"

/**
 * The executable a launch names, checked: an absolute path to a file that exists. Nothing else is looked up,
 * so a launch never runs a browser nobody named. A relative path, whose meaning depends on
 * the working directory, and a bare command name, which the process spawner would look up on `PATH`, fail with
 * `InvalidInput`, as does a missing path from a caller the types don't reach, such as plain JavaScript.
 */
export const executable = Effect.fnUntraced(function*(executablePath: string | undefined) {
  if (typeof executablePath !== "string" || !isAbsolute(executablePath)) {
    return yield* fail(
      new Reason.InvalidInput({
        input: "executablePath",
        expected: "an absolute path to the browser's executable",
        hint: typeof executablePath !== "string"
          ? `A launch names its browser, and nothing is looked up or downloaded in its place; ${lookup}`
          : `${
            JSON.stringify(executablePath)
          } isn't absolute, so it would depend on the working directory or on PATH; ${lookup}`
      }),
      "check the executable"
    )
  }
  const fs = yield* FileSystem.FileSystem
  if (yield* fs.exists(executablePath).pipe(Effect.orElseSucceed(() => false))) return executablePath
  return yield* fail(
    new Browser.ExecutableNotFound({
      searched: [executablePath],
      hint: `Nothing is at the executablePath given; ${lookup}`
    }),
    "check the executable"
  )
})

/** A profile directory: the caller's, or a temporary one deleted after the browser exits. */
export const profileDirectory = Effect.fnUntraced(function*(userDataDir: string | undefined, prefix: string) {
  const fs = yield* FileSystem.FileSystem
  if (userDataDir !== undefined) return userDataDir
  // In the ledger while it exists: the finalizer that forgets it runs after the one that removes it
  const ledger = yield* Ledger.CurrentLedger
  let made: string | undefined
  yield* Effect.addFinalizer(() => made === undefined ? Effect.void : ledger.remove({ _tag: "Directory", path: made }))
  const directory = yield* fs.makeTempDirectoryScoped({ prefix }).pipe(
    Effect.catch((error) =>
      fail(
        new Browser.ConnectionFailed({
          stage: "refused",
          hint: `Couldn't create a temporary profile: ${error.message}`
        }),
        "create the profile"
      )
    )
  )
  made = directory
  yield* ledger.add({ _tag: "Directory", path: directory })
  return directory
})

const tailBytes = 8 * 1024

/** The most text of stderr's lines kept for a launcher before it first looks. */
const keptLimit = 64 * 1024

/**
 * The command that starts a browser, and its arguments. Core dumps are off unless asked for: a browser that
 * crashes would otherwise not exit until the host has written its core, which takes tens of seconds, so Strider
 * wouldn't report the crash until then. A child process can't set its own resource limits from Node, so the
 * browser starts through `sh`, which lowers the limit and becomes the browser (`exec`): the process started is the
 * browser, with the same pid, file descriptors and signals. The executable and its arguments are the shell's
 * positional parameters, never part of its script. Windows has no limit to lower and no `sh`, so the browser
 * starts as it is.
 */
export const command = (
  executable: string,
  args: ReadonlyArray<string>,
  coreDumps: boolean,
  platform: string = process.platform
): readonly [string, ReadonlyArray<string>] =>
  coreDumps || platform === "win32"
    ? [executable, args]
    : ["/bin/sh", ["-c", "ulimit -c 0; exec \"$@\"", "sh", executable, ...args]]

/**
 * Starts the browser in the scope. Closing the scope terminates it, killing it after `forceKillAfter` if it
 * hasn't exited. This raw process release sends a signal immediately; Chromium's connected layer attempts
 * graceful closure first, with its own five-second budget. Core dumps are off unless `coreDumps` is true (see `command`).
 */
export const spawn = Effect.fnUntraced(function*(
  executable: string,
  args: ReadonlyArray<string>,
  userDataDir: string,
  options: {
    readonly additionalFds?: ChildProcess.CommandOptions["additionalFds"]
    readonly env?: Readonly<Record<string, string>> | undefined
    readonly coreDumps?: boolean | undefined
  }
) {
  // In the ledger while it runs, known by the profile its command line names
  const ledger = yield* Ledger.CurrentLedger
  let launched: Ledger.Item | undefined
  yield* Effect.addFinalizer(() => launched === undefined ? Effect.void : ledger.remove(launched))
  const [file, fileArgs] = command(executable, args, options.coreDumps ?? false)
  const handle = yield* ChildProcess.make(file, fileArgs, {
    additionalFds: options.additionalFds ?? {},
    stdin: "ignore",
    stdout: "ignore",
    stderr: "pipe",
    forceKillAfter: "5 seconds",
    ...(options.env === undefined ? {} : { env: options.env, extendEnv: true })
  }).pipe(
    Effect.catch((error) =>
      fail(
        new Browser.ProcessExited({
          code: Option.none(),
          stderrTail: "",
          hint: `${executable} didn't start: ${error.message}`
        }),
        "start the browser"
      )
    )
  )
  launched = { _tag: "Browser", pid: Number(handle.pid), executable, profile: userDataDir }
  yield* ledger.add(launched)
  let tail = ""
  // Lines are kept for the first `stderrLine`, which a launcher makes as the browser starts: the newest of them
  // until it is made, and none after, so a browser that runs for hours doesn't fill memory with its stderr.
  let kept: Array<string> | undefined = []
  let keptBytes = 0
  let finished = false
  /** Each hears every line from when it is added, and `undefined` once stderr ends. */
  const waiters = new Set<(line: string | undefined) => void>()
  yield* handle.stderr.pipe(
    Stream.decodeText,
    Stream.tap((text) => Effect.sync(() => (tail = (tail + text).slice(-tailBytes)))),
    Stream.splitLines,
    Stream.runForEach((line) =>
      Effect.sync(() => {
        if (kept !== undefined) {
          kept.push(line)
          keptBytes += line.length
          while (keptBytes > keptLimit) keptBytes -= kept.shift()!.length
        }
        for (const waiter of waiters) waiter(line)
      })
    ),
    Effect.ignore,
    Effect.ensuring(Effect.sync(() => {
      finished = true
      for (const waiter of waiters) waiter(undefined)
    })),
    Effect.forkScoped
  )
  const stderrLine = (pattern: RegExp) =>
    Effect.callback<Option.Option<RegExpMatchArray>>((resume) => {
      const earlier = kept ?? []
      kept = undefined
      keptBytes = 0
      for (const line of earlier) {
        const match = line.match(pattern)
        if (match !== null) return resume(Effect.succeed(Option.some(match)))
      }
      if (finished) return resume(Effect.succeed(Option.none()))
      const check = (line: string | undefined) => {
        const match = line === undefined ? null : line.match(pattern)
        if (line !== undefined && match === null) return
        waiters.delete(check)
        resume(Effect.succeed(Option.fromNullishOr(match)))
      }
      waiters.add(check)
      return Effect.sync(() => waiters.delete(check))
    })
  return {
    executable,
    args,
    userDataDir,
    handle,
    stderrTail: Effect.sync(() => tail),
    stderrLine
  } satisfies Launched
})

/**
 * What a launch that couldn't connect failed with: `ProcessExited` if the browser is gone, with its exit code
 * and stderr, or `ConnectionFailed` if it is still running.
 */
export const notReady = Effect.fnUntraced(function*(launched: Launched, description: string) {
  const running = yield* launched.handle.isRunning.pipe(Effect.orElseSucceed(() => false))
  const stderrTail = yield* launched.stderrTail
  if (running) {
    return yield* fail(
      new Browser.ConnectionFailed({ stage: "handshake", hint: `The browser didn't answer: ${description}` }),
      "connect"
    )
  }
  const code = yield* launched.handle.exitCode.pipe(Effect.option)
  return yield* fail(
    new Browser.ProcessExited({
      code: Option.map(code, (code) => code as number),
      stderrTail,
      hint: `The browser exited before it was ready; its stderr is in stderrTail. ${description}`
    }),
    "connect"
  )
})
