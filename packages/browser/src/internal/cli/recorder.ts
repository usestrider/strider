/**
 * What a session records for `strider export test` (CLI.md): the steps of its successful commands, and how it came
 * to know each page no command it repeats opened, so the test can declare the page where a statement names it.
 *
 * - **A popup** is declared by the wait the session had started on its opener when one was pending, `next popup`'s;
 *   otherwise it's given to the command that ran as it opened, or, between commands, to the last that acted, and the
 *   test waits for it from just before that command. One that opened while a command the test leaves out acted, such
 *   as one that failed, is left to a placeholder (Q251).
 * - **A page found among the context's pages,** with no event saying what opened it, as every popup on stock WebKit
 *   is, is declared by its place there.
 * - **A segment's pages** are its own, which its placeholder declares: what the daemon finds new after it.
 *
 * Pages are told apart by their ids, since a name can change.
 */
import type * as ExportTest from "./exportTest.ts"

/** A command that may open pages as it runs: an action, or a segment, whose placeholder declares what it opened. */
export interface Running {
  readonly kind: "action" | "segment"
  /** The step it recorded, once it has. */
  step: ExportTest.Step | undefined
  /** The popups that opened while it ran. */
  readonly popups: Array<ExportTest.Opened>
}

export interface Recorder {
  /** The steps, in the order the test repeats them. */
  readonly steps: ReadonlyArray<ExportTest.Step>
  /** A command starts that may open pages. */
  readonly begin: (kind: Running["kind"]) => Running
  /** Records a step: `running`'s own, when it's given. */
  readonly record: (step: ExportTest.Step, running?: Running) => void
  /** A command `begin` started ends, with the step it recorded, if it succeeded. */
  readonly end: (running: Running) => void
  /** A page a recorded step declares itself: one it opened, a tab it took, or a popup a wait it collected gave. */
  readonly declared: (page: string) => void
  /** Whether the test declares a page. */
  readonly declares: (page: string) => boolean
  /** A popup wait the session started on a page, `next popup`'s, which gives the next popup that page opens. */
  readonly waiting: (wait: string, opener: string) => void
  /** A page the session found among its context's pages, at `index`, and named. */
  readonly listed: (page: { readonly id: string; readonly name: string; readonly index: number }) => void
  /** A popup a page of the session opened, by its name and its opener's as it opened. */
  readonly popup: (
    popup: { readonly id: string; readonly name: string; readonly opener: string; readonly openerName: string }
  ) => void
}

export const make = (): Recorder => {
  const steps: Array<ExportTest.Step> = []
  const known = new Set<string>()
  const waits: Array<{ readonly wait: string; readonly opener: string; settled: boolean }> = []
  const running: Array<Running> = []
  /** The step of the last action or segment to end, or undefined when it failed. */
  let acted: { step: ExportTest.Step | undefined } | undefined
  const inSegment = () => running.some((each) => each.kind === "segment")

  /** Adds a popup to the step that opened it, or to a segment's pages, and returns the step as it is now. */
  const attach = (step: ExportTest.Step, popup: ExportTest.Opened): ExportTest.Step => {
    const updated: ExportTest.Step = step._tag === "Segment"
      ? { ...step, pages: [...(step.pages ?? []), popup.page] }
      : step._tag === "NewPage" || step._tag === "Tool"
      ? { ...step, popups: [...(step.popups ?? []), popup] }
      : step
    steps[steps.indexOf(step)] = updated
    return updated
  }

  return {
    steps,
    begin: (kind) => {
      const each: Running = { kind, step: undefined, popups: [] }
      running.push(each)
      return each
    },
    record: (step, by) => {
      steps.push(step)
      if (by !== undefined) by.step = step
    },
    end: (each) => {
      running.splice(running.indexOf(each), 1)
      let step = each.step
      if (step !== undefined) { for (const popup of each.popups) step = attach(step, popup) }
      acted = { step }
    },
    declared: (page) => void known.add(page),
    declares: (page) => known.has(page),
    waiting: (wait, opener) => void waits.push({ wait, opener, settled: false }),
    listed: ({ id, index, name }) => {
      if (known.has(id) || inSegment()) return
      known.add(id)
      steps.push({ _tag: "Listed", page: name, index })
    },
    popup: ({ id, name, opener, openerName }) => {
      // Every wait pending on the opener gives this popup, the first one after it started
      const wait = waits.find((each) => !each.settled && each.opener === opener)
      for (const each of waits) if (each.opener === opener) each.settled = true
      if (known.has(id) || inSegment()) return
      known.add(id)
      if (wait !== undefined) {
        steps.push({ _tag: "Popup", page: name, wait: wait.wait })
        return
      }
      const action = running.findLast((each) => each.kind === "action")
      if (action !== undefined) {
        action.popups.push({ page: name, opener: openerName })
        return
      }
      // Between commands: the last that acted opened it, under the opener's name as it ran, before any rename
      if (acted?.step === undefined) return
      let as = openerName
      for (const step of steps.slice(steps.indexOf(acted.step) + 1).reverse()) {
        if (step._tag === "Rename" && step.to === as) as = step.from
      }
      acted.step = attach(acted.step, { page: name, opener: as })
    }
  }
}
