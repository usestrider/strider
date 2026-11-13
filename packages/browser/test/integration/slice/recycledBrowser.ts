/**
 * Firefox 158.0's main process keeps about 10 MB for every window opened and closed over BiDi (about half is freed
 * after roughly 30 seconds idle), and Strider opens a window per page, so a suite's Firefox climbs past 2.7 GB over a
 * file's many cases, which stalls a 7 GB runner. `recycling` gives a suite a Browser that can be replaced by a new
 * launch once it has opened `limit` pages (100).
 *
 * What the code guarantees: the replacement happens only when `Recycler.run` is called (the shared context's `settle`,
 * after a case's scope has closed), and only when nothing the harness owns is live. A page is the harness's while it is
 * open and the library owns it (the model's page `owner`: the scope that created it through `createPage`, or for a popup,
 * its opener's, which holds only when Firefox reports the popup's opener and that opener is owned); pages Firefox opens itself (its `about:blank` and `about:newtab`) have no owner and never block, with
 * no exemption by URL or time. Live contexts and leases are tracked in the proxy: whatever `newContext`, `newPage` or the
 * default context's `control` hands out stays live until the scope that acquired it closes. The browser's own model
 * exposes no such state for contexts, so those three entry points are wrapped. The old browser's scope is closed and
 * awaited before the next launch. Never at `newContext`, which is not a boundary.
 *
 * What it does not: suites that do not call `settle` (cases that make their own contexts) are never replaced, and a
 * value kept from before a replacement still belongs to the old browser. Nothing under `src/` changes.
 */
import { Browser } from "@usestrider/browser"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Scope from "effect/Scope"
import { appendFileSync, mkdirSync } from "node:fs"
import * as Handles from "../../../src/internal/handles.ts"

export const defaultLimit = 100

export class Recycler extends Context.Service<Recycler, {
  /** Whether the browser has opened its page limit and no owned page, context or lease is live. */
  readonly due: Effect.Effect<boolean>
  /** Launches a new browser if `due`; true if it did. */
  readonly run: Effect.Effect<boolean, unknown>
  readonly stats: Effect.Effect<{ readonly launches: number; readonly pages: number; readonly limit: number }>
}>()("slice/Recycler") {}

export const recycling = <E, R>(
  backend: Layer.Layer<Browser.Browser, E, R>,
  limit: number = defaultLimit
): Layer.Layer<Browser.Browser | Recycler, E, R> =>
  Layer.effectContext(Effect.gen(function*() {
    const outer = yield* Effect.scope
    const services = yield* Effect.context<R>()
    let scope: Scope.Closeable = yield* Scope.fork(outer)
    let pages = 0
    let launches = 1
    const live = new Set<unknown>()
    const launch = Effect.fnUntraced(function*(into: Scope.Scope) {
      const context = yield* Layer.buildWithScope(backend, into).pipe(Effect.provideContext(services))
      const browser = Context.get(context, Browser.Browser)
      try {
        const target = Handles.target(browser.defaultContext)
        if (target._tag === "UserContext") {
          const adapter = target.behind.runtime.model.adapter as any
          const wrap = (name: string, after: (result: any, args: Array<any>) => void) => {
            const original = adapter[name]
            adapter[name] = (...args: Array<unknown>) =>
              (original.apply(adapter, args) as Effect.Effect<unknown>).pipe(
                Effect.tap((result) => Effect.sync(() => after(result, args)))
              )
          }
          wrap("createPage", () => void pages++)
        }
      } catch {
        // Without the adapter nothing is counted, and the browser is never replaced.
        pages = Number.NEGATIVE_INFINITY
      }
      return browser
    })
    let current = yield* launch(scope)
    // Live pages are what the browser itself reports (`browser.pages`, which includes the default context's);
    // live contexts and leases are those `newContext`, `newPage` and the default context's `control` handed out whose scope is still open.
    const held: Effect.Effect<Array<string>> = Effect.gen(function*() {
      const out: Array<string> = []
      for (const handle of live) out.push(`handle:${String((handle as any)?.id ?? "?")}`)
      const open = yield* (current as any).pages.waitFor(() => true) as Effect.Effect<ReadonlyArray<unknown>>
      for (const page of open) {
        const entry = Handles.page(page as any).entry as any
        if (Option.isSome((yield* (entry.state.get as Effect.Effect<any>)).owner)) out.push(`page:${String(entry.id)}`)
      }
      return out
    })
    // Diagnostic only (`STRIDER_TRACE_RETAIN_PASSES=1`): a refused restart at the limit never changes its result. A line
    // is written only when the held set differs from the last line, at most 200 lines, then one `limit` line; a failed
    // write is recorded once in memory and never thrown.
    let lastHeld = ""
    let lines = 0
    let failed = false
    const record = (holding: ReadonlyArray<string>) => {
      if (process.env["STRIDER_TRACE_RETAIN_PASSES"] !== "1" || failed || lines > 200) return
      const key = holding.join(",")
      if (key === lastHeld) return
      lastHeld = key
      try {
        const dir = ".data/integration-failures"
        mkdirSync(dir, { recursive: true })
        const entry = lines === 200
          ? { at: new Date().toISOString(), limit: 200 }
          : { at: new Date().toISOString(), pages, held: holding }
        lines++
        appendFileSync(`${dir}/recycler-held.ndjson`, JSON.stringify(entry) + "\n")
      } catch {
        failed = true
      }
    }
    const idle: Effect.Effect<boolean> = Effect.gen(function*() {
      if (pages < limit) return false
      const holding = yield* held
      if (holding.length > 0) record(holding)
      return holding.length === 0
    })
    const due = idle
    const run = Effect.gen(function*() {
      if (!(yield* idle)) return false
      yield* Scope.close(scope, Exit.void)
      scope = yield* Scope.fork(outer)
      pages = 0
      launches++
      live.clear()
      current = yield* launch(scope)
      return true
    })
    const proxy = new Proxy(current as object, {
      get: (_target, key) => {
        const track = (acquire: Effect.Effect<any, unknown, Scope.Scope>) =>
          acquire.pipe(
            Effect.tap((handle) =>
              Effect.flatMap(Effect.scope, (owner) => {
                live.add(handle)
                return Scope.addFinalizer(owner, Effect.sync(() => void live.delete(handle)))
              })
            )
          )
        // A handle given out is live until the scope it was acquired in closes.
        if (key === "newContext" || key === "newPage") {
          return (...args: Array<unknown>) => track((current as any)[key](...args))
        }
        if (key === "defaultContext") {
          const real = (current as any).defaultContext
          const wrapper = new Proxy(real, {
            get: (_t, k) => k === "control" ? track(real.control) : Reflect.get(real, k)
          })
          // `Handles` recognises a context by its registered object, so the wrapper is registered as the same context.
          const behind = Handles.target(real)
          if (behind._tag === "UserContext") Handles.registerContext(wrapper, behind.behind)
          return wrapper
        }
        return Reflect.get(current as object, key)
      }
    }) as Browser.Browser
    return Context.make(Browser.Browser, proxy).pipe(
      Context.add(Recycler, Recycler.of({ due, run, stats: Effect.sync(() => ({ launches, pages, limit })) }))
    )
  }))
