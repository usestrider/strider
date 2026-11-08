// The site's Worker: the static assets, and the page-view counter's script and event endpoint, which it forwards to
// the analytics server. That server's origin is a deploy setting (METRICS_ORIGIN, in deploy.sops.env), so neither
// the pages nor this repository name it, and counting stays on usestrider.dev, where blockers that list analytics
// hosts don't stop it. The counter is Plausible's: no cookies, nothing stored in the browser.

interface Env {
  readonly ASSETS: { fetch(request: Request): Promise<Response> }
  readonly METRICS_ORIGIN: string
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url)
    if (pathname === "/a/script.js") {
      // Cached at the edge for a day: the script changes only when the server is upgraded
      return fetch(
        `${env.METRICS_ORIGIN}/js/script.js`,
        { cf: { cacheEverything: true, cacheTtl: 86400 } } as RequestInit
      )
    }
    if (pathname === "/a/event" && request.method === "POST") {
      // The server counts unique visitors by the reader's address and browser, which it never stores, so both are
      // passed on, as a direct request would carry them
      return fetch(`${env.METRICS_ORIGIN}/api/event`, {
        method: "POST",
        body: await request.text(),
        headers: {
          "Content-Type": request.headers.get("Content-Type") ?? "text/plain",
          "User-Agent": request.headers.get("User-Agent") ?? "",
          "X-Forwarded-For": request.headers.get("CF-Connecting-IP") ?? ""
        }
      })
    }
    return env.ASSETS.fetch(request)
  }
}
