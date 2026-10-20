/**
 * What every launcher shares: finding an executable without guessing, a profile directory that lives as long
 * as the browser, a child process whose stderr is kept for errors, and the `BrowserError`s a launch fails
 * with (API.md, Modules and backends).
 */
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Option from "effect/Option"
import * as ChildProcess from "effect/process/ChildProcess"
import type * as ChildProcessSpawner from "effect/process/ChildProcessSpawner"
import * as Stream from "effect/Stream"
import * as Browser from "../Browser.ts"
import * as Diagnostics from "../Diagnostics.ts"
import * as Reason from "../Reason.ts"
import { now } from "./adapter.ts"

/** A browser process, started. */
export interface Launched {
  readonly executable: string
  readonly args: ReadonlyArray<string>
  readonly userDataDir: string
  readonly handle: ChildProcessSpawner.ChildProcessHandle
  /** The last 8 KiB the browser wrote to stderr. */
  readonly stderrTail: Effect.Effect<string>
  /** Waits for a line of stderr that matches, and returns its match; `None` if stderr ends first. */
  readonly stderrLine: (pattern: RegExp) => Effect.Effect<Option.Option<RegExpMatchArray>>
}

/**
 * Which browser a launch runs: its executable, or a channel the launcher knows, exactly one. Nothing else is
 * looked up, and nothing is downloaded (review 10).
 */
export type Named<Channel extends string> =
  | { readonly executablePath: string; readonly channel?: undefined }
  | { readonly channel: Channel; readonly executablePath?: undefined }

/** The `Diagnostics` of a launch: one step, never dispatched to a page. */
export const diagnostics = (step: string): Diagnostics.Diagnostics =>
  new Diagnostics.Diagnostics({
    operationId: "launch" as Diagnostics.OperationId,
    dispatch: { _tag: "NotSent" },
    progress: [{ step, state: "rejected", at: now() }],
    lastObserved: Option.none(),
    cleanup: { _tag: "NotNeeded" }
  })

/** Fails a launch with a reason. */
export const fail = (reason: Browser.BrowserErrorReason, step: string) =>
  Effect.fail(new Browser.BrowserError({ reason, diagnostics: diagnostics(step) }))

/**
 * The first candidate that exists. Nothing is searched beyond the candidates given, so a launch never picks
 * up a browser nobody named.
 */
export const findExecutable = Effect.fnUntraced(function*(candidates: ReadonlyArray<string>, hint: string) {
  const fs = yield* FileSystem.FileSystem
  for (const candidate of candidates) {
    if (yield* fs.exists(candidate).pipe(Effect.orElseSucceed(() => false))) return candidate
  }
  return yield* fail(new Browser.ExecutableNotFound({ searched: [...candidates], hint }), "find the executable")
})

/**
 * The executable a launch names: its path, or the first of its channel's candidates that exists. The types
 * require exactly one; a caller they don't reach, such as plain JavaScript, that names neither or both fails
 * with `InvalidInput` rather than being given a browser.
 */
export const namedExecutable = <Channel extends string>(
  options: Named<Channel>,
  channel: (channel: Channel) => { readonly candidates: ReadonlyArray<string>; readonly hint: string }
) => {
  if (options.executablePath !== undefined && options.channel === undefined) {
    return findExecutable([options.executablePath], "The executablePath given doesn't exist")
  }
  if (options.channel !== undefined && options.executablePath === undefined) {
    const { candidates, hint } = channel(options.channel)
    return findExecutable(candidates, hint)
  }
  return fail(
    new Reason.InvalidInput({
      input: "launch options",
      expected: "exactly one of executablePath and channel",
      hint: "A launch names its browser; nothing is looked up or downloaded in its place"
    }),
    "find the executable"
  )
}

/** A profile directory: the caller's, or a temporary one deleted after the browser exits. */
export const profileDirectory = Effect.fnUntraced(function*(userDataDir: string | undefined, prefix: string) {
  const fs = yield* FileSystem.FileSystem
  if (userDataDir !== undefined) return userDataDir
  return yield* fs.makeTempDirectoryScoped({ prefix }).pipe(
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
})

const tailBytes = 8 * 1024

/**
 * Starts the browser in the scope. Closing the scope terminates it, killing it after `forceKillAfter` if it
 * hasn't exited.
 */
export const spawn = Effect.fnUntraced(function*(
  executable: string,
  args: ReadonlyArray<string>,
  userDataDir: string,
  options: {
    readonly additionalFds?: ChildProcess.CommandOptions["additionalFds"]
    readonly env?: Readonly<Record<string, string>> | undefined
  }
) {
  const handle = yield* ChildProcess.make(executable, args, {
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
  let tail = ""
  let partial = ""
  const lines: Array<string> = []
  const waiters = new Set<() => void>()
  const ended = yield* Deferred.make<void>()
  yield* handle.stderr.pipe(
    Stream.decodeText,
    Stream.runForEach((text) =>
      Effect.sync(() => {
        tail = (tail + text).slice(-tailBytes)
        const split = (partial + text).split("\n")
        partial = split.pop()!
        lines.push(...split)
        for (const waiter of Array.from(waiters)) waiter()
      })
    ),
    Effect.ignore,
    Effect.ensuring(Deferred.succeed(ended, undefined)),
    Effect.forkScoped
  )
  const stderrLine = (pattern: RegExp) =>
    Effect.callback<Option.Option<RegExpMatchArray>>((resume) => {
      let seen = 0
      const check = () => {
        for (; seen < lines.length; seen++) {
          const match = lines[seen]!.match(pattern)
          if (match !== null) {
            waiters.delete(check)
            resume(Effect.succeed(Option.some(match)))
            return
          }
        }
      }
      waiters.add(check)
      check()
      return Effect.sync(() => waiters.delete(check))
    }).pipe(Effect.raceFirst(Deferred.await(ended).pipe(Effect.as(Option.none<RegExpMatchArray>()))))
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
