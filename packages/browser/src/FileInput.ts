/**
 * Files to upload, each saying where its bytes come from.
 *
 * `local` reads a file on this machine, `remote` names one on the browser's machine, and `bytes` makes one from
 * data you already have. Which machine a path is on is always stated, because a browser on a remote grid can't read
 * your local paths, and you can't read its; that's why a plain string isn't accepted.
 *
 * @stability unstable
 * @since 0.1.0
 */
import * as Predicate from "effect/Predicate"
import * as Schema from "effect/Schema"
import type * as FilePath from "./FilePath.ts"
import * as FileInputImpl from "./internal/fileInput.ts"

/**
 * Schema for a file name, such as a download's suggested name.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const FileName = Schema.String.pipe(Schema.brand("~@usestrider/browser/FileInput/FileName"))

/**
 * A file name, without a directory.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type FileName = typeof FileName.Type

/**
 * Schema for a MIME type, such as `text/csv`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const MimeType = Schema.String.pipe(Schema.brand("~@usestrider/browser/FileInput/MimeType"))

/**
 * A MIME type, such as `text/csv`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type MimeType = typeof MimeType.Type

const TypeId = "~@usestrider/browser/FileInput"

/**
 * A file to upload, with where its bytes come from.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface FileInput {
  readonly [TypeId]: typeof TypeId
}

/**
 * Creates a file input from a path on this machine.
 *
 * **Details**
 *
 * The browser is given the path and reads the file itself, so it must see this machine's files, as a launched
 * browser does; for one that doesn't, use `bytes`. A relative path is resolved against the working directory with
 * Effect's `Path`, so the browser's layer must be built with `Path` to accept one.
 *
 * **Example** (Uploading an avatar)
 *
 * ```ts import.meta.vitest
 * import { Effect } from "effect"
 * import { FileInput, Page } from "@usestrider/browser"
 *
 * const upload = Effect.fn("upload")(function*(page: Page.Page) {
 *   yield* page.getByLabel("Avatar").setInputFiles(FileInput.local("./avatar.png"))
 * })
 * ```
 *
 * @see {@link remote} for a file already on the browser's host
 *
 * @stability unstable
 * @category constructors
 * @since 0.1.0
 */
export const local = (path: FilePath.Local | string): FileInput => FileInputImpl.make({ _tag: "Local", path })

/**
 * Creates a file input from a path on the browser's host.
 *
 * @see {@link local} for a file on this machine
 *
 * @stability unstable
 * @category constructors
 * @since 0.1.0
 */
export const remote = (path: FilePath.Remote): FileInput => FileInputImpl.make({ _tag: "Remote", path })

/**
 * Creates a file input from bytes in memory.
 *
 * **Details**
 *
 * The file is made in the page: its bytes are copied into the isolated world `page.evaluate` runs in and become a
 * `File`, which is set on the input through a `DataTransfer`, with `input` and `change` dispatched as when a user
 * chooses files. It keeps its MIME type and needs no file system shared with the browser, so it works with a
 * browser on another machine too.
 *
 * **Gotchas**
 *
 * One call takes files that are all bytes or all paths: the browser sets files from paths and the page makes
 * them from bytes, each replacing the other's, so a mix fails with `InvalidInput`.
 *
 * **Example** (Uploading a generated report)
 *
 * ```ts import.meta.vitest
 * import { Effect } from "effect"
 * import { FileInput, Page } from "@usestrider/browser"
 *
 * const uploadCsv = Effect.fn("uploadCsv")(function*(page: Page.Page, rows: ReadonlyArray<string>) {
 *   const csv = new TextEncoder().encode(rows.join("\n"))
 *   yield* page.getByLabel("Report").setInputFiles(FileInput.bytes("report.csv", "text/csv", csv))
 * })
 * ```
 *
 * @see {@link local} for a file on this machine
 *
 * @stability unstable
 * @category constructors
 * @since 0.1.0
 */
export const bytes = (name: FileName | string, mimeType: MimeType | string, data: Uint8Array): FileInput =>
  FileInputImpl.make({ _tag: "Bytes", name, mimeType, data })

/**
 * Checks whether a value is a `FileInput`.
 *
 * @stability unstable
 * @category guards
 * @since 0.1.0
 */
export const isFileInput = (u: unknown): u is FileInput => Predicate.hasProperty(u, TypeId)
