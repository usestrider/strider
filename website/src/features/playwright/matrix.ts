import data from "./matrix.json"
import inventory from "./upstream.json"

export type Status = "has" | "different" | "missing"
export interface Row {
  readonly id: string
  readonly upstream: ReadonlyArray<string>
  readonly value?: string
  readonly parent?: string
  readonly gaps?: ReadonlyArray<string>
  readonly patches?: ReadonlyArray<string>
  readonly option?: string
  readonly status: Status
  readonly api: ReadonlyArray<{ readonly module: string; readonly symbol: string; readonly url: string }>
  readonly notes: string
  readonly decision?: { readonly file: string; readonly anchor: string; readonly quote: string }
  readonly capabilities: ReadonlyArray<string>
  readonly browsers: Readonly<Record<string, { readonly status: Status; readonly limitations: ReadonlyArray<string> }>>
}
export const matrix = data as unknown as {
  readonly rows: ReadonlyArray<Row>
  readonly patchedBrowserNotes: typeof data.patchedBrowserNotes
}
export const members = new Map(inventory.members.map((member) => [member.id, member]))
export const labels: Readonly<Record<Status, string>> = {
  has: "Has it",
  different: "Deliberately different",
  missing: "Missing"
}
export const decisionUrl = (decision: NonNullable<Row["decision"]>) =>
  `https://github.com/usestrider/strider/blob/main/${decision.file}#${decision.anchor}`
export const groups = inventory.classes.map((clazz) => ({
  ...clazz,
  rows: matrix.rows.filter((row) => members.get(row.upstream[0]!)?.class === clazz.name)
}))
