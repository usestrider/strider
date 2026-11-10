import * as assert from "node:assert/strict"

export interface Event {
  at: number
  kind: string
  name: string
  message?: Record<string, unknown>
}
export interface Sample {
  library: "strider" | "playwright"
  index: number
  trace: boolean
  phases: Array<number>
  titles: Array<string>
  events: Array<Event>
}

export const validate = (sample: Sample) => {
  assert.deepEqual(sample.titles, ["Shop", "Shop"])
  assert.equal(sample.phases.length, 3)
  assert.ok(sample.phases.every((ms) => Number.isFinite(ms) && ms > 0))
  if (!sample.trace) return
  const at = (name: string) => {
    const events = sample.events.filter((e) => e.kind === "mark" && e.name === name)
    assert.equal(events.length, 1, `Missing or repeated mark ${name}`)
    return events[0]!.at
  }
  const boundaries = ["goto.start", "goto.end", "first.start", "first.end", "second.start", "second.end"].map(at)
  assert.ok(boundaries.every((n, i) => i === 0 || n >= boundaries[i - 1]!))
  for (const event of sample.events.filter((e) => e.kind === "wire" && e.name === "send")) {
    const message = event.message!
    assert.ok(
      sample.events.some((e) =>
        e.kind === "wire" && e.name === "receive" && e.at >= event.at && e.at <= boundaries[5]! &&
        e.message?.["id"] === message["id"] && e.message?.["sessionId"] === message["sessionId"] &&
        e.message?.["error"] === undefined
      ),
      `Missing successful reply for ${message["method"]}`
    )
  }
  assert.ok(sample.events.some((e) => e.name === "send" && e.message?.["method"] === "Page.navigate"))
  assert.ok(sample.events.some((e) => e.name === "receive" && e.message?.["method"] === "Page.lifecycleEvent"))
  for (const [start, end] of [[boundaries[2]!, boundaries[3]!], [boundaries[4]!, boundaries[5]!]] as const) {
    assert.ok(
      sample.events.some((e) =>
        e.name === "send" && e.at >= start && e.at <= end && e.message?.["method"] === "Runtime.callFunctionOn"
      ),
      "Missing title execution"
    )
  }
  if (sample.library === "strider") {
    const marks = ["realm.start", "realm.end", "install.start", "install.end"].map(at)
    assert.ok(marks[0]! >= boundaries[2]! && marks[3]! <= boundaries[3]!)
    assert.ok(marks.every((n, i) => i === 0 || n >= marks[i - 1]!))
    assert.ok(
      sample.events.some((e) =>
        e.name === "send" && e.at >= marks[0]! && e.at <= marks[1]! &&
        e.message?.["method"] === "Page.createIsolatedWorld"
      ),
      "Missing realm creation"
    )
    assert.ok(
      sample.events.some((e) =>
        e.name === "send" && e.at >= marks[2]! && e.at <= marks[3]! &&
        e.message?.["method"] === "Runtime.callFunctionOn"
      ),
      "Missing engine installation"
    )
  }
}
