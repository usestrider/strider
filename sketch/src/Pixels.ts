/**
 * CSS pixels and device pixels, which differ by the device pixel ratio.
 *
 * Layout, positions and viewports are in CSS pixels. Screenshots and screencast frames are measured in device
 * pixels. Inputs that are always CSS pixels take a plain `number` as well.
 *
 * @stability unstable
 * @since 0.1.0
 */
import * as Schema from "effect/Schema"

/**
 * Schema for a length in CSS pixels.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const Css = Schema.Number.pipe(Schema.brand("~effect-browser/Pixels/Css"))

/**
 * A length in CSS pixels: layout units.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type Css = typeof Css.Type

/**
 * Schema for a length in device pixels.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const Device = Schema.Number.pipe(Schema.brand("~effect-browser/Pixels/Device"))

/**
 * A length in device pixels: CSS pixels times the device pixel ratio.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type Device = typeof Device.Type
