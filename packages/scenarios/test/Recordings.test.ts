import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { afterEach, beforeEach, expect, it } from "vitest"
import * as Recordings from "../src/recordings.ts"

let directory: string
beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "scenario-store-"))
})
afterEach(() => fs.rmSync(directory, { recursive: true, force: true }))

const file = (name: string) => path.join(directory, `${name}.har`)
const bytes = (text: string) => new TextEncoder().encode(text)
const fakeStore = (objects: Record<string, Uint8Array> = {}) => {
  const puts: Array<string> = []
  const gets: Array<string> = []
  const store: Recordings.Store = {
    get: async (key) => {
      gets.push(key)
      return objects[key]
    },
    put: async (key, body) => {
      puts.push(key)
      objects[key] = body
    }
  }
  return { store, puts, gets, objects }
}
const entry = (name: string, text: string) => ({
  name,
  sha256: Recordings.sha256(bytes(text)),
  size: bytes(text).length
})

it("fetches a missing recording by its hash and writes it", async () => {
  const { store, gets } = fakeStore({ [Recordings.keyOf(entry("a", "one").sha256)]: bytes("one") })
  const result = await Recordings.ensure(["a"], { manifest: { recordings: [entry("a", "one")] }, file, store })
  expect(result.unavailable.size).toBe(0)
  expect(fs.readFileSync(file("a"), "utf8")).toBe("one")
  expect(gets).toEqual([Recordings.keyOf(entry("a", "one").sha256)])
})

it("keeps a recording that matches and never asks the store", async () => {
  fs.writeFileSync(file("a"), "one")
  const { store, gets } = fakeStore()
  await Recordings.ensure(["a"], { manifest: { recordings: [entry("a", "one")] }, file, store })
  expect(gets).toEqual([])
})

it("replaces a local file that differs when there is a store", async () => {
  fs.writeFileSync(file("a"), "stale")
  const { store } = fakeStore({ [Recordings.keyOf(entry("a", "one").sha256)]: bytes("one") })
  await Recordings.ensure(["a"], { manifest: { recordings: [entry("a", "one")] }, file, store })
  expect(fs.readFileSync(file("a"), "utf8")).toBe("one")
})

it("fails naming the file when the fetched bytes don't match the manifest", async () => {
  const { store } = fakeStore({ [Recordings.keyOf(entry("a", "one").sha256)]: bytes("tampered") })
  await expect(Recordings.ensure(["a"], { manifest: { recordings: [entry("a", "one")] }, file, store }))
    .rejects.toThrow(new RegExp(`${file("a")}.*doesn't match recordings.json`))
  expect(fs.existsSync(file("a"))).toBe(false)
})

it("fails naming the file when a local file differs and there are no credentials", async () => {
  fs.writeFileSync(file("a"), "stale")
  await expect(
    Recordings.ensure(["a"], { manifest: { recordings: [entry("a", "one")] }, file, store: undefined })
  ).rejects.toThrow(new RegExp(`${file("a")} doesn't match recordings.json`))
})

it("reports a missing recording as unavailable, with the reason, when there are no credentials", async () => {
  const result = await Recordings.ensure(["a"], {
    manifest: { recordings: [entry("a", "one")] },
    file,
    store: undefined
  })
  expect([...result.unavailable.keys()]).toEqual(["a"])
  expect(result.unavailable.get("a")).toContain("STRIDER_RECORDINGS_ACCESS_KEY_ID")
})

it("uploads each recording under its hash and records name, hash and size", async () => {
  fs.writeFileSync(file("a"), "one")
  const { store, puts, objects } = fakeStore()
  const manifest = await Recordings.upload(["a"], { manifest: { recordings: [entry("b", "two")] }, file, store })
  expect(puts).toEqual([Recordings.keyOf(entry("a", "one").sha256)])
  expect(Recordings.sha256(objects[puts[0]!]!)).toBe(entry("a", "one").sha256)
  expect(manifest.recordings).toEqual([entry("b", "two"), entry("a", "one")])
  const written = path.join(directory, "recordings.json")
  Recordings.writeManifest(manifest, written)
  expect(Recordings.readManifest(written).recordings.map((recording) => recording.name)).toEqual(["a", "b"])
})

it("reads credentials from the environment, and only when all four are set", () => {
  expect(Recordings.storeFromEnvironment({})).toBeUndefined()
  expect(Recordings.storeFromEnvironment({ STRIDER_RECORDINGS_BUCKET: "b" })).toBeUndefined()
  expect(
    Recordings.storeFromEnvironment({
      STRIDER_RECORDINGS_ACCOUNT_ID: "acct",
      STRIDER_RECORDINGS_BUCKET: "b",
      STRIDER_RECORDINGS_ACCESS_KEY_ID: "id",
      STRIDER_RECORDINGS_SECRET_ACCESS_KEY: "secret"
    })
  ).toBeDefined()
})

it("signs R2 requests with SigV4 against the account's endpoint", async () => {
  const seen: Array<{ url: string; init: RequestInit }> = []
  const store = Recordings.r2Store(
    { accountId: "acct", bucket: "b", accessKeyId: "id", secretAccessKey: "secret" },
    (async (url: string, init: RequestInit) => {
      seen.push({ url, init })
      return new Response(init.method === "GET" ? "x" : null, { status: init.method === "GET" ? 404 : 200 })
    }) as unknown as typeof fetch
  )
  expect(await store.get("sha256/abc")).toBeUndefined()
  await store.put("sha256/abc", bytes("x"))
  expect(seen.map((request) => request.url)).toEqual(
    Array(2).fill("https://acct.r2.cloudflarestorage.com/b/sha256/abc")
  )
  expect((seen[0]!.init.headers as Record<string, string>)["authorization"]).toMatch(
    /^AWS4-HMAC-SHA256 Credential=id\/\d{8}\/auto\/s3\/aws4_request, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/
  )
})
