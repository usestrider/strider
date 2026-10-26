/**
 * The Worker domain.
 *
 * Generated from the WebKit inspector protocol as WebKit ships it, WebKitGTK 2.54.1. Don't edit: correct the model (`packages/tools/codegen/protocols/webkit`) and run `pnpm codegen:protocol`.
 *
 * @stability unstable
 * @since 0.1.0
 */
import * as Schema from "effect/Schema"
import * as Protocol from "../protocol/Protocol.ts"

/**
 * `dispatchMessageFromWorker.Params`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface DispatchMessageFromWorkerParams {
  readonly workerId: string
  /**
   * JSON Inspector Protocol message (response or event) to be dispatched on the frontend.
   */
  readonly message: string
}

/**
 * Schema for `DispatchMessageFromWorkerParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const DispatchMessageFromWorkerParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    workerId: Schema.String,
    message: Schema.String
  }).annotate({ identifier: "Worker.DispatchMessageFromWorkerParams" })
) as any as Schema.Codec<DispatchMessageFromWorkerParams>

/**
 * Sent after the frontend has sent all initialization messages and can resume this worker. This command is required to allow execution in the worker.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface InitializedParams {
  readonly workerId: string
}

/**
 * Schema for `InitializedParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const InitializedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    workerId: Schema.String
  }).annotate({ identifier: "Worker.InitializedParams" })
) as any as Schema.Codec<InitializedParams>

/**
 * Send an Inspector Protocol message to be dispatched to a Worker's agents.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface SendMessageToWorkerParams {
  readonly workerId: string
  /**
   * JSON Inspector Protocol message (command) to be dispatched on the backend.
   */
  readonly message: string
}

/**
 * Schema for `SendMessageToWorkerParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SendMessageToWorkerParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    workerId: Schema.String,
    message: Schema.String
  }).annotate({ identifier: "Worker.SendMessageToWorkerParams" })
) as any as Schema.Codec<SendMessageToWorkerParams>

/**
 * `workerCreated.Params`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface WorkerCreatedParams {
  readonly workerId: string
  readonly url: string
  readonly name: string
}

/**
 * Schema for `WorkerCreatedParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const WorkerCreatedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    workerId: Schema.String,
    url: Schema.String,
    name: Schema.String
  }).annotate({ identifier: "Worker.WorkerCreatedParams" })
) as any as Schema.Codec<WorkerCreatedParams>

/**
 * `workerTerminated.Params`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface WorkerTerminatedParams {
  readonly workerId: string
}

/**
 * Schema for `WorkerTerminatedParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const WorkerTerminatedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    workerId: Schema.String
  }).annotate({ identifier: "Worker.WorkerTerminatedParams" })
) as any as Schema.Codec<WorkerTerminatedParams>

/**
 * Disable Worker domain events.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const disable: Protocol.CommandDef<"Worker.disable", void, void> = /*#__PURE__*/ Protocol.command(
  "Worker.disable",
  undefined,
  undefined,
  { status: "stable" }
)

/**
 * Enable Worker domain events.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const enable: Protocol.CommandDef<"Worker.enable", void, void> = /*#__PURE__*/ Protocol.command(
  "Worker.enable",
  undefined,
  undefined,
  { status: "stable" }
)

/**
 * Sent after the frontend has sent all initialization messages and can resume this worker. This command is required to allow execution in the worker.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const initialized: Protocol.CommandDef<"Worker.initialized", InitializedParams, void> = /*#__PURE__*/ Protocol
  .command(
    "Worker.initialized",
    InitializedParams,
    undefined,
    { status: "stable" }
  )

/**
 * Send an Inspector Protocol message to be dispatched to a Worker's agents.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const sendMessageToWorker: Protocol.CommandDef<"Worker.sendMessageToWorker", SendMessageToWorkerParams, void> =
  /*#__PURE__*/ Protocol.command(
    "Worker.sendMessageToWorker",
    SendMessageToWorkerParams,
    undefined,
    { status: "stable" }
  )

/**
 * The `Worker.dispatchMessageFromWorker` event.
 *
 * @stability unstable
 * @category events
 * @since 0.1.0
 */
export const dispatchMessageFromWorker: Protocol.EventDef<
  "Worker.dispatchMessageFromWorker",
  DispatchMessageFromWorkerParams
> = /*#__PURE__*/ Protocol.event(
  "Worker.dispatchMessageFromWorker",
  DispatchMessageFromWorkerParams,
  { status: "stable" }
)

/**
 * The `Worker.workerCreated` event.
 *
 * @stability unstable
 * @category events
 * @since 0.1.0
 */
export const workerCreated: Protocol.EventDef<"Worker.workerCreated", WorkerCreatedParams> = /*#__PURE__*/ Protocol
  .event(
    "Worker.workerCreated",
    WorkerCreatedParams,
    { status: "stable" }
  )

/**
 * The `Worker.workerTerminated` event.
 *
 * @stability unstable
 * @category events
 * @since 0.1.0
 */
export const workerTerminated: Protocol.EventDef<"Worker.workerTerminated", WorkerTerminatedParams> =
  /*#__PURE__*/ Protocol.event(
    "Worker.workerTerminated",
    WorkerTerminatedParams,
    { status: "stable" }
  )
