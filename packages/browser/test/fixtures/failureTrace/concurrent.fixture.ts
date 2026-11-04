import { expect, it } from "vitest"
import { connection } from "../../integration/failureTrace.ts"
let entered = 0
let release: () => void
const together = new Promise<void>((resolve) => {
  release = resolve
})
for (const name of ["A", "B"]) {
  it.concurrent(`ambiguous concurrent creator ${name}`, async () => {
    if (++entered === 2) release()
    await together
    connection(`concurrent-${name}`)("receive", `CONCURRENT_${name}`)
    expect(false).toBe(true)
  })
}
