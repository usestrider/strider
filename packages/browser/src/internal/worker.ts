/**
 * A worker's handle: its realm, kind and URL, its end, and evaluation in it. Workers
 * have no isolated world, so evaluating in one needs control of its owner, which is why only a `Page` or a
 * `UserContext` hands one out.
 */
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Inspectable from "effect/Inspectable"
import * as Option from "effect/Option"
import { pipeArguments } from "effect/Pipeable"
import * as BrowserWorker from "../BrowserWorker.ts"
import type * as Deadline from "../Deadline.ts"
import type * as JSHandle from "../JSHandle.ts"
import * as Reason from "../Reason.ts"
import type * as Target from "../Target.ts"
import type * as Adapter from "./adapter.ts"
import * as Evaluation from "./evaluation.ts"
import { exception } from "./evaluation.ts"
import * as Filters from "./filters.ts"
import * as FunctionSource from "./functionSource.ts"
import type * as Model from "./model.ts"
import * as Operation from "./operation.ts"
import type * as Runtime from "./runtime.ts"

const TypeId = "~@usestrider/browser/BrowserWorker"

export const make = (runtime: Runtime.Runtime, entry: Model.WorkerEntry): BrowserWorker.BrowserWorker => {
  const failure = (reason: BrowserWorker.BrowserWorkerErrorReason, id = Operation.idNow()) =>
    new BrowserWorker.BrowserWorkerError({ reason, diagnostics: Operation.diagnostics(id) })

  /** Calls `fn` in the worker's realm: its result by value, or as a handle in the caller's scope. */
  const run = <B, R>(
    operation: string,
    fn: Function,
    args: ReadonlyArray<unknown>,
    result: "value" | "handle",
    then: (value: Adapter.RemoteValue) => Effect.Effect<B, Evaluation.Failure, R>
  ): Effect.Effect<B, BrowserWorker.BrowserWorkerError | Target.TargetGone | Deadline.Timeout, R> =>
    Effect.gen(function*() {
      const record = yield* Operation.record
      const id = record.id
      yield* Filters.requires(runtime, operation, "workers.evaluate").pipe(
        Effect.mapError((error) => failure(error.reason as Reason.Unsupported, id))
      )
      const fromFailure = (cause: Evaluation.Failure) =>
        cause._tag === "Gone"
          ? cause.error
          : cause._tag === "Deadline"
          ? cause.error ??
            record.timeout(
              Option.some("The worker didn't answer before the deadline; the function may still be running")
            )
          : failure(cause.reason as BrowserWorker.BrowserWorkerErrorReason, id)
      const values = yield* Evaluation.toLocal(args, entry.realm).pipe(Effect.mapError(fromFailure))
      const group = yield* Evaluation.groupFor(runtime, entry.realm, result)
      // The call is on its way: a deadline after it can't say the function didn't run
      record.markSent()
      const evaluated = yield* runtime.model.adapter.evaluate(entry.realm, {
        functionDeclaration: FunctionSource.declaration(fn),
        arguments: values,
        awaitPromise: true,
        result,
        ...(group === undefined ? {} : { group }),
        userActivation: false
      }).pipe(
        Effect.catch((error) => {
          const mapped = Operation.fromAdapter(error, id, runtime.backend)
          return Effect.fail(mapped._tag !== "Reason" ? mapped.error : failure(mapped.reason, id))
        }),
        (calling) =>
          record.bound(
            calling,
            () => Option.some("The worker didn't answer before the deadline; the function may still be running")
          )
      )
      if (evaluated._tag === "Exception") {
        return yield* Effect.fail(failure(
          new Reason.EvaluationThrown({
            exception: exception(evaluated),
            hint: "The function threw in the worker, or returned a promise that rejected"
          }),
          id
        ))
      }
      return yield* then(evaluated.value).pipe(Effect.mapError(fromFailure))
    }).pipe(Operation.named(operation, { attributes: { "browser.realm.id": entry.realm } }))

  const evaluate = <Args extends ReadonlyArray<unknown>, B>(fn: (...args: Args) => B | Promise<B>, ...args: Args) =>
    run("BrowserWorker.evaluate", fn, args, "value", Evaluation.fromRemote) as Effect.Effect<
      JSHandle.Serialized<B>,
      BrowserWorker.BrowserWorkerError | Target.TargetGone | Deadline.Timeout
    >

  const evaluateHandle = <Args extends ReadonlyArray<unknown>, B>(
    fn: (...args: Args) => B | Promise<B>,
    ...args: Args
  ) =>
    run(
      "BrowserWorker.evaluateHandle",
      fn,
      args,
      "handle",
      (value) => Evaluation.own<Awaited<B>>(runtime, entry.realm, value, Option.none())
    )

  const worker: BrowserWorker.BrowserWorker = {
    [TypeId]: TypeId,
    realm: entry.realm,
    kind: entry.kind,
    url: entry.url,
    closed: Deferred.await(entry.closed),
    evaluate,
    evaluateHandle,
    pipe() {
      return pipeArguments(this, arguments)
    },
    toString() {
      return `BrowserWorker(${entry.realm})`
    },
    toJSON() {
      return { _id: "BrowserWorker", realm: entry.realm, kind: entry.kind, url: entry.url }
    },
    [Inspectable.NodeInspectSymbol]() {
      return this.toJSON()
    }
  }
  return worker
}
