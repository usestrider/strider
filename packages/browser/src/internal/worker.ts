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
import type * as JSHandle from "../JSHandle.ts"
import * as Reason from "../Reason.ts"
import type * as Url from "../Url.ts"
import type * as Adapter from "./adapter.ts"
import { exception } from "./evaluation.ts"
import * as Filters from "./filters.ts"
import type * as Model from "./model.ts"
import * as Operation from "./operation.ts"
import type * as Runtime from "./runtime.ts"
import * as Serialization from "./serialization.ts"

const TypeId = "~@usestrider/browser/BrowserWorker"

export const make = (runtime: Runtime.Runtime, entry: Model.WorkerEntry): BrowserWorker.BrowserWorker => {
  const failure = (reason: BrowserWorker.BrowserWorkerErrorReason, id = Operation.idNow()) =>
    new BrowserWorker.BrowserWorkerError({ reason, diagnostics: Operation.diagnostics(id) })

  const evaluate = Operation.fn("BrowserWorker.evaluate", { attributes: { "browser.realm.id": entry.realm } })(
    function*<Args extends ReadonlyArray<unknown>, B>(fn: (...args: Args) => B | Promise<B>, ...args: Args) {
      const record = yield* Operation.record
      const id = record.id
      yield* Filters.requires(runtime, "BrowserWorker.evaluate", "workers.evaluate").pipe(
        Effect.mapError((error) => failure(error.reason as Reason.Unsupported, id))
      )
      let values: ReadonlyArray<Adapter.LocalValue>
      try {
        values = args.map((arg, index) => ({
          _tag: "Value",
          value: Serialization.toRemote(arg, `args[${index}]`)
        }))
      } catch (error) {
        if (!(error instanceof Serialization.Unserializable)) throw error
        return yield* Effect.fail(failure(new Reason.NotSerializable({ path: error.path, hint: error.hint }), id))
      }
      // The call is on its way: a deadline after it can't say the function didn't run
      record.markSent()
      const result = yield* runtime.model.adapter.evaluate(entry.realm, {
        functionDeclaration: fn.toString(),
        arguments: values,
        awaitPromise: true,
        result: "value",
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
      if (result._tag === "Exception") {
        return yield* Effect.fail(failure(
          new Reason.EvaluationThrown({
            exception: exception(result),
            hint: "The function threw in the worker, or returned a promise that rejected"
          }),
          id
        ))
      }
      try {
        return Serialization.fromRemote(result.value) as JSHandle.Serialized<B>
      } catch (error) {
        if (!(error instanceof Serialization.Unserializable)) throw error
        return yield* Effect.fail(failure(new Reason.NotSerializable({ path: error.path, hint: error.hint }), id))
      }
    }
  )

  const worker: BrowserWorker.BrowserWorker = {
    [TypeId]: TypeId,
    realm: entry.realm,
    kind: entry.kind,
    url: entry.url as Url.Url,
    closed: Deferred.await(entry.closed),
    evaluate,
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
