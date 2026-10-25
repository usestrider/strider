/**
 * The few Node APIs the `strider` client and daemon use directly, typed here: the package compiles without Node's
 * types, so that nothing else can come to depend on them. The command runs on Node (CLI.md).
 */

export interface NetSocket {
  write(text: string): void
  end(): void
  on(event: "connect" | "close", listener: () => void): void
  on(event: "data", listener: (data: Uint8Array) => void): void
  on(event: "error", listener: (error: { readonly code?: string; readonly message: string }) => void): void
}

export interface ChildProcess {
  readonly pid?: number | undefined
  readonly stdout: { on(event: "data", listener: (data: Uint8Array) => void): void; destroy(): void } | null
  readonly stderr: { on(event: "data", listener: (data: Uint8Array) => void): void; destroy(): void } | null
  on(event: "exit", listener: (code: number | null) => void): void
  unref(): void
}

export interface Process {
  readonly argv: ReadonlyArray<string>
  readonly execArgv: ReadonlyArray<string>
  readonly execPath: string
  readonly env: Record<string, string | undefined>
  readonly pid: number
  readonly platform: string
  exitCode: number | undefined
  cwd(): string
  kill(pid: number, signal?: number | string): void
  exit(code?: number): never
  on(event: string, listener: () => void): void
  off(event: string, listener: () => void): void
  readonly stdout: { write(text: string): boolean }
  readonly stderr: { write(text: string): boolean }
}

export const process = (globalThis as unknown as { readonly process: Process }).process

/** Whether a process is alive, by its id. */
export const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as { readonly code?: string }).code === "EPERM"
  }
}

const load = (specifier: string): Promise<unknown> => import(specifier)

export const net = () => load("node:net") as Promise<{ readonly createConnection: (path: string) => NetSocket }>

export const os = () => load("node:os") as Promise<{ readonly tmpdir: () => string }>

export const fs = () =>
  load("node:fs") as Promise<{
    readonly readdirSync: (path: string) => Array<string>
    readonly existsSync: (path: string) => boolean
    readonly appendFileSync: (path: string, text: string) => void
  }>

export const childProcess = () =>
  load("node:child_process") as Promise<{
    readonly spawn: (
      command: string,
      args: ReadonlyArray<string>,
      options: {
        readonly detached: boolean
        readonly stdio: ReadonlyArray<"ignore" | "pipe">
        readonly env: Record<string, string | undefined>
        readonly cwd: string
      }
    ) => ChildProcess
  }>
