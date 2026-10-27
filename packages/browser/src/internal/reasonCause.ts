/**
 * The `cause` a module error lifts from its reason, as Effect's `SocketError` does, so `Cause.pretty` and loggers
 * show the failure beneath a reason such as `BackendFailure`. A getter rather than a constructor argument: a
 * Schema class's constructor keeps only its fields, so a `cause` passed beside them is dropped.
 */
export const of = (reason: object): unknown => ("cause" in reason ? reason.cause : undefined)
