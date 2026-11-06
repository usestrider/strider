/** Validate the entry point before importing browser tests or opening recording files. */
export const integrationEnvironment = (
  platform: string,
  env: Readonly<Record<string, string | undefined>>
): "linux" | "macos" => {
  if (platform === "linux" && env["STRIDER_ENVIRONMENT"] === "nix-integration") return "linux"
  if (platform === "darwin" && env["STRIDER_ENVIRONMENT"] === "macos-integration") {
    if (env["STRIDER_RECORD"]) throw new Error("macOS traffic recording is disabled: drift fixtures belong to Linux")
    return "macos"
  }
  throw new Error("Run browser tests with pnpm test:integration (Linux) or pnpm test:integration:macos (macOS)")
}

/** Fails on every difference, including patch versions. */
export const assertVersion = (
  browser: string,
  found: string,
  pinned: string,
  platform: "linux" | "macos" = "linux"
): void => {
  if (found === pinned) return
  const guidance = platform === "linux"
    ? "(test/integration/browsers.json); the Nix environment provides it: run pnpm test:integration"
    : "(test/integration/browsers.macos.json); run pnpm test:integration:macos to download the pinned browsers"
  throw new Error(`${browser} ${found} isn't the pinned ${pinned} ${guidance}`)
}
