/**
 * The declarations in force, and what each target gets from them (CONCEPTS.md §7). Every backend's gate asks
 * the registry what to apply to a new target before its scripts run, and re-applies a kind when a
 * registration of that kind comes or goes.
 *
 * - **Precedence** for overrides: the most specific scope (page, then context, then browser), then the most
 *   recent registration. Releasing one recomputes the effective value, whatever order releases come in.
 * - **Init scripts** form one bundle per world: the environment phase first, then user scripts; within a
 *   phase, broader scopes first, then registration order. Each script runs in its own `try`, so one that
 *   throws doesn't stop the rest.
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
  /** The init-script bundle for each world, by world key. */
  readonly bundles: (
    placement: Placement
  ) => ReadonlyMap<string, { readonly world: Adapter.World; readonly source: string }>
  /** The intercept patterns in force, per phase. */
  readonly intercepts: (placement: Placement) => {
    readonly request: ReadonlyArray<string>
    readonly response: ReadonlyArray<string>
    readonly auth: boolean
  }
  /** The download behavior of a context: the most specific, then most recent. */
  readonly downloads: (
    context: UserContext.Id
  ) => Extract<Adapter.Declaration, { _tag: "Downloads" }>["behavior"] | undefined
  readonly fileChooser: (placement: Placement) => boolean
}

export const make = (): Registry => {
  const registered = new Map<Adapter.RegistrationId, Registered>()
  let sequence = 0
  const inScope = (placement: Placement) => [...registered.values()].filter((entry) => covers(entry.scope, placement))
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
    bundles: (placement) => {
      const scripts = inScope(placement)
        .filter((entry): entry is Registered & { declaration: Extract<Adapter.Declaration, { _tag: "InitScript" }> } =>
          entry.declaration._tag === "InitScript"
        )
        .sort((a, b) =>
          (a.declaration.phase === b.declaration.phase ? 0 : a.declaration.phase === "environment" ? -1 : 1) ||
          byPrecedence(a, b)
        )
      const bundles = new Map<string, { world: Adapter.World; sources: Array<string> }>()
      for (const entry of scripts) {
        const key = worldKey(entry.declaration.world)
        let bundle = bundles.get(key)
        if (bundle === undefined) {
          bundle = { world: entry.declaration.world, sources: [] }
          bundles.set(key, bundle)
        }
        bundle.sources.push(entry.declaration.source)
      }
      return new Map(
        [...bundles].map(([key, bundle]) => [key, { world: bundle.world, source: bundle.sources.map(wrap).join("\n") }])
      )
    },
    intercepts: (placement) => {
      const request = new Set<string>()
      const response = new Set<string>()
      let auth = false
      for (const entry of inScope(placement)) {
        if (entry.declaration._tag !== "Intercept") continue
        for (const phase of entry.declaration.phases) {
          if (phase === "auth") auth = true
          for (const pattern of entry.declaration.patterns) (phase === "request" ? request : response).add(pattern)
        }
      }
      return { request: [...request], response: [...response], auth }
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

// One script, isolated from the others: it runs once per document, and a throw doesn't stop the bundle.
const wrap = (source: string): string => `try { ${source}\n} catch (error) { console.error(error) }`
