// Each backend's capabilities as its adapter states them, for the site's browser guides: what each browser
// supports, and where it doesn't, why. They're read from the adapters' own tables (`capabilities` in `cdpAdapter.ts`
// and `bidiAdapter.ts`, `launchedCapabilities` and `attachedCapabilities` in `webkitAdapter.ts`), for a browser
// Strider launched and one it attached to, so the guides can't drift from what the code reports. Node runs the
// adapters' TypeScript as it is.
import * as fs from "node:fs"
import * as path from "node:path"
import { pathToFileURL } from "node:url"

/** The browser as an adapter describes it once connected; the tables read only its product's name */
const info = (product, protocol) => ({ product, version: "", protocol, revision: "" })

const plain = (set) =>
  set.entries.map(({ name, status, limitations }) => ({ name, status, limitations: [...limitations] }))

export const capabilities = async (root, out) => {
  const adapter = (file) => import(pathToFileURL(path.join(root, "packages/browser/src/internal", file)).href)
  const [cdp, bidi, webkit] = await Promise.all([
    adapter("cdpAdapter.ts"),
    adapter("bidiAdapter.ts"),
    adapter("webkitAdapter.ts")
  ])
  const backends = [
    {
      id: "chromium",
      label: "Chromium",
      layers: "Chromium.layer, Chromium.layerConnect",
      // The product Chromium reports, headless or not, as `Browser.getVersion` gives it
      launched: plain(cdp.capabilities(info("Chrome/155.0.8059.79", "cdp"), "launched")),
      attached: plain(cdp.capabilities(info("Chrome/155.0.8059.79", "cdp"), "attached"))
    },
    {
      id: "firefox",
      label: "Firefox",
      layers: "Firefox.layer, Firefox.layerConnect, Bidi.layerConnect",
      launched: plain(bidi.capabilities(info("firefox", "bidi"), "launched")),
      attached: plain(bidi.capabilities(info("firefox", "bidi"), "attached"))
    },
    {
      id: "webkit",
      label: "WebKit",
      layers: "WebKit.layer, WebKit.layerAttach",
      launched: plain(webkit.launchedCapabilities(info("WebKit", "webkit"))),
      attached: plain(webkit.attachedCapabilities(info("WebKit (stock)", "webkit")))
    }
  ]
  fs.mkdirSync(out, { recursive: true })
  fs.writeFileSync(path.join(out, "capabilities.json"), JSON.stringify({ backends }, null, 2) + "\n")
  const count = new Set(backends.flatMap((backend) =>
    [...(backend.launched ?? []), ...(backend.attached ?? [])]
      .map((entry) => entry.name)
  )).size
  process.stdout.write(`Wrote ${count} capabilities for ${backends.length} backends to ${path.relative(root, out)}\n`)
}
