/** The areas API.md only named or didn't cover, sketched here for the first time. */
import { Config, Console, Effect, Option, Stream } from "effect"
import {
  BrowserWorker, Chromium, Deadline, Deferred, Download, FileInput, NetworkConnection
} from "../src/index.ts"
import type { Page, Serialized } from "../src/index.ts"
import { BrowserToolkit, CapturePolicy } from "../src/ai.ts"
import { BrowserTest } from "../src/test.ts"
import { VitestBrowser } from "../src/test-vitest.ts"
import { expectType, type Equals } from "./_check.ts"

// Keyboard and mouse: held input is scoped, so a failed step never leaves Shift down
export const multiSelect = (page: Page) => Effect.gen(function* () {
  yield* Effect.scoped(Effect.gen(function* () {
    yield* page.keyboard.hold("Shift")
    yield* page.getByRole("option", { name: "Apples" }).click
    yield* page.getByRole("option", { name: "Pears" }).click
  }))                                                   // Shift released here, or on failure or interruption
  yield* page.mouse.click({ x: 120, y: 80 })            // coordinates, for canvas-like UIs
  yield* page.keyboard.press("Enter")
})

// Frames are entered by their element, lazily, like any locator
export const frames = (page: Page) => Effect.gen(function* () {
  const payment = page.frame(page.locator("iframe#payment"))
  yield* payment.getByLabel("Card number").fill("4242 4242 4242 4242")
  yield* payment.getByRole("button", { name: "Pay" }).click
  const tree = yield* page.frames                       // the frame tree, as state
  return tree.children.length
})

// Cookies, localStorage and uploads
export const storage = (page: Page) => Effect.gen(function* () {
  const sent = yield* page.context.cookies.listFor("https://app.example.com")   // what a request would send
  yield* page.context.cookies.set({ name: "beta", value: "1", scope: { _tag: "Url", url: "https://app.example.com" } })
  const theme = yield* page.localStorage.get("theme")
  yield* page.localStorage.set("theme", "dark")
  yield* page.getByLabel("Avatar").setInputFiles(FileInput.local("./avatar.png"))
  return { cookies: sent.length, theme: Option.getOrElse(theme, () => "light") }
})

// Emulation is a scoped declaration; creation options hold the same settings for the context's life
export const emulation = (page: Page) => Effect.gen(function* () {
  yield* page.emulate({ media: { colorScheme: "dark" }, network: "offline" })
  yield* page.reload
  yield* page.context.grant(["geolocation"], { origin: "https://maps.example.com" })
})

// Workers and WebSocket frames
export const workersAndSockets = (page: Page) => Effect.gen(function* () {
  const worker = yield* BrowserWorker.next(page)
  const socket = yield* NetworkConnection.next(page, { kind: "webSocket", url: "wss://chat.example.com/**" })
  yield* page.getByRole("button", { name: "Start sync" }).click
  const syncWorker = yield* Deferred.await(worker)      // a BrowserWorker: the page is controlled
  const count = yield* syncWorker.evaluate(() => 42)
  const chat = yield* Deferred.await(socket)
  const chatFrames = yield* chat.frames
  yield* chatFrames.pipe(Stream.take(3), Stream.runForEach((frame) => Console.log(frame.direction)))
  return count
})

// Reads, capture and evaluation: the result type is what actually arrives
export const reads = (page: Page) => Effect.gen(function* () {
  const html = yield* page.readHtml
  const buttonHtml = yield* page.getByRole("button", { name: "Save" }).readHtml
  const pdf = yield* page.pdfWith({ paper: "a4", landscape: true, background: true })
  const when = yield* page.evaluate(() => new Date())   // Date survives the crossing
  expectType<Equals<typeof when, Date>>(true)
  class Point { constructor(readonly x: number) {} norm() { return Math.abs(this.x) } }
  const point = yield* page.evaluate(() => new Point(3))   // a class instance arrives as its data
  expectType<Equals<typeof point, Serialized<Point>>>(true)
  const body = yield* page.evaluateHandle(() => document.body)   // a DOM node needs a handle
  const tag = yield* body.evaluate((element) => element.tagName)
  const main = yield* page.evaluateWith({ world: "main" }, () => (globalThis as { readonly appVersion?: string }).appVersion)
  return { html, buttonHtml, size: pdf.length, tag, main, x: point.x }
})

// Deadlines: a shared budget for a block, a different default budget for a program
export const deadlines = (page: Page) => Effect.gen(function* () {
  const report = yield* Download.next(page).pipe(Deadline.within("2 minutes"))
  yield* page.getByText("Export").click
  yield* Deferred.await(report)
  const left = yield* Deadline.remaining
  return left
}).pipe(Deadline.withDefaultBudget("1 minute"))

// The agent toolkit works in a context; every tool names its page
export const toolkit = (page: Page) => Effect.gen(function* () {
  return yield* BrowserToolkit.make({
    context: page.context,
    secrets: { password: yield* Config.Redacted("PASSWORD") },
    capture: CapturePolicy.strict
  })
})

// Tests: nothing changes because it's a test; the layer launches exactly what you pass
export const testProgram = Effect.gen(function* () {
  const page = yield* BrowserTest.pageWith({ focus: "emulated" })
  yield* page.goto("/shop")
}).pipe(Effect.scoped, Effect.provide(VitestBrowser.layer(Chromium.launchWith({ headless: true }))))
