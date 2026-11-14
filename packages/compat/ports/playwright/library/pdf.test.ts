/**
 * Playwright's `tests/library/pdf.spec.ts`: printing a page to PDF. Chromium only, as the original is.
 *
 * What the port changes:
 * - `page.pdf({ path })` is `page.pdf()`, which returns the document's bytes; Playwright also writes them to `path`, and
 *   the port checks the bytes the file would hold, so it writes nothing.
 * - PD-002 sets `tagged` and `outline`, which Strider's PDF options don't have (the matrix rows for both are missing),
 *   so it is `needsFeature` in the ledger and not ported.
 */
import { assert } from "@effect/vitest"
import * as Effect from "effect/Effect"
import { upstream } from "../../harness/upstream.ts"

upstream(import.meta.filename, {}, (test) => {
  test("PD-001", { browsers: ["chromium"] }, ({ page }) =>
    Effect.gen(function*() {
      const bytes = yield* page.pdf()
      assert.isAbove(bytes.byteLength, 0)
    }))
})
