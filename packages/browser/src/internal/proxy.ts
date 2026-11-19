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
          "an http, https, socks5, or socks4 proxy endpoint without credentials, path, query, or fragment, and bypass hostnames, .domain suffixes, or IP addresses",
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
  const scheme = url.protocol.slice(0, -1)
  if (!isScheme(scheme)) {
    return Effect.fail(
      new Reason.Unsupported({
        capability: "userContexts.proxy.scheme",
        backend,
        hint: "Proxy endpoints are http://, https://, socks5://, or socks4://"
      })
    )
  }
  if (scheme.startsWith("socks") && options.credentials !== undefined) {
    return Effect.fail(
      new Reason.Unsupported({
        capability: "userContexts.proxy.socksCredentials",
        backend,
        hint: "No backend authenticates to a SOCKS proxy; use one that needs no credentials"
      })
    )
  }
  // A scheme URL doesn't know, such as socks5, keeps an empty path and its host's case
  if (
    (url.pathname !== "/" && url.pathname !== "") || input.includes("?") || input.includes("#") || url.port === "0"
  ) return invalid()
  const bypass = options.bypass ?? []
  for (const host of bypass) {
    if (
      typeof host !== "string" || host === "" || /[\s/\\*,;?#@%]/.test(host) ||
      host.startsWith("..") || host.endsWith(".") || (host.startsWith("[") && !host.endsWith("]")) ||
      // A leading dot names a domain's subdomains, which an IP address has none of
      (host.startsWith(".") && isAddress(host.slice(1)))
    ) return invalid()
    const name = host.startsWith(".") ? host.slice(1) : host
    const parsed = URL.parse(`http://${name.includes(":") && !name.startsWith("[") ? `[${name}]` : name}`)
    if (parsed === null || parsed.port !== "" || parsed.pathname !== "/" || parsed.username !== "") return invalid()
  }
  return Effect.succeed(
    {
      scheme,
      server: `${url.hostname.toLowerCase()}:${url.port || defaultPorts[scheme]}`,
      bypass: bypass.map((host) => host.toLowerCase()),
      ...(options.credentials === undefined
        ? {}
        : { credentials: { username: options.credentials.username, password: options.credentials.password } })
    } satisfies Adapter.ProxyOptions
  )
}

/**
 * Whether `host` is an IPv4 or IPv6 address, bracketed or not, as the URL parser reads it: it turns every IPv4
 * form, shorthand such as `127.1` or `0x7f.1` included, into four decimal parts, and keeps IPv6 in brackets.
 */
const isAddress = (host: string) => {
  const hostname = URL.parse(`http://${host.includes(":") && !host.startsWith("[") ? `[${host}]` : host}`)?.hostname
  return hostname !== undefined && (hostname.startsWith("[") || /^\d+\.\d+\.\d+\.\d+$/.test(hostname))
}

/** The proxy endpoint schemes Strider knows; a backend may still refuse one through its capability table. */
export const schemes = ["http", "https", "socks5", "socks4"] as const

const isScheme = (scheme: string): scheme is Adapter.ProxyScheme => (schemes as ReadonlyArray<string>).includes(scheme)

const defaultPorts: Record<Adapter.ProxyScheme, string> = { http: "80", https: "443", socks5: "1080", socks4: "1080" }

/** The endpoint as a URL without credentials, which identifies it. */
export const endpoint = (options: Adapter.ProxyOptions) => `${options.scheme}://${options.server}`

/** The loopback exclusions needed by browser control connections and local destinations. */
export const loopback = ["localhost", "127.0.0.1", "::1"] as const
