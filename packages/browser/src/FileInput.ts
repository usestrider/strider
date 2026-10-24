/**
 * Files to upload, saying where their bytes come from.
 *
 * Which machine a path is on is always stated, because a browser on a remote grid can't read your local
 * paths and you can't read its. A plain string is not accepted for this reason.
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
 * The file is read here and uploaded when the browser is remote. A relative path is resolved against the
 * working directory with Effect's `Path`, which the browser's layer needs for it.
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
 * @stability unstable
 * @category constructors
 * @since 0.1.0
 */
export declare const bytes: (name: FileName | string, mimeType: MimeType | string, data: Uint8Array) => FileInput

/**
 * Checks whether a value is a `FileInput`.
 *
 * @stability unstable
 * @category guards
 * @since 0.1.0
 */
export const isFileInput = (u: unknown): u is FileInput => Predicate.hasProperty(u, TypeId)
