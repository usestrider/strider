/** Per-phase summaries for the upload and response diagnostic: attribution only, never a timing result. */
export interface PhaseSample {
  readonly scenario: string
  readonly library: "strider" | "playwright"
  readonly repetition: number
  readonly warmup: boolean
  /** Phase name to wall milliseconds, in the order they ran; they partition the sample */
  readonly phases: Readonly<Record<string, number>>
  readonly total: number
}

export const median = (values: ReadonlyArray<number>): number => {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = sorted.length >> 1
  return sorted.length === 0
    ? Number.NaN
    : sorted.length % 2
    ? sorted[middle]!
    : (sorted[middle - 1]! + sorted[middle]!) / 2
}

/** Each library's phases differ in name, so the table lists every phase either one recorded. */
export const summarize = (samples: ReadonlyArray<PhaseSample>) => {
  const measured = samples.filter((sample) => !sample.warmup)
  const rows: Array<
    { scenario: string; phase: string; strider: number | null; playwright: number | null; gap: number | null }
  > = []
  for (const scenario of [...new Set(measured.map((sample) => sample.scenario))]) {
    const of = (library: PhaseSample["library"]) =>
      measured.filter((sample) => sample.scenario === scenario && sample.library === library)
    const strider = of("strider")
    const playwright = of("playwright")
    const phases = [
      ...new Set([...strider, ...playwright].flatMap((sample) => Object.keys(sample.phases))),
      "total"
    ]
    for (const phase of phases) {
      const pick = (group: ReadonlyArray<PhaseSample>) => {
        const values = group.flatMap((sample) => {
          const value = phase === "total" ? sample.total : sample.phases[phase]
          return value === undefined ? [] : [value]
        })
        return values.length === 0 ? null : median(values)
      }
      const s = pick(strider)
      const p = pick(playwright)
      rows.push({ scenario, phase, strider: s, playwright: p, gap: s === null || p === null ? null : s - p })
    }
  }
  return rows
}

export const table = (rows: ReturnType<typeof summarize>): string => {
  const cell = (value: number | null) => (value === null ? "n/a" : value.toFixed(1))
  return [
    "| Scenario | Phase | Strider p50 ms | Playwright p50 ms | Gap ms |",
    "| --- | --- | --- | --- | --- |",
    ...rows.map((row) =>
      `| ${row.scenario} | ${row.phase} | ${cell(row.strider)} | ${cell(row.playwright)} | ${cell(row.gap)} |`
    )
  ].join("\n")
}

/** A sample's phases must add up to its total, or a mark was skipped. */
export const validate = (sample: PhaseSample) => {
  const sum = Object.values(sample.phases).reduce((a, b) => a + b, 0)
  if (!Number.isFinite(sum) || Math.abs(sum - sample.total) > 0.5) {
    throw new Error(
      `${sample.scenario} ${sample.library} ${sample.repetition}: phases sum ${sum}, total ${sample.total}`
    )
  }
}
