/**
 * What the `strider` client and its daemons share (CLI.md): where a session lives, the
 * names it may have, and the lines they exchange over its socket. Nothing here loads Effect, so the client
 * forwards a command without it.
 *
 * ```
 * $XDG_RUNTIME_DIR/strider/   the OS temporary directory's strider/ where there is no runtime directory
 *   <name>/                   one per session
 *     lock  daemon.sock  daemon.log
 *     profile/  downloads/  artifacts/
 * ```
 */

/** A session's name: lowercase letters, digits and dashes, short enough for a Unix socket's path. */
export const nameRule = /^[a-z0-9][a-z0-9-]{0,31}$/

/** The directory every session's directory is in. */
export const root = (env: Readonly<Record<string, string | undefined>>, tmpdir: string): string =>
  `${env.XDG_RUNTIME_DIR !== undefined && env.XDG_RUNTIME_DIR !== "" ? env.XDG_RUNTIME_DIR : tmpdir}/strider`

/** A session's directory, its socket, its lock and its log. */
export const paths = (rootDir: string, name: string) => {
  const dir = `${rootDir}/${name}`
  return {
    dir,
    socket: `${dir}/daemon.sock`,
    lock: `${dir}/lock`,
    log: `${dir}/daemon.log`,
    profile: `${dir}/profile`,
    downloads: `${dir}/downloads`,
    artifacts: `${dir}/artifacts`
  }
}

/**
 * Where the CLI keeps its ledger (`Ledger`): `$XDG_STATE_HOME/strider/ledger`, else
 * `~/.local/state/strider/ledger`. It outlives a session's directory, which is in the runtime directory.
 */
export const ledgerRoot = (env: Readonly<Record<string, string | undefined>>, home: string): string =>
  `${
    env.XDG_STATE_HOME !== undefined && env.XDG_STATE_HOME !== "" ? env.XDG_STATE_HOME : `${home}/.local/state`
  }/strider/ledger`

/** A command, as the client sends it: one JSON line. An `Interrupt` line after it interrupts the command. */
export type Request =
  | { readonly _tag: "Command"; readonly argv: ReadonlyArray<string>; readonly cwd: string }
  | { readonly _tag: "Interrupt" }
  /** One of the toolkit's tools, called as a model calls it: `strider mcp` forwards these. */
  | { readonly _tag: "Tool"; readonly tool: string; readonly params: unknown }

/** What a daemon answers, one JSON line each: output, then the exit code, which ends the answer. */
export type Response =
  | { readonly _tag: "Out"; readonly text: string }
  | { readonly _tag: "Err"; readonly text: string }
  | { readonly _tag: "Exit"; readonly code: number }
  /** A tool's result, encoded by its Schema: its success, or, with `failure`, its `ToolFailure`. */
  | { readonly _tag: "ToolResult"; readonly failure: boolean; readonly value: unknown }

/** What a daemon prints as it starts: its spec, once it serves, or why it couldn't. */
export type Started =
  | { readonly _tag: "Ready"; readonly text: string }
  | { readonly _tag: "Failed"; readonly text: string; readonly code: number }

/** The flags of `strider` itself that take a value, which come before the command. */
const valued = new Set(["-s", "--session", "-p", "--page"])

/** The session and the command an argument list names, read without parsing the rest. */
export const scan = (
  argv: ReadonlyArray<string>
): { readonly session: string | undefined; readonly command: string | undefined } => {
  let session: string | undefined
  let command: string | undefined
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]!
    if (arg === "-s" || arg === "--session") session = argv[index + 1]
    else if (arg.startsWith("--session=")) session = arg.slice("--session=".length)
    if (valued.has(arg)) {
      index++
      continue
    }
    if (arg.startsWith("-")) continue
    command = arg
    break
  }
  return { session, command }
}

/** Exit codes: per module error, so a script can branch on what failed. */
export const exitCodes: Readonly<Record<string, number>> = {
  CliError: 2,
  LocatorError: 10,
  PageError: 11,
  Timeout: 12,
  TargetGone: 13,
  ExpectationFailed: 14,
  InvalidInput: 15,
  PageNotFound: 16,
  NotPermitted: 17,
  NoSession: 20
}
