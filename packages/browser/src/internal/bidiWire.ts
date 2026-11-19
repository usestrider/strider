/**
 * WebDriver BiDi's wire: the JSON envelope, and the error table.
 *
 * Commands are `{ id, method, params }`, and `params` is required even when empty. Replies are
 * `{ type: "success", id, result }` or `{ type: "error", id, error, message, stacktrace }`; events are
 * `{ type: "event", method, params }`. There is one session per connection, and nothing on the wire routes an
 * event to a context, so every event belongs to the root session and the adapter routes it by its parameters.
 */
import * as Result from "effect/Result"
import { type ErrorMatcher, type Incoming, parseRecord, type Wire } from "./protocolClient.ts"

const spec = "WebDriver BiDi §Errors, w3c/webdriver-bidi f922e6a"
const recorded = "Firefox 158.0, recorded 2026-10-20; checked by test/integration/Firefox.test.ts"

/**
 * BiDi's error table. The spec names every error code, so rows match the code alone; a code the table doesn't
 * know is `Unrecognized`, as are those no `RejectReason` fits (`no such history entry`, `no such network data`).
 * Firefox reports a command it doesn't implement as `unknown command`, and an argument it doesn't implement as
 * `unsupported operation`; both are `Unsupported`. Firefox also answers `unsupported operation` to a navigation to a
 * URL it won't load, such as one with a scheme it has no handler for: that is the URL refused, not a gap in the
 * browser, so the command's navigation fails like any other it never started.
 */
export const errors: ReadonlyArray<ErrorMatcher> = [
  {
    match: { code: "unknown command" },
    becomes: { _tag: "Unsupported" },
    evidence:
      `${spec}: "unknown command"; "Nope.nothing", and emulation.setMediaFeaturesOverride, which Firefox doesn't implement, ${recorded}`
  },
  {
    match: { code: "unsupported operation" },
    becomes: { _tag: "Unsupported" },
    evidence:
      `${spec}: "unsupported operation"; browsingContext.reload with ignoreCache, "Argument "ignoreCache" is not supported yet.", ${recorded}`
  },
  {
    match: { code: "unsupported operation", message: { includes: "is not allowed in this context" } },
    becomes: { _tag: "Rejected", reason: "InvalidArgument" },
    evidence:
      `${spec}: "unsupported operation"; browsingContext.navigate to nosuchscheme:x, "Navigation to "nosuchscheme:x" is not allowed in this context", ${recorded}`
  },
  {
    match: { code: "invalid argument" },
    becomes: { _tag: "Rejected", reason: "InvalidArgument" },
    evidence: `${spec}: "invalid argument"; browsingContext.navigate without a url, ${recorded}`
  },
  {
    match: { code: "no such frame" },
    becomes: { _tag: "Rejected", reason: "NoSuchFrame" },
    evidence: `${spec}: "no such frame"; browsingContext.navigate to an unknown context, ${recorded}`
  },
  {
    match: { code: "no such node" },
    becomes: { _tag: "Rejected", reason: "NoSuchNode" },
    evidence: `${spec}: "no such node"; script.callFunction with an unknown sharedId, ${recorded}`
  }
]

const incoming = (envelope: Record<string, unknown>): Result.Result<Incoming, string> => {
  switch (envelope.type) {
    case "success":
      if (typeof envelope.id !== "number") return Result.fail("a success without an id")
      return Result.succeed({ _tag: "Reply", id: envelope.id, result: envelope.result })
    case "error":
      if (typeof envelope.id !== "number") {
        // An error with no id answers a message the browser couldn't read: ours, so it's a bug here
        return Result.fail(
          `the browser couldn't read a message: ${String(envelope.error)} (${String(envelope.message)})`
        )
      }
      return Result.succeed({
        _tag: "ErrorReply",
        id: envelope.id,
        error: { code: String(envelope.error), message: String(envelope.message ?? "") }
      })
    case "event":
      if (typeof envelope.method !== "string") return Result.fail("an event without a method")
      return Result.succeed({ _tag: "Event", key: undefined, method: envelope.method, params: envelope.params })
    default:
      return Result.fail(`an envelope of type ${String(envelope.type)}`)
  }
}

export const wire: Wire = {
  encode: (id, method, params) => JSON.stringify({ id, method, params: params ?? {} }),
  decode: (message) => Result.flatMap(parseRecord(message), incoming),
  lifecycle: () => {},
  errors
}
