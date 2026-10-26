/**
 * Object groups (review 22, QUIRKS.md, Q132): which handles each group holds, so a release given every handle a
 * group still holds goes as one command, and any other handle alone. The CDP and WebKit adapters share it.
 */
import type * as Adapter from "./adapter.ts"

/** Each group's handles not yet released. */
export type Groups = Map<string, Set<Adapter.HandleId>>

export const make = (): Groups => new Map()

export const join = (groups: Groups, group: string, handle: Adapter.HandleId): void => {
  let members = groups.get(group)
  if (members === undefined) {
    members = new Set()
    groups.set(group, members)
  }
  members.add(handle)
}

/** One command a release takes: a group's, or one handle's. */
export type Released<H> =
  | { readonly _tag: "Group"; readonly group: string; readonly first: H }
  | { readonly _tag: "Handle"; readonly handle: H }

/** What releasing `list` takes: each group it empties, whole, and each other handle alone; all are forgotten. */
export const release = <H extends { readonly group: string | undefined }>(
  groups: Groups,
  handles: Map<Adapter.HandleId, H>,
  list: ReadonlyArray<Adapter.HandleId>
): Array<Released<H>> => {
  const released: Array<Released<H>> = []
  const byGroup = new Map<string, Array<H>>()
  for (const id of list) {
    const handle = handles.get(id)
    if (handle === undefined) continue
    handles.delete(id)
    if (handle.group === undefined) {
      released.push({ _tag: "Handle", handle })
      continue
    }
    groups.get(handle.group)?.delete(id)
    const listed = byGroup.get(handle.group) ?? []
    listed.push(handle)
    byGroup.set(handle.group, listed)
  }
  for (const [group, listed] of byGroup) {
    if ((groups.get(group)?.size ?? 0) === 0) {
      groups.delete(group)
      released.push({ _tag: "Group", group, first: listed[0]! })
    } else {
      for (const handle of listed) released.push({ _tag: "Handle", handle })
    }
  }
  return released
}
