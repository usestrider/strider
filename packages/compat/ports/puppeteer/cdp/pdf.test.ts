/**
 * Puppeteer's `test/src/cdp/pdf.test.ts`: printing a page to PDF with its paper size in millimetres and points.
 *
 * What the port changes:
 * - Puppeteer's `page.pdf({ path })` writes the file, and the test reads it back. Strider's `page.pdf()` returns the
 *   bytes, which the port reads as the original's file contents (`PD-001` in the Playwright `pdf` port does too).
 * - `tagged` and `outline` aren't Strider's PDF options (`option-page-pdf-tagged`, `option-page-pdf-outline`), so the
 *   first two tests are `needsFeature` in the ledger and aren't ported.
 * - The custom size is Strider's `paper` with a `Length` in `in`, `cm`, `mm`, or `px`. The test's `72pt` by `6pc` is
 *   one inch square, which Strider's inch is: the same page, so the port asks for `1 in` by `1 in` and checks the same
 *   MediaBox. The millimetre size is the original's.
 * - WebKit has no PDF (`method-page-pdf`), so the ledger marks it there.
 */
import { assert } from "@effect/vitest"
import * as Effect from "effect/Effect"
import { upstream } from "../../harness/upstream.ts"

const load = { waitUntil: "load" } as const

upstream(import.meta.filename, {}, (test) => {
  test("Page.pdf can print to PDF with custom mm and pt dimensions", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/pdf.html", load)
      const mmPdf = yield* page.pdf({
        paper: { width: { value: 556.27, unit: "mm" }, height: { value: 145.27, unit: "mm" } }
      })
      const mmText = new TextDecoder("latin1").decode(mmPdf)
      const mediaBoxMatch = mmText.match(/\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/)
      assert.isNotNull(mediaBoxMatch)
      assert.strictEqual(Math.round(Number(mediaBoxMatch![1])), 1577)
      assert.strictEqual(Math.round(Number(mediaBoxMatch![2])), 412)

      // Puppeteer's `width: '72pt', height: '6pc'`: one inch square
      const ptPdf = yield* page.pdf({
        paper: { width: { value: 1, unit: "in" }, height: { value: 1, unit: "in" } }
      })
      const ptText = new TextDecoder("latin1").decode(ptPdf)
      assert.include(ptText, "/MediaBox [0 0 72 72]")
    }))
})
