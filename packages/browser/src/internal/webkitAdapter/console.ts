/**
 * The console on stock WebKit: what a page or a worker logged, and what it threw that nothing caught, which WebKit
 * reports as a console error. A message is attributed to the realm of an object it logged, else its worker's, else
 * the page's main frame's.
 */
import * as Option from "effect/Option"
import * as ConsoleMessage from "../../ConsoleMessage.ts"
import * as UncaughtException from "../../UncaughtException.ts"
import type * as Url from "../../Url.ts"
import * as Console from "../../webkit-stock-protocol/Console.ts"
import * as Adapter from "../adapter.ts"
import * as Kit from "../adapterKit.ts"
import * as ConsoleFormat from "../consoleFormat.ts"
import { contextKey, type Event, type RealmEntry, type State, type TargetEntry, type WorkerEntry } from "./state.ts"

// ── Messages ──────────────────────────────────────────────────────────────────────────────────────────────

/** The realm of a page's main frame, for what WebKit doesn't attribute to one. */
export const mainRealmOf = (target: TargetEntry): RealmEntry | undefined =>
  [...(target.page.main.document?.realms ?? [])].find((realm) => realm.world._tag === "Main" && realm.target === target)

/** The realm an object was made in, which its id names. */
const realmOfObject = (state: State, target: TargetEntry, objectId: string | undefined): RealmEntry | undefined => {
  if (objectId === undefined) return undefined
  try {
    const parsed = JSON.parse(objectId) as { readonly injectedScriptId?: number }
    return parsed.injectedScriptId === undefined
      ? undefined
      : state.realmsByContext.get(contextKey(target, parsed.injectedScriptId))
  } catch {
    return undefined
  }
}

const consoleMessage = (
  state: State,
  message: Console.ConsoleMessage,
  target: TargetEntry,
  worker: WorkerEntry | undefined
) => {
  if (message.source === "javascript" && message.level === "error") {
    uncaught(state, message, target, worker)
    return
  }
  if (message.source !== "console-api") return
  const realm = worker?.realm ??
    realmOfObject(state, target, message.parameters?.find((parameter) => parameter.objectId !== undefined)?.objectId) ??
    mainRealmOf(target)
  if (realm === undefined) return
  state.buffer.emit({
    _tag: "ConsoleMessage",
    realm: realm.id,
    message: new ConsoleMessage.ConsoleMessage({
      level: Kit.consoleLevel(message.level),
      text: message.parameters !== undefined && message.parameters.length > 0
        ? ConsoleFormat.format(message.parameters.map(Kit.argumentOf))
        : message.text,
      location: message.url === undefined || message.url === "" || message.url === "undefined"
        ? Option.none()
        : Option.some({ url: message.url as Url.Url, line: message.line ?? 0, column: message.column ?? 0 }),
      origin: realm.document !== undefined
        ? { _tag: "Page", page: target.page.id }
        : { _tag: "Worker", realm: realm.id },
      at: Adapter.now()
    })
  })
}

/** An error stock WebKit logged as uncaught: a thrown exception, or a rejection nothing handled. */
const uncaught = (
  state: State,
  message: Console.ConsoleMessage,
  target: TargetEntry,
  worker: WorkerEntry | undefined
) => {
  const rejection = message.text.startsWith("Unhandled Promise Rejection: ")
  const text = rejection ? message.text.slice("Unhandled Promise Rejection: ".length) : message.text
  const colon = text.indexOf(": ")
  const realm = worker?.realm ?? mainRealmOf(target)
  const frames = message.stackTrace?.callFrames ?? []
  state.buffer.emit({
    _tag: "UncaughtException",
    realm: Option.fromUndefinedOr(realm?.id),
    exception: new UncaughtException.UncaughtException({
      kind: rejection ? "unhandledRejection" : "thrown",
      name: colon > 0 && /^\w+$/.test(text.slice(0, colon)) ? text.slice(0, colon) : "Error",
      message: colon > 0 && /^\w+$/.test(text.slice(0, colon)) ? text.slice(colon + 2) : text,
      stack: frames.length === 0 ? Option.none() : Option.some(
        [
          text,
          ...frames.map((frame) =>
            `    at ${
              frame.functionName === "" ? "<anonymous>" : frame.functionName
            } (${frame.url}:${frame.lineNumber}:${frame.columnNumber})`
          )
        ].join("\n")
      ),
      origin: worker?.realm !== undefined
        ? { _tag: "Worker", realm: worker.realm.id }
        : { _tag: "Page", page: target.page.id },
      at: Adapter.now()
    })
  })
}

// ── Events ────────────────────────────────────────────────────────────────────────────────────────────────

export const register = (handlers: Kit.Handlers<Event>) =>
  handlers
    .on(Console.messageAdded, (params, { state, target, worker }) => {
      const holder = worker ?? target
      if (holder === undefined) return
      holder.lastConsole = params.message
      consoleMessage(state, params.message, worker?.target ?? target!, worker)
    })
    .on(Console.messageRepeatCountUpdated, (_, { state, target, worker }) => {
      const holder = worker ?? target
      const message = holder?.lastConsole
      if (holder === undefined || message === undefined) return
      consoleMessage(state, message, worker?.target ?? target!, worker)
    })
