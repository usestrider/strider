/**
 * The `strider` client (CLI.md): it forwards a command to its session's daemon over the
 * session's Unix socket, without loading Effect, and prints what the daemon answers. Ctrl-C interrupts the
 * command, never the session. The commands that need no session (`browsers`, `sessions`, `prune`, and `start`,
 * which starts one) run in this process, with Effect.
 */
import * as Node from "./node.ts"
import * as Session from "./session.ts"

/** The commands this process runs itself. */
export const local = new Set(["browsers", "sessions", "prune", "mcp", "__daemon"])

/** The sessions whose sockets exist. */
export const running = async (rootDir: string): Promise<Array<string>> => {
  const fs = await Node.fs()
  try {
    return fs.readdirSync(rootDir).filter((name) => fs.existsSync(Session.paths(rootDir, name).socket)).sort()
  } catch {
    return []
  }
}

/** Forwards the command to its session's daemon; the exit code is the daemon's. */
export const forward = async (argv: ReadonlyArray<string>): Promise<number> => {
  const process = Node.process
  const rootDir = Session.root(process.env, (await Node.os()).tmpdir())
  const named = Session.scan(argv).session
  const name = named ?? process.env.STRIDER_SESSION
  if (name === undefined || name === "") {
    const sessions = await running(rootDir)
    process.stderr.write(
      `Every command names its session, with -s or STRIDER_SESSION. ${
        sessions.length === 0 ? "No session is running; strider start starts one." : `Running: ${sessions.join(", ")}.`
      }\n`
    )
    return Session.exitCodes.NoSession!
  }
  // Supply the environment default as a shared flag when no explicit session was given.
  const args = named === undefined ? ["-s", name, ...argv] : [...argv]
  const sessions = await running(rootDir)
  const net = await Node.net()
  return new Promise((resolve) => {
    const socket = net.createConnection(Session.paths(rootDir, name).socket)
    let buffered = ""
    let code: number | undefined
    const interrupt = () => socket.write(`${JSON.stringify({ _tag: "Interrupt" } satisfies Session.Request)}\n`)
    process.on("SIGINT", interrupt)
    socket.on("connect", () => {
      const request: Session.Request = { _tag: "Command", argv: args, cwd: process.cwd() }
      socket.write(`${JSON.stringify(request)}\n`)
    })
    socket.on("data", (data) => {
      buffered += new TextDecoder().decode(data)
      let end: number
      while ((end = buffered.indexOf("\n")) >= 0) {
        const line = buffered.slice(0, end)
        buffered = buffered.slice(end + 1)
        if (line === "") continue
        const response = JSON.parse(line) as Session.Response
        if (response._tag === "Out") process.stdout.write(`${response.text}\n`)
        else if (response._tag === "Err") process.stderr.write(`${response.text}\n`)
        else if (response._tag === "Exit") {
          code = response.code
          socket.end()
        }
      }
    })
    socket.on("error", (error) => {
      if (error.code === "ENOENT" || error.code === "ECONNREFUSED") {
        process.stderr.write(
          `No session named ${name} is running${
            sessions.length === 0 ? "" : `; running: ${sessions.join(", ")}`
          }. strider sessions lists them, with any a crash left behind.\n`
        )
        code = Session.exitCodes.NoSession
      } else {
        process.stderr.write(`The session ${name} didn't answer: ${error.message}\n`)
        code = 1
      }
    })
    socket.on("close", () => {
      process.off("SIGINT", interrupt)
      resolve(code ?? 1)
    })
  })
}

/**
 * `strider start`: starts the session's daemon, detached, with this command's arguments, and prints what it
 * answers once it serves, or why it couldn't start.
 */
export const start = async (
  argv: ReadonlyArray<string>,
  bin: string,
  // Where the daemon's spec goes: standard output, unless that is someone else's, as strider mcp's is
  say: (text: string) => void = (text) => void Node.process.stdout.write(`${text}\n`)
): Promise<number> => {
  const process = Node.process
  const childProcess = await Node.childProcess()
  const child = childProcess.spawn(process.execPath, [...process.execArgv, bin, "__daemon", ...argv], {
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env,
    cwd: process.cwd()
  })
  return new Promise((resolve) => {
    let buffered = ""
    let errors = ""
    let done = false
    const finish = (code: number) => {
      if (done) return
      done = true
      child.stdout?.destroy()
      child.stderr?.destroy()
      child.unref()
      resolve(code)
    }
    child.stdout?.on("data", (data) => {
      buffered += new TextDecoder().decode(data)
      const end = buffered.indexOf("\n")
      if (end < 0) return
      const started = JSON.parse(buffered.slice(0, end)) as Session.Started
      if (started._tag === "Ready") {
        say(started.text)
        finish(0)
      } else {
        process.stderr.write(`${started.text}\n`)
        finish(started.code)
      }
    })
    child.stderr?.on("data", (data) => void (errors += new TextDecoder().decode(data)))
    child.on("exit", (code) => {
      if (done) return
      process.stderr.write(
        `The session's daemon exited before it served${code === null ? "" : ` (${code})`}${
          errors === "" ? "" : `:\n${errors}`
        }`
      )
      finish(code === null || code === 0 ? 1 : code)
    })
  })
}

/** A command's answer from a session's daemon, collected rather than printed. */
export const ask = async (
  rootDir: string,
  name: string,
  argv: ReadonlyArray<string>
): Promise<{ readonly code: number; readonly out: string }> => {
  const net = await Node.net()
  return new Promise((resolve) => {
    const socket = net.createConnection(Session.paths(rootDir, name).socket)
    let buffered = ""
    let out = ""
    let code = 1
    socket.on(
      "connect",
      () =>
        socket.write(
          `${JSON.stringify({ _tag: "Command", argv: ["-s", name, ...argv], cwd: "/" } satisfies Session.Request)}\n`
        )
    )
    socket.on("data", (data) => {
      buffered += new TextDecoder().decode(data)
      let end: number
      while ((end = buffered.indexOf("\n")) >= 0) {
        const line = JSON.parse(buffered.slice(0, end)) as Session.Response
        buffered = buffered.slice(end + 1)
        if (line._tag === "Out") out += `${line.text}\n`
        if (line._tag === "Exit") {
          code = line.code
          socket.end()
        }
      }
    })
    socket.on("error", () => resolve({ code: Session.exitCodes.NoSession!, out: "" }))
    socket.on("close", () => resolve({ code, out }))
  })
}

/**
 * One of the toolkit's tools, called on a session's daemon as a model calls it (`strider mcp`): its
 * result encoded by the tool's Schema, or why there is none.
 */
export const callTool = async (
  rootDir: string,
  name: string,
  tool: string,
  params: unknown
): Promise<
  | { readonly _tag: "Result"; readonly failure: boolean; readonly value: unknown }
  | { readonly _tag: "NoResult"; readonly message: string }
> => {
  const net = await Node.net()
  return new Promise((resolve) => {
    const socket = net.createConnection(Session.paths(rootDir, name).socket)
    let buffered = ""
    let result: { readonly _tag: "Result"; readonly failure: boolean; readonly value: unknown } | undefined
    let errors = ""
    socket.on(
      "connect",
      () => socket.write(`${JSON.stringify({ _tag: "Tool", tool, params } satisfies Session.Request)}\n`)
    )
    socket.on("data", (data) => {
      buffered += new TextDecoder().decode(data)
      let end: number
      while ((end = buffered.indexOf("\n")) >= 0) {
        const line = JSON.parse(buffered.slice(0, end)) as Session.Response
        buffered = buffered.slice(end + 1)
        if (line._tag === "ToolResult") result = { _tag: "Result", failure: line.failure, value: line.value }
        if (line._tag === "Err") errors += line.text
        if (line._tag === "Exit") socket.end()
      }
    })
    socket.on(
      "error",
      (error) => resolve({ _tag: "NoResult", message: `The session ${name} isn't running: ${error.message}` })
    )
    socket.on(
      "close",
      () => resolve(result ?? { _tag: "NoResult", message: errors || `The session ${name} gave no result` })
    )
  })
}
