/**
 * Instants on the real monotonic clock, used for deadlines and event timestamps.
 *
 * Instants come from the real clock even under `TestClock`, because a test's virtual time must not move the
 * browser's deadlines; a page's clock (`PageClock`) never moves them either.
 *
 * @stability unstable
 * @since 0.1.0
 */
import * as Schema from "effect/Schema"

/**
 * Schema for nanoseconds on the real monotonic clock.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const MonotonicInstant = Schema.Number.pipe(Schema.brand("~@usestrider/browser/MonotonicInstant"))

/**
 * Nanoseconds on the real monotonic clock; never `TestClock` time.
 *
 * **Details**
 *
 * Instants order events and measure elapsed time. They are not wall-clock times: use `DateTime` for those,
 * as `NetworkConnection.openedAt` does.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type MonotonicInstant = typeof MonotonicInstant.Type
