/**
 * Puppeteer's shared test helpers (`test/src/utils.ts`), and its runner's launch arguments, for the Puppeteer ports.
 */
import type { Page } from "@usestrider/browser"
import * as Option from "effect/Option"

type FrameId = Page.FrameTree["id"]

/**
 * The arguments Puppeteer's runner gives every Chromium (`test/src/mocha-utils.ts`): its test hosts `domain1.test` to
 * `domain3.test` resolve to the fixture server. A file that launches its own browser adds its own arguments to these.
 */
export const runnerChromiumArgs: ReadonlyArray<string> = [
  "--host-resolver-rules=MAP domain1.test 127.0.0.1,MAP domain2.test 127.0.0.1,MAP domain3.test 127.0.0.1",
  "--force-device-scale-factor=1",
  "--disable-features=OrganizerPanel"
]

/** A frame tree, the frame first and then its descendants, in document order. */
export const flatten = (tree: Page.FrameTree): ReadonlyArray<Page.FrameTree> => [
  tree,
  ...tree.children.flatMap(flatten)
]

/** The frame with `id`, if the tree has it. */
export const frameById = (tree: Page.FrameTree, id: FrameId) => flatten(tree).find((frame) => frame.id === id)

/** Puppeteer's `iframes(page)`: every frame but the main one, which has no frame element. */
export const iframeCount = (tree: Page.FrameTree) => flatten(tree).length - 1

/** Puppeteer's `navigateFrame`: sets an iframe's `src` in the page's main world and waits for its load. */
export const navigateFrame = (page: Page.Page, id: string, url: string) =>
  page.evaluateInMainWorld(
    (id, url) => {
      const frame = document.getElementById(id) as HTMLIFrameElement
      frame.src = url
      return new Promise<void>((resolve) => frame.onload = () => resolve())
    },
    id,
    url
  )

/** Puppeteer's `detachFrame`: removes an iframe from the page's main world. */
export const detachFrame = (page: Page.Page, id: string) =>
  page.evaluateInMainWorld((id) => {
    ;(document.getElementById(id) as HTMLIFrameElement).remove()
  }, id)

/**
 * Puppeteer's `dumpFrames`: each frame's URL, with its name when it has one, its children indented under it, with the
 * port normalized. Puppeteer's falls back to the frame element's `id` when the frame has no name; the frame tree has the
 * name and not the element's id.
 */
export const dumpFrames = (node: Page.FrameTree, indent = ""): ReadonlyArray<string> => {
  const name = Option.getOrElse(node.name, () => "")
  return [
    indent + String(node.url).replace(/:\d{4,5}\//, ":<PORT>/") + (name === "" ? "" : ` (${name})`),
    ...node.children.flatMap((child) => dumpFrames(child, indent + "    "))
  ]
}

/**
 * Puppeteer's `html` template tag (`test/src/utils.ts`) as a function of the body: the body inside a document with a
 * doctype, charset, viewport meta, and the title `My test page`, as the original's goldens were rendered with.
 */
export const html = (body: string) =>
  `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>My test page</title>
  </head>
  <body>
    ${body}
  </body>
</html>`
