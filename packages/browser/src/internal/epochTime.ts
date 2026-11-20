/**
 * A time a browser reports since the Unix epoch, as a `DateTime.Utc`, to the millisecond. Chromium and Firefox report
 * milliseconds, Chromium with a fraction; stock WebKit reports seconds with a fraction.
 */
import * as DateTime from "effect/DateTime"

/** A time in milliseconds since the epoch, without its fraction of a millisecond. */
export const fromMillis = (millis: number): DateTime.Utc => DateTime.makeUnsafe(Math.floor(millis))

/** A time in seconds since the epoch. Rounding to the microsecond first keeps `1.001` from reading as 1000 ms. */
export const fromSeconds = (seconds: number): DateTime.Utc =>
  DateTime.makeUnsafe(Math.floor(Math.round(seconds * 1_000_000) / 1000))
