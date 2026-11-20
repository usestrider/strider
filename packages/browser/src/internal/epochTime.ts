/**
 * A time a browser reports since the Unix epoch, as a `DateTime.Utc`, to the millisecond. Chromium and Firefox report
 * milliseconds, Chromium with a fraction; stock WebKit reports seconds with a fraction.
 */
import * as DateTime from "effect/DateTime"

/** A time in milliseconds since the epoch, without its fraction of a millisecond. */
export const fromMillis = (millis: number): DateTime.Utc => DateTime.makeUnsafe(Math.floor(millis))

/**
 * A time in seconds since the epoch, without its fraction of a millisecond. It reads the decimal the browser sent,
 * which `String` gives back exactly, and drops the digits past the third after the point: multiplying by 1000 instead
 * reads `1.001` as `1000.9999999999999`, and rounding that moves a time just below a millisecond into the next one.
 */
export const fromSeconds = (seconds: number): DateTime.Utc => {
  const [mantissa = "", exponent = "0"] = Math.abs(seconds).toString().split("e")
  const [whole = "", fraction = ""] = mantissa.split(".")
  const digits = whole + fraction
  // Where the point falls in `digits` once the value is in milliseconds
  const point = whole.length + Number(exponent) + 3
  const kept = point <= 0 ? "0" : digits.slice(0, point).padEnd(point, "0")
  const dropped = point <= 0 ? digits : digits.slice(Math.max(point, 0))
  const millis = Number(kept)
  // Below zero, dropping digits moves toward zero, so the millisecond the time is in is the one before
  return DateTime.makeUnsafe(
    seconds < 0 ? -millis - (/[1-9]/.test(dropped) ? 1 : 0) : millis
  )
}
