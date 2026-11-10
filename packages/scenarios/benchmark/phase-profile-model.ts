/** Per-phase summaries for the upload and response diagnostic: attribution only, never a timing result. */
export interface PhaseSample {
  readonly scenario: string
  readonly library: "strider" | "playwright"
  readonly repetition: number
  readonly warmup: boolean
  /** Phase name to wall milliseconds, in the order they ran; they partition the sample */
  readonly phases: Readonly<Record<string, number>>
  readonly total: number
  /** The protocol messages of the close, in a traced run only */
  readonly events?: ReadonlyArray<WireEvent>
  /** The protocol messages of the upload's `setInputFiles` call, in a traced run only */
  readonly inputEvents?: ReadonlyArray<WireEvent>
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
  // Strider's close is its scope's release and the runPromise exit; Playwright's is one step, so both get a total
  const measured = samples.filter((sample) => !sample.warmup).map((sample) => ({
    ...sample,
    phases: { ...sample.phases, closeTotal: (sample.phases["release"] ?? 0) + (sample.phases["close"] ?? 0) }
  }))
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

/** One protocol message crossing the wire during a traced close, offsets in ms from the start of the window. */
export interface WireEvent {
  readonly at: number
  readonly kind: "send" | "receive" | "mark"
  readonly name?: string
  readonly message?: Record<string, unknown>
  /** The size of the raw message as sent or received, before `message` was cut short */
  readonly bytes?: number
}

export interface Step {
  readonly at: number
  readonly what: string
  /** For a command: when its reply arrived, relative to the same start, and how long it waited */
  readonly repliedAt?: number
  readonly waited?: number
}

/** The window as a list of commands with their replies, the events between them, and the marks. */
export const timeline = (events: ReadonlyArray<WireEvent>) => {
  const pending = new Map<number, Step & { id: number }>()
  const steps: Array<Step> = []
  for (const event of events) {
    const message = event.message
    if (event.kind === "mark") {
      steps.push({ at: event.at, what: `mark: ${event.name}` })
    } else if (message !== undefined && typeof message["id"] === "number" && event.kind === "send") {
      const step = {
        at: event.at,
        id: message["id"] as number,
        what: `send ${String(message["method"])}${message["sessionId"] === undefined ? "" : " (page session)"}`
      }
      pending.set(step.id, step)
      steps.push(step)
    } else if (message !== undefined && typeof message["id"] === "number") {
      const step = pending.get(message["id"] as number)
      if (step !== undefined) Object.assign(step, { repliedAt: event.at, waited: event.at - step.at })
    } else if (message !== undefined && typeof message["method"] === "string") {
      steps.push({ at: event.at, what: `event ${message["method"]}` })
    }
  }
  const commands = steps.filter((step) => step.waited !== undefined)
  // A command starts a new round trip when no earlier one is still waiting for its reply
  let roundTrips = 0
  let until = Number.NEGATIVE_INFINITY
  for (const step of commands) {
    if (step.at >= until) roundTrips++
    until = Math.max(until, step.repliedAt!)
  }
  return {
    steps,
    sent: steps.filter((step) => step.what.startsWith("send ")).length,
    events: steps.filter((step) => step.what.startsWith("event ")).length,
    sentBytes: events.reduce((sum, event) => sum + (event.kind === "send" ? event.bytes ?? 0 : 0), 0),
    receivedBytes: events.reduce((sum, event) => sum + (event.kind === "receive" ? event.bytes ?? 0 : 0), 0),
    roundTrips,
    // Time between a reply and the next command: the host's, not waiting on a command
    hostGaps: commands.slice(1).map((step, index) => Math.max(0, step.at - commands[index]!.repliedAt!))
  }
}

/** Raw wire JSON reduced to what a timeline needs; params are cut short so a trace stays small. */
export const compactMessage = (raw: Record<string, unknown>): Record<string, unknown> => ({
  ...(raw["id"] === undefined ? {} : { id: raw["id"] }),
  ...(raw["method"] === undefined ? {} : { method: raw["method"] }),
  ...(raw["sessionId"] === undefined ? {} : { sessionId: raw["sessionId"] }),
  ...(raw["error"] === undefined ? {} : { error: raw["error"] }),
  ...(raw["params"] === undefined ? {} : { params: JSON.stringify(raw["params"]).slice(0, 160) })
})

const windowReport = (
  samples: ReadonlyArray<PhaseSample>,
  label: string,
  events: (sample: PhaseSample) => ReadonlyArray<WireEvent> | undefined,
  duration: (sample: PhaseSample) => number
): string => {
  const lines: Array<string> = []
  const traced = samples.filter((sample) => !sample.warmup && events(sample) !== undefined)
  for (const scenario of [...new Set(traced.map((sample) => sample.scenario))]) {
    for (const library of ["strider", "playwright"] as const) {
      const group = traced.filter((sample) => sample.scenario === scenario && sample.library === library)
      if (group.length === 0) continue
      const chosen = [...group].sort((a, b) => duration(a) - duration(b))[group.length >> 1]!
      const result = timeline(events(chosen)!)
      const counts = group.map((sample) => timeline(events(sample)!)).map((t) => `${t.sent}/${t.roundTrips}`)
      lines.push(
        `### ${scenario}, ${library}: ${label} ${
          duration(chosen).toFixed(1)
        } ms (median of ${group.length}), ${result.sent} commands, ${result.events} events, ${result.roundTrips} serial round trips, ${result.sentBytes} bytes sent, ${result.receivedBytes} bytes received; commands/round trips per traced sample: ${
          [...new Set(counts)].join(", ")
        }`,
        "",
        "| At ms | Step | Reply after ms |",
        "| --- | --- | --- |",
        ...result.steps.map((step) =>
          `| ${step.at.toFixed(1)} | ${step.what} | ${step.waited === undefined ? "" : step.waited.toFixed(1)} |`
        ),
        ""
      )
    }
  }
  return lines.join("\n")
}

/** For each scenario and library, the traced close whose duration is the median, as a step list with its counts. */
export const closeReport = (samples: ReadonlyArray<PhaseSample>): string =>
  windowReport(
    samples,
    "close",
    (sample) => sample.events,
    (sample) => (sample.phases["release"] ?? 0) + (sample.phases["close"] ?? 0)
  )

/** The same for the upload's `setInputFiles` call, whose duration is its phase. */
export const inputReport = (samples: ReadonlyArray<PhaseSample>): string =>
  windowReport(
    samples,
    "setInputFiles",
    (sample) => sample.inputEvents,
    (sample) => sample.phases["setInputFiles"] ?? 0
  )
