/**
 * File paths, branded by which machine they're on.
 *
 * When the browser runs elsewhere, such as on a remote grid or in a container, a path means different things on
 * each side. `Local` is on the machine running your program, and `Remote` is on the browser's machine. The two are
 * never interchangeable, which is why `FileInput.local` and `FileInput.remote` are separate constructors.
 *
 * @stability unstable
 * @since 0.1.0
 */
import * as Schema from "effect/Schema"

/**
 * Schema for a path on the machine running your program.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const Local = Schema.String.pipe(Schema.brand("~@usestrider/browser/FilePath/Local"))

/**
 * A path on the machine running your program.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type Local = typeof Local.Type

/**
 * Schema for a path on the browser's host.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const Remote = Schema.String.pipe(Schema.brand("~@usestrider/browser/FilePath/Remote"))

/**
 * A path on the browser's host; never interchangeable with a local path.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type Remote = typeof Remote.Type
