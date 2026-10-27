// The documentation site on Cloudflare, with Alchemy: the built site as a Worker's static assets at usestrider.dev,
// behind Cloudflare Access. The account's Zero Trust organization and its one-time PIN login are referenced, not
// owned: other sites on the account use them, so this stack must never change or remove them.
// `pnpm website:deploy` deploys it with the settings decrypted from deploy.sops.env, and `.github/workflows/docs.yml`
// does from main.
import * as Cloudflare from "@alchemy.run/cloudflare"
import * as Alchemy from "alchemy"
import * as Config from "effect/Config"
import * as Effect from "effect/Effect"
import * as Path from "node:path"
import { fileURLToPath } from "node:url"

// The repository's root, where the build runs: the site reads the API reference, generated from the packages there.
// Relative to where Alchemy runs, so the stack's props are the same on every machine and a deploy from CI after one
// from a maintainer's changes nothing
const root = Path.relative(process.cwd(), fileURLToPath(new URL("..", import.meta.url))) || "."

export default Alchemy.Stack(
  "StriderDocs",
  { providers: Cloudflare.providers(), state: Cloudflare.state() },
  Effect.gen(function*() {
    // The account's login method for readers: a code sent to their email, so they need no account anywhere
    const pin = Cloudflare.Access.getIdentityProvider({ type: "onetimepin" })
    // Who may read the site: email addresses, comma-separated, from deploy.sops.env
    const readers = (yield* Config.String("DOCS_ACCESS_EMAILS")).split(",").map((email) => email.trim()).filter(
      (email) => email.length > 0
    )
    const site = yield* Cloudflare.Website.StaticSite("Docs", {
      command: "pnpm jsdocs && pnpm api-reference && pnpm website:build",
      cwd: root,
      outdir: "website/dist",
      domain: "usestrider.dev",
      // No workers.dev URL: the domain, behind Access, is the only way in
      workersDev: false,
      access: {
        name: "Strider docs",
        sessionDuration: "168h",
        allowedIdps: [pin.identityProviderId.as<string>()],
        autoRedirectToIdentity: true,
        policies: [{ decision: "allow", include: readers.map((email) => ({ email })) }]
      }
    })
    return { url: site.url }
  })
)
