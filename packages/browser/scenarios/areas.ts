/** Call sites for the areas beyond the acceptance scenarios: input, frames, storage, workers, reads, tests. */
import { Browser, BrowserWorker, Deadline, Download, FileInput, NetworkConnection, Page } from "@usestrider/browser"
import { BrowserToolkit, CapturePolicy } from "@usestrider/browser/ai"
import { Chromium } from "@usestrider/browser/chromium"
import { VitestBrowser } from "@usestrider/browser/test/vitest"
import { Config, Console, Effect, Option, Stream } from "effect"

// Keyboard and mouse: held input is scoped, so a failed step never leaves Shift down
export const multiSelect = Effect.fn("multiSelect")(function*(page: Page.Page) {
  yield* Effect.scoped(Effect.gen(function*() {
    yield* page.keyboard.hold("Shift")
    yield* page.getByRole("option", { name: "Apples" }).click()
    yield* page.getByRole("option", { name: "Pears" }).click()
  })) // Shift released here, or on failure or interruption
  yield* page.mouse.click({ x: 120, y: 80 }) // coordinates, for canvas-like UIs
  yield* page.keyboard.press("Enter")
})

// Frames are entered by their element, lazily, like any locator
export const frames = Effect.fn("frames")(function*(page: Page.Page) {
  const payment = page.frame(page.locator("iframe#payment"))
  yield* payment.getByLabel("Card number").fill("4242 4242 4242 4242")
  yield* payment.getByRole("button", { name: "Pay" }).click()
  const tree = yield* page.frames // the frame tree, as state
  return tree.children.length
})

// Cookies, localStorage and uploads
export const storage = Effect.fn("storage")(function*(page: Page.Page) {
  const sent = yield* page.context.cookies.listFor("https://app.example.com") // what a request would send
  yield* page.context.cookies.set({ name: "beta", value: "1", scope: { _tag: "Url", url: "https://app.example.com" } })
  const theme = yield* page.localStorage.get("theme")
  yield* page.localStorage.set("theme", "dark")
  yield* page.getByLabel("Avatar").setInputFiles(FileInput.local("./avatar.png"))
  return { cookies: sent.length, theme: Option.getOrElse(theme, () => "light") }
})

// Emulation is a scoped declaration; creation options hold the same settings for the context's life
export const emulation = Effect.fn("emulation")(function*(page: Page.Page) {
  yield* page.emulate({ media: { colorScheme: "dark" }, network: "offline" })
  yield* page.reload()
  yield* page.context.grant(["geolocation"], { origin: "https://maps.example.com" })
})

// Workers and WebSocket frames
export const workersAndSockets = Effect.fn("workersAndSockets")(function*(page: Page.Page) {
  const worker = yield* BrowserWorker.next(page)
  const socket = yield* NetworkConnection.next(page, { kind: "webSocket", url: "wss://chat.example.com/*" })
  yield* page.getByRole("button", { name: "Start sync" }).click()
  const syncWorker = yield* worker // a BrowserWorker: the page is controlled
  const count = yield* syncWorker.evaluate(() => 42)
  const chat = yield* socket
  const chatFrames = yield* chat.frames
  yield* chatFrames.pipe(Stream.take(3), Stream.runForEach((frame) => Console.log(frame.direction)))
  return count
})

// Reads, capture and evaluation: the result type is what actually arrives
export const reads = Effect.fn("reads")(function*(page: Page.Page) {
  const html = yield* page.readHtml
  const buttonHtml = yield* page.getByRole("button", { name: "Save" }).readHtml
  const pdf = yield* page.pdf({ paper: "a4", landscape: true, background: true })
  const tree = yield* page.snapshot({ sources: "aria", interactiveOnly: true })
  const body = yield* page.evaluateHandle(() => document.body) // a DOM node needs a handle
  const tag = yield* body.evaluate((element) => element.tagName)
  const main = yield* page.evaluateInMainWorld(() => (globalThis as { readonly appVersion?: string }).appVersion)
  const opened = yield* page.evaluateInMainWorld(() => window.open("/help") !== null).pipe(Page.withUserGesture)
  return { html, buttonHtml, size: pdf.length, nodes: tree.refs.size, tag, main, opened }
})

// Deadlines: a shared budget for a block, a different default budget for a program
export const deadlines = Effect.fn("deadlines")(function*(page: Page.Page) {
  const report = yield* Download.next(page).pipe(Deadline.within("2 minutes"))
  yield* page.getByText("Export").click()
  yield* report
  return yield* Deadline.remaining
}, Deadline.withDefaultBudget("1 minute"))

// The agent toolkit works in a context; every tool names its page
export const toolkit = Effect.fn("toolkit")(function*(page: Page.Page) {
  return yield* BrowserToolkit.make({
    context: page.context,
    secrets: { password: yield* Config.Redacted("PASSWORD") },
    capture: CapturePolicy.strict
  })
})

// Tests: nothing changes because it's a test; the layer launches exactly what you pass
export const testProgram = Effect.scoped(Effect.gen(function*() {
  const page = yield* Browser.newPage({ focus: "emulated" })
  yield* page.goto("https://shop.example.com")
})).pipe(Effect.provide(VitestBrowser.layer(Chromium.layer({ executablePath: "/usr/bin/chromium" }))))

// Event and lifecycle tests run against the fake browser's timeline
export const fakeTimeline = Effect.scoped(Effect.gen(function*() {
  const page = yield* Browser.newPage()
  const cart = yield* Download.next(page)
  return yield* cart
})).pipe(Effect.provide(Browser.layerTest("--download(report)--|")))
