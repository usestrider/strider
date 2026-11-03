// Renders the link-preview images with Strider: og.html to the site's public/og.png, and github.html to github.png,
// which GitHub takes by hand, in the repository's settings under Social preview. The fonts come from the network.
// CHROMIUM_PATH=/path/to/chromium pnpm --filter @usestrider/website social
import { NodeRuntime, NodeServices } from "@effect/platform-node"
import { Browser } from "@usestrider/browser"
import { Chromium } from "@usestrider/browser/chromium"
import { Config, Console, Effect, FileSystem, Layer } from "effect"

const images = [
  { source: "og.html", viewport: { width: 1200, height: 630 }, output: "../public/og.png" },
  { source: "github.html", viewport: { width: 1280, height: 640 }, output: "github.png" }
]

const here = (path: string) => new URL(path, import.meta.url)

const render = Effect.fn("render")(function*(image: (typeof images)[number]) {
  const fs = yield* FileSystem.FileSystem
  const page = yield* Browser.newPage({ emulation: { viewport: image.viewport } })
  yield* page.goto(here(image.source).href)
  // A font that doesn't load falls back without an error, and the image would look almost right
  const loaded = yield* page.evaluate(() =>
    document.fonts.ready.then(() => Array.from(document.fonts).every((font) => font.status === "loaded"))
  )
  if (!loaded) return yield* Effect.die(new Error(`${image.source}: a font didn't load`))
  const png = yield* page.screenshot()
  yield* fs.writeFile(here(image.output).pathname, png)
  yield* Console.log(`${image.output}: ${png.length} bytes`)
}, Effect.scoped)

const BrowserLive = Chromium.layerConfig({ executablePath: Config.String("CHROMIUM_PATH") }).pipe(
  Layer.provideMerge(NodeServices.layer)
)

Effect.forEach(images, render).pipe(Effect.provide(BrowserLive), NodeRuntime.runMain)
