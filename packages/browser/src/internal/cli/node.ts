/**
 * The few Node APIs the `strider` client and daemon use directly, typed here: the package compiles without Node's
 * types, so that nothing else can come to depend on them. The command runs on Node, or on Bun through its Node
 * compatibility (CLI.md).
 */

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

export const os = () => load("node:os") as Promise<{ readonly tmpdir: () => string; readonly homedir: () => string }>
