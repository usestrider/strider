/**
 * The public demo sites' recordings hold the sites' own files, which this public repository mustn't redistribute, so
 * they live in a private R2 bucket, each under its SHA-256, and `recordings.json` commits only each one's name, hash
 * and size. A run fetches what is missing or different from the bucket and checks it against the manifest; without
 * the bucket's credentials, the scenarios that need a recording are skipped, saying why.
 */
import * as Schema from "effect/Schema"
import * as crypto from "node:crypto"
import * as fs from "node:fs"
import * as path from "node:path"

export const Manifest = Schema.Struct({
  recordings: Schema.Array(
    Schema.Struct({ name: Schema.String, sha256: Schema.String, size: Schema.Number })
  )
})
export type Manifest = typeof Manifest.Type

/** Where the manifest is committed */
export const manifestPath = path.join(import.meta.dirname, "../recordings.json")

export const readManifest = (file: string = manifestPath): Manifest =>
  fs.existsSync(file)
    ? Schema.decodeUnknownSync(Manifest)(JSON.parse(fs.readFileSync(file, "utf8")))
    : { recordings: [] }

export const writeManifest = (manifest: Manifest, file: string = manifestPath): void =>
  fs.writeFileSync(
    file,
    `${
      JSON.stringify(
        { recordings: [...manifest.recordings].sort((a, b) => a.name.localeCompare(b.name)) },
        null,
        2
      )
    }\n`
  )

/** The object store the recordings live in: bytes by key, `undefined` for a key it doesn't hold */
export interface Store {
  readonly get: (key: string) => Promise<Uint8Array | undefined>
  readonly put: (key: string, body: Uint8Array) => Promise<void>
}

export const sha256 = (bytes: Uint8Array): string => crypto.createHash("sha256").update(bytes).digest("hex")

/** A recording's object key: its hash, so an object never changes and a refresh never overwrites another's */
export const keyOf = (hash: string): string => `sha256/${hash}`

/** The environment variables the credentials come from */
export const credentialNames = [
  "STRIDER_RECORDINGS_ACCOUNT_ID",
  "STRIDER_RECORDINGS_BUCKET",
  "STRIDER_RECORDINGS_ACCESS_KEY_ID",
  "STRIDER_RECORDINGS_SECRET_ACCESS_KEY"
] as const

const hmac = (key: crypto.BinaryLike | crypto.KeyObject, data: string) =>
  crypto.createHmac("sha256", key).update(data).digest()

/** The R2 bucket over its S3 API, requests signed with AWS Signature Version 4 */
export const r2Store = (
  options: { accountId: string; bucket: string; accessKeyId: string; secretAccessKey: string },
  fetcher: typeof fetch = fetch
): Store => {
  const host = `${options.accountId}.r2.cloudflarestorage.com`
  const request = async (method: "GET" | "PUT", key: string, body?: Uint8Array) => {
    const stamp = new Date().toISOString().replace(/[-:]|\.\d{3}/g, "")
    const day = stamp.slice(0, 8)
    const uri = `/${options.bucket}/${key}`
    const payload = sha256(body ?? new Uint8Array())
    const headers = `host:${host}\nx-amz-content-sha256:${payload}\nx-amz-date:${stamp}\n`
    const signed = "host;x-amz-content-sha256;x-amz-date"
    const scope = `${day}/auto/s3/aws4_request`
    const canonical = `${method}\n${uri}\n\n${headers}\n${signed}\n${payload}`
    const toSign = `AWS4-HMAC-SHA256\n${stamp}\n${scope}\n${
      crypto.createHash("sha256").update(canonical).digest("hex")
    }`
    const signingKey = hmac(hmac(hmac(hmac(`AWS4${options.secretAccessKey}`, day), "auto"), "s3"), "aws4_request")
    const signature = crypto.createHmac("sha256", signingKey).update(toSign).digest("hex")
    return fetcher(`https://${host}${uri}`, {
      method,
      body: (body ?? null) as BodyInit | null,
      headers: {
        "x-amz-content-sha256": payload,
        "x-amz-date": stamp,
        authorization:
          `AWS4-HMAC-SHA256 Credential=${options.accessKeyId}/${scope}, SignedHeaders=${signed}, Signature=${signature}`
      }
    })
  }
  return {
    get: async (key) => {
      const response = await request("GET", key)
      if (response.status === 404) return undefined
      if (!response.ok) throw new Error(`Fetching ${key} from the recordings bucket failed: HTTP ${response.status}`)
      return new Uint8Array(await response.arrayBuffer())
    },
    put: async (key, body) => {
      const response = await request("PUT", key, body)
      if (!response.ok) throw new Error(`Uploading ${key} to the recordings bucket failed: HTTP ${response.status}`)
    }
  }
}

/** The bucket the environment's credentials open, or `undefined` when any of them is missing */
export const storeFromEnvironment = (env: Record<string, string | undefined> = process.env): Store | undefined => {
  const [accountId, bucket, accessKeyId, secretAccessKey] = credentialNames.map((name) => env[name])
  return accountId && bucket && accessKeyId && secretAccessKey
    ? r2Store({ accountId, bucket, accessKeyId, secretAccessKey })
    : undefined
}

export interface Ensured {
  /** Recordings that can't be had, by name, each with the reason */
  readonly unavailable: ReadonlyMap<string, string>
}

const hashOf = (file: string): string | undefined => fs.existsSync(file) ? sha256(fs.readFileSync(file)) : undefined

/**
 * Make each named recording the manifest's: kept when its file already matches, fetched by its hash otherwise.
 * Throws naming the file when a fetched recording doesn't match its hash, or when a file differs and there's no store
 * to replace it from. A recording that is missing and can't be fetched is `unavailable`, with the reason.
 */
export const ensure = async (
  names: ReadonlyArray<string>,
  options: {
    readonly manifest: Manifest
    readonly file: (name: string) => string
    readonly store: Store | undefined
  }
): Promise<Ensured> => {
  const unavailable = new Map<string, string>()
  for (const name of names) {
    const file = options.file(name)
    const entry = options.manifest.recordings.find((candidate) => candidate.name === name)
    if (entry === undefined) {
      throw new Error(
        `Recording ${name} is not in recordings.json: run \`pnpm scenarios --record\` to record and upload it`
      )
    }
    const present = hashOf(file)
    if (present === entry.sha256) continue
    if (options.store === undefined) {
      if (present !== undefined) {
        throw new Error(
          `Recording ${file} doesn't match recordings.json (sha256 ${present}, expected ${entry.sha256}). ` +
            `Delete it, or set ${credentialNames.join(", ")} to fetch the committed one`
        )
      }
      unavailable.set(
        name,
        `recording ${name} is not in .data/scenarios/ and no credentials for the recordings bucket are set (${
          credentialNames.join(", ")
        })`
      )
      continue
    }
    const bytes = await options.store.get(keyOf(entry.sha256))
    if (bytes === undefined) {
      throw new Error(`Recording ${name} (sha256 ${entry.sha256}) is not in the recordings bucket`)
    }
    const fetched = sha256(bytes)
    if (fetched !== entry.sha256 || bytes.byteLength !== entry.size) {
      throw new Error(
        `Recording ${file} fetched from the recordings bucket doesn't match recordings.json (sha256 ${fetched}, size ${bytes.byteLength}; expected ${entry.sha256}, size ${entry.size})`
      )
    }
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, bytes)
  }
  return { unavailable }
}

/** Upload each named recording under its hash, and record its name, hash and size in the manifest */
export const upload = async (
  names: ReadonlyArray<string>,
  options: {
    readonly manifest: Manifest
    readonly file: (name: string) => string
    readonly store: Store
  }
): Promise<Manifest> => {
  const entries = new Map(options.manifest.recordings.map((entry) => [entry.name, entry]))
  for (const name of names) {
    const bytes = fs.readFileSync(options.file(name))
    const hash = sha256(bytes)
    await options.store.put(keyOf(hash), bytes)
    entries.set(name, { name, sha256: hash, size: bytes.byteLength })
  }
  return { recordings: [...entries.values()] }
}
