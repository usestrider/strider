/**
 * A worker's handle (review 14, candidate 10): its realm, kind and URL, its end, and evaluation in it. Workers
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
import * as Filters from "./filters.ts"
import type * as Model from "./model.ts"
import * as Operation from "./operation.ts"
import type * as Runtime from "./runtime.ts"
import * as Serialization from "./serialization.ts"

const TypeId = "~@usestrider/browser/BrowserWorker"

/** An exception's name and message, from the text the browser gives (`Uncaught TypeError: boom`). */
export const exception = (result: Extract<Adapter.RemoteResult, { readonly _tag: "Exception" }>) => {
  const text = result.text.replace(/^Uncaught (\(in promise\) )?/, "")
  const colon = text.indexOf(": ")
  const named = colon > 0 && /^[A-Za-z_$][\w$]*$/.test(text.slice(0, colon))
  return {
    name: named ? text.slice(0, colon) : "Error",
    message: named ? text.slice(colon + 2) : text,
    stack: result.stack
  }
}

export const make = (runtime: Runtime.Runtime, entry: Model.WorkerEntry): BrowserWorker.BrowserWorker => {
  const failure = (reason: BrowserWorker.BrowserWorkerErrorReason, id = Operation.operationId()) =>
    new BrowserWorker.BrowserWorkerError({ reason, diagnostics: Operation.diagnostics(id) })

  const evaluate = Effect.fn("BrowserWorker.evaluate", { attributes: { "browser.realm.id": entry.realm } })(
    function*<Args extends ReadonlyArray<unknown>, B>(fn: (...args: Args) => B | Promise<B>, ...args: Args) {
      const id = Operation.operationId()
      yield* Filters.requires(runtime, "BrowserWorker.evaluate", "workers.evaluate").pipe(
        Effect.mapError((error) => failure(error.reason as Reason.Unsupported, id))
      )
      const budget = yield* Operation.budget
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
      const result = yield* runtime.model.adapter.evaluate(entry.realm, {
        functionDeclaration: fn.toString(),
        arguments: values,
        awaitPromise: true,
        result: "value",
        userActivation: false
      }).pipe(
        Effect.timeoutOption(Operation.millisLeft(budget.at)),
        Effect.catch((error) => {
          const mapped = Operation.fromAdapter(error, id, runtime.backend)
          return Effect.fail(mapped._tag === "Gone" ? mapped.error : failure(mapped.reason, id))
        })
      )
      if (Option.isNone(result)) {
        return yield* Effect.fail(Operation.timeout({
          operation: "BrowserWorker.evaluate",
          id,
          phase: "dispatchedUnconfirmed",
          budget: budget.budget,
          history: [],
          hint: Option.some("The worker didn't answer before the deadline; the function may still be running"),
          dispatch: { _tag: "MayHaveBeenSent" }
        }))
      }
      if (result.value._tag === "Exception") {
        return yield* Effect.fail(failure(
          new Reason.EvaluationThrown({
            exception: exception(result.value),
            hint: "The function threw in the worker, or returned a promise that rejected"
          }),
          id
        ))
      }
      try {
        return Serialization.fromRemote(result.value.value) as JSHandle.Serialized<B>
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
