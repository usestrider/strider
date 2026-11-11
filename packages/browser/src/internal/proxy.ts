/** Validates context proxy settings without reflecting credentials in an error. */
import * as Effect from "effect/Effect"
import * as Redacted from "effect/Redacted"
import * as Reason from "../Reason.ts"
import type * as UserContext from "../UserContext.ts"
import type * as Adapter from "./adapter.ts"

export const normalize = (
  options: NonNullable<UserContext.Options["proxy"]>,
  backend: string
): Effect.Effect<Adapter.ProxyOptions, Reason.InvalidInput | Reason.Unsupported> => {
  const invalid = () =>
    Effect.fail(
      new Reason.InvalidInput({
        input: "proxy",
        expected:
          "an HTTP proxy endpoint without credentials, path, query, or fragment, and bypass hostnames or IP addresses",
        hint: "Supply proxy credentials separately with a Redacted password"
      })
    )
  if (typeof options.server !== "string" || (options.bypass !== undefined && !Array.isArray(options.bypass))) {
    return invalid()
  }
  if (
    options.credentials !== undefined &&
    (options.credentials === null || typeof options.credentials.username !== "string" ||
      !Redacted.isRedacted(options.credentials.password) ||
      typeof Redacted.value(options.credentials.password) !== "string")
  ) return invalid()
  const input = options.server
  const url = URL.parse(input.includes("://") ? input : `http://${input}`)
  if (
    url === null || url.username !== "" || url.password !== "" || input.includes("@") || url.hostname === ""
  ) return invalid()
  if (url.protocol !== "http:") {
    return Effect.fail(
      new Reason.Unsupported({
        capability: "userContexts.proxy.scheme",
        backend,
        hint: "Only HTTP proxy endpoints are supported, for HTTP and HTTPS destinations"
      })
    )
  }
  if (url.pathname !== "/" || input.includes("?") || input.includes("#") || url.port === "0") return invalid()
  const bypass = options.bypass ?? []
  for (const host of bypass) {
    if (
      typeof host !== "string" || host === "" || /[\s/\\*,;?#@%]/.test(host) ||
      host.startsWith(".") || host.endsWith(".") || (host.startsWith("[") && !host.endsWith("]"))
    ) return invalid()
    const parsed = URL.parse(`http://${host.includes(":") && !host.startsWith("[") ? `[${host}]` : host}`)
    if (parsed === null || parsed.port !== "" || parsed.pathname !== "/" || parsed.username !== "") return invalid()
  }
  return Effect.succeed(
    {
      server: `${url.hostname}:${url.port || "80"}`,
      bypass: bypass.map((host) => host.toLowerCase()),
      ...(options.credentials === undefined
        ? {}
        : { credentials: { username: options.credentials.username, password: options.credentials.password } })
    } satisfies Adapter.ProxyOptions
  )
}

/** The loopback exclusions needed by browser control connections and local destinations. */
export const loopback = ["localhost", "127.0.0.1", "::1"] as const
