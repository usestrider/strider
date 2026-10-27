/**
 * Instants on the real monotonic clock, used for deadlines and event timestamps.
 *
 * Neither `TestClock` nor a page's clock (`PageClock`) moves them, so a test's virtual time never moves the
 * browser's deadlines.
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
 * **Example** (Measuring the time between a request and its response)
 *
 * ```ts import.meta.vitest
 * import { NetworkRequest, NetworkResponse } from "@usestrider/browser"
 * import { Duration } from "effect"
 *
 * declare const request: NetworkRequest.NetworkRequest
 * declare const response: NetworkResponse.NetworkResponse
 *
 * const latency = Duration.millis((response.at - request.at) / 1e6)
 * ```
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type MonotonicInstant = typeof MonotonicInstant.Type
