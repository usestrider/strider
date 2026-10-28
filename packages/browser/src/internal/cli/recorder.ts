/**
 * What a session records for `strider export test` (CLI.md): the steps of its successful commands, and how it came
 * to know each page no command it repeats opened, so the test can declare the page where a statement names it.
 *
 * - **A popup** is declared by the wait the session had started on its opener when one was pending, `next popup`'s;
 *   otherwise it's given to the command acting on its opener as it opened, or, when none is, to the last that acted
 *   on it, and the test waits for it from just before that command. A command acts on the page it names, the page it
 *   opens, from the moment it opens, and the popups given to it; a segment, on every page. One that opened while a
 *   command the test leaves out
 *   acted on its opener, such as one that failed, or while two commands acted on it at once, which the session can't
 *   tell apart, is left to a placeholder (Q251, Q253).
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
  /** The pages it acts on, by id: the one it names, the one it opens, once it has, and the popups given to it. */
  readonly pages: Set<string>
  /** The step it recorded, once it has. */
  step: ExportTest.Step | undefined
  /** The popups given to it as it ran. */
  readonly popups: Array<ExportTest.Opened>
}

export interface Recorder {
  /** The steps, in the order the test repeats them. */
  readonly steps: ReadonlyArray<ExportTest.Step>
  /** A command starts that may open pages, acting on `pages`, by id. */
  readonly begin: (kind: Running["kind"], pages?: Iterable<string>) => Running
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
  /** A command that ended: in what order, and the step it recorded, or undefined when it failed. */
  interface Ended {
    readonly order: number
    step: ExportTest.Step | undefined
  }
  let ended = 0
  /** By page id, the last action that acted on the page. */
  const acted = new Map<string, Ended>()
  /** The last segment to end, which may have acted on any page. */
  let segment: Ended | undefined
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
    begin: (kind, pages = []) => {
      const each: Running = { kind, pages: new Set(pages), step: undefined, popups: [] }
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
      // One record for every page it acted on, so a popup seen later on any of them updates the step once
      const last: Ended = { order: ended++, step }
      if (each.kind === "segment") segment = last
      else for (const page of each.pages) acted.set(page, last)
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
      // The command acting on its opener opened it, which then acts on the popup too, as on a popup of the popup;
      // two acting on it at once can't be told apart (Q253)
      const acting = running.filter((each) => each.kind === "action" && each.pages.has(opener))
      if (acting.length > 1) return
      const action = acting[0]
      if (action !== undefined) {
        action.pages.add(id)
        action.popups.push({ page: name, opener: openerName })
        return
      }
      // When none is: the last that acted on its opener, a segment acting on every page, under the opener's name
      // as it ran, before any rename
      const byPage = acted.get(opener)
      const last = segment !== undefined && (byPage === undefined || segment.order > byPage.order) ? segment : byPage
      if (last?.step === undefined) return
      acted.set(id, last)
      let as = openerName
      for (const step of steps.slice(steps.indexOf(last.step) + 1).reverse()) {
        if (step._tag === "Rename" && step.to === as) as = step.from
      }
      last.step = attach(last.step, { page: name, opener: as })
    }
  }
}
