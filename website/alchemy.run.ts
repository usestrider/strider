// The documentation site on Cloudflare, with Alchemy: the built site as a Worker's static assets at usestrider.dev.
// `pnpm website:deploy` deploys it with the settings decrypted from deploy.sops.env, and `.github/workflows/docs.yml`
// does from main.
import * as Cloudflare from "@alchemy.run/cloudflare"
import * as Alchemy from "alchemy"
import * as Effect from "effect/Effect"
import * as Path from "node:path"
import { fileURLToPath } from "node:url"

// The repository's root, where the build runs: the site reads the API reference, generated from the packages there.
// Relative to where Alchemy runs, so the stack's props are the same on every machine; a clean checkout has no built
// site, so a deploy from CI always builds, and uploads only what changed
const root = Path.relative(process.cwd(), fileURLToPath(new URL("..", import.meta.url))) || "."

export default Alchemy.Stack(
  "StriderDocs",
  { providers: Cloudflare.providers(), state: Cloudflare.state() },
  Effect.gen(function*() {
    const site = yield* Cloudflare.Website.StaticSite("Docs", {
      // The API reference's data, then the site: one script, since Alchemy runs the command without a shell
      command: "pnpm website:dist",
      cwd: root,
      outdir: "website/dist",
      // www redirects to the bare domain (301, path kept), by a zone redirect rule ahead of the Worker
      domain: { name: "usestrider.dev", redirects: ["www.usestrider.dev"] },
      // No workers.dev URL: the domain is the only way in
      workersDev: false
    })
    return { url: site.url }
  })
)
