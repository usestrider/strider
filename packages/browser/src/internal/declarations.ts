/**
 * The declarations in force, and what each target gets from them (CONCEPTS.md §7). Every backend's gate asks
 * the registry what to apply to a new target before its scripts run, and re-applies a kind when a
 * registration of that kind comes or goes.
 *
 * - **Precedence** for overrides: the most specific scope (page, then context, then browser), then the most
 *   recent registration. Releasing one recomputes the effective value, whatever order releases come in.
 * - **Init scripts** form one bundle per world: the environment phase first, then user scripts; within a
 *   phase, broader scopes first, then registration order. Each script runs in its own `try`, so one that
 *   throws doesn't stop the rest, and is reported with `reportError`, as the page's uncaught exception. A
 *   script runs only if each script it comes `after` ran in this document without throwing, so one whose
 *   dependency is gone, or threw, doesn't run.
 * - **Intercepts** are the union of every pattern in scope, per phase.
 */
import type * as Target from "../Target.ts"
import type * as UserContext from "../UserContext.ts"
import type * as Adapter from "./adapter.ts"

/** One registration. */
export interface Registered {
  readonly id: Adapter.RegistrationId
  readonly scope: Adapter.DeclarationScope
  readonly declaration: Adapter.Declaration
  readonly sequence: number
}

/** Where a target sits: its page and its context. */
export interface Placement {
  readonly page: Target.NavigableId
  readonly context: UserContext.Id
}

const specificity = (scope: Adapter.DeclarationScope): number =>
  scope._tag === "Page" ? 2 : scope._tag === "UserContext" ? 1 : 0

/** Whether a registration's scope covers a placement. */
export const covers = (scope: Adapter.DeclarationScope, placement: Placement): boolean => {
  switch (scope._tag) {
    case "Browser":
      return true
    case "UserContext":
      return scope.context === placement.context
    case "Page":
      return scope.page === placement.page
  }
}

/** A `*` glob over a whole URL, as L0's intercepts mean it: `*` matches anything, `/` included. */
export const glob = (pattern: string): RegExp =>
  new RegExp(`^${pattern.split("*").map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*")}$`)

/** A world's key, for bundles. */
export const worldKey = (world: Adapter.World): string => world._tag === "Main" ? "" : world.name

/** The registry. */
export interface Registry {
  readonly add: (
    scope: Adapter.DeclarationScope,
    declaration: Adapter.Declaration,
    id: Adapter.RegistrationId
  ) => Registered
  readonly remove: (id: Adapter.RegistrationId) => Registered | undefined
  readonly all: () => ReadonlyArray<Registered>
  /** The effective override of each kind for a placement. */
  readonly overrides: (placement: Placement) => ReadonlyMap<Adapter.Override["_tag"], Adapter.Override>
  /**
   * The init-script bundle for a dedicated worker: the main world's scripts declared for workers, in the same
   * order, or `undefined` where there are none.
   */
  readonly workerBundle: (placement: Placement) => string | undefined
  /** The init-script bundle for each world, by world key. */
  readonly bundles: (
    placement: Placement
  ) => ReadonlyMap<string, { readonly world: Adapter.World; readonly source: string }>
  /** The intercept patterns in force, per phase. */
  readonly intercepts: (placement: Placement) => {
    readonly request: ReadonlyArray<string>
    readonly response: ReadonlyArray<string>
    readonly auth: ReadonlyArray<string>
  }
  /** The download behavior of a context: the most specific, then most recent. */
  readonly downloads: (
    context: UserContext.Id
  ) => Extract<Adapter.Declaration, { _tag: "Downloads" }>["behavior"] | undefined
  readonly fileChooser: (placement: Placement) => boolean
  /**
   * The largest body of a kind, a request's or a response's, that a collection in force keeps, or `undefined`
   * where none keeps that kind (QUIRKS.md, Q160 and Q164).
   */
  readonly bodyLimit: (placement: Placement, body: "request" | "response") => number | undefined
}

export const make = (): Registry => {
  const registered = new Map<Adapter.RegistrationId, Registered>()
  let sequence = 0
  const inScope = (placement: Placement) => [...registered.values()].filter((entry) => covers(entry.scope, placement))
  // A placement's init scripts in the order they run: the environment phase first, then by precedence
  const scriptsOf = (placement: Placement) =>
    inScope(placement)
      .filter((entry): entry is Registered & { declaration: Extract<Adapter.Declaration, { _tag: "InitScript" }> } =>
        entry.declaration._tag === "InitScript"
      )
      .sort((a, b) =>
        (a.declaration.phase === b.declaration.phase ? 0 : a.declaration.phase === "environment" ? -1 : 1) ||
        byPrecedence(a, b)
      )
  const byPrecedence = (a: Registered, b: Registered) =>
    specificity(a.scope) - specificity(b.scope) || a.sequence - b.sequence
  return {
    add: (scope, declaration, id) => {
      const entry = { id, scope, declaration, sequence: sequence++ }
      registered.set(id, entry)
      return entry
    },
    remove: (id) => {
      const entry = registered.get(id)
      registered.delete(id)
      return entry
    },
    all: () => [...registered.values()],
    bodyLimit: (placement, body) => {
      let limit: number | undefined
      for (const entry of inScope(placement)) {
        if (entry.declaration._tag === "BodyCollection" && entry.declaration.bodies.includes(body)) {
          limit = Math.max(limit ?? 0, entry.declaration.maxBytes)
        }
      }
      return limit
    },
    overrides: (placement) => {
      const effective = new Map<Adapter.Override["_tag"], Adapter.Override>()
      // Least specific and oldest first, so the winner is written last
      for (const entry of inScope(placement).sort(byPrecedence)) {
        if (entry.declaration._tag === "Override") {
          effective.set(entry.declaration.override._tag, entry.declaration.override)
        }
      }
      return effective
    },
    workerBundle: (placement) => {
      const sources = scriptsOf(placement)
        .filter((entry) => entry.declaration.workers && entry.declaration.world._tag === "Main")
        .map((entry) => wrap(entry.id, entry.declaration.source, entry.declaration.after))
      return sources.length === 0 ? undefined : block(sources)
    },
    bundles: (placement) => {
      const scripts = scriptsOf(placement)
      const bundles = new Map<string, { world: Adapter.World; sources: Array<string> }>()
      for (const entry of scripts) {
        const key = worldKey(entry.declaration.world)
        let bundle = bundles.get(key)
        if (bundle === undefined) {
          bundle = { world: entry.declaration.world, sources: [] }
          bundles.set(key, bundle)
        }
        bundle.sources.push(wrap(entry.id, entry.declaration.source, entry.declaration.after))
      }
      return new Map(
        [...bundles].map(([key, bundle]) => [key, { world: bundle.world, source: block(bundle.sources) }])
      )
    },
    intercepts: (placement) => {
      const phases = { request: new Set<string>(), response: new Set<string>(), auth: new Set<string>() }
      for (const entry of inScope(placement)) {
        if (entry.declaration._tag !== "Intercept") continue
        for (const phase of entry.declaration.phases) {
          for (const pattern of entry.declaration.patterns) phases[phase].add(pattern)
        }
      }
      return { request: [...phases.request], response: [...phases.response], auth: [...phases.auth] }
    },
    downloads: (context) => {
      let winner: Registered | undefined
      for (const entry of registered.values()) {
        if (entry.declaration._tag !== "Downloads") continue
        if (entry.scope._tag === "Page") continue
        if (entry.scope._tag === "UserContext" && entry.scope.context !== context) continue
        if (winner === undefined || byPrecedence(winner, entry) < 0) winner = entry
      }
      return winner?.declaration._tag === "Downloads" ? winner.declaration.behavior : undefined
    },
    fileChooser: (placement) => inScope(placement).some((entry) => entry.declaration._tag === "FileChooser")
  }
}

/** Which scripts of a bundle ran without throwing in this document; a name no script will use. */
const ran = "__strider_ran__"

// One script, isolated from the others: it runs once per document, only if what it comes after ran, and a
// throw is reported without stopping the bundle. The newline ends a script whose last line is a comment.
const wrap = (id: Adapter.RegistrationId, source: string, after: ReadonlyArray<Adapter.RegistrationId>): string => {
  const script = `try { ${source}\n;${ran}.add(${JSON.stringify(id)}) } catch (error) { ` +
    `typeof reportError === "function" ? reportError(error) : console.error(error) }`
  return after.length === 0 ? script : `if (${JSON.stringify(after)}.every((id) => ${ran}.has(id))) { ${script} }`
}

// One block, so its bookkeeping is invisible to the page, while a script's top-level `var` and functions stay
// global, as they would be on their own.
const block = (scripts: ReadonlyArray<string>): string => `{ const ${ran} = new Set()\n${scripts.join("\n")}\n}`
