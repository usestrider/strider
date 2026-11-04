import { beforeEach, expect, it } from "vitest"
import { connection } from "../../integration/failureTrace.ts"
let shared: ReturnType<typeof connection> | undefined
beforeEach(() => {
  shared ??= connection("shared-hook-concurrent")
})
let entered = 0
let release: () => void
const together = new Promise<void>((resolve) => {
  release = resolve
})
for (const name of ["A", "B"]) {
  it.concurrent(`ambiguous concurrent creator ${name}`, async () => {
    if (++entered === 2) release()
    await together
    shared!("receive", `CONCURRENT_SHARED_${name}`)
    connection(`concurrent-${name}`)("receive", `CONCURRENT_${name}`)
    expect(false).toBe(true)
  })
}
