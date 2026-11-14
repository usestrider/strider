import * as path from "node:path"
import { describe, expect, it } from "vitest"
import { check, upstreamFileOf } from "../src/ledger.ts"
import { indexFile, root } from "../src/upstream.ts"

describe("the ledger", () => {
  it("holds together: expectations, ports and indexes agree", () => {
    expect(check()).toEqual([])
  })

  it("finds a port's original from its path", () => {
    expect(upstreamFileOf(path.join(root, "ports/playwright/library/chromium/oopif.test.ts"))).toEqual({
      source: "playwright",
      file: "tests/library/chromium/oopif.spec.ts"
    })
    expect(upstreamFileOf(path.join(root, "ports/puppeteer/oopif.test.ts"))).toEqual({
      source: "puppeteer",
      file: "test/src/oopif.test.ts"
    })
    expect(() => upstreamFileOf(path.join(root, "ports/harness/server.ts"))).toThrow("isn't a port file")
  })
})

describe("indexing an upstream file", () => {
  it("keys Playwright's tests by the ID their titles start with", () => {
    const code = `
import { test as it, expect } from './pageTest';
it.use({ launchOptions: { args: ['--site-per-process'] } });
it.describe('group', () => {
  it('AB-001 does a thing', async ({ page, browserName }) => {
    it.skip(browserName === 'webkit', 'no reason');
    await page.click('button');
  });
  for (const type of ['a', 'b'])
    it(\`AB-002 loops over \${type}\`, async () => {});
  it.fixme('AB-003 is broken', async () => {});
});
it('AB-004 ' + 'is concatenated', async () => {});
browserTest('AB-005 uses a fixture-extended test', async ({ contextFactory }) => {});
`
    const { tests, annotations } = indexFile("prefixed", "tests/page/sample.spec.ts", code, [])
    expect(tests.map((test) => test.key)).toEqual(["AB-001", "AB-002", "AB-003", "AB-004", "AB-005"])
    expect(tests[0]).toMatchObject({
      title: "does a thing",
      describe: ["group"],
      line: 5,
      annotations: ["it.skip(browserName === 'webkit', 'no reason')"]
    })
    expect(tests[1]).toMatchObject({ dynamic: true, title: "loops over ${type}" })
    expect(tests[2]).toMatchObject({ modifier: "fixme", title: "is broken" })
    expect(annotations).toEqual(["it.use({ launchOptions: { args: ['--site-per-process'] } })"])
  })

  it("keys Puppeteer's tests as its runner does, with its expectations", () => {
    const code = `
describe('OOPIF', function () {
  describe('nested', () => {
    it('should work', async () => {});
  });
  it('should not', async () => {});
});
`
    const { tests } = indexFile("mocha", "test/src/oopif.test.ts", code, [
      {
        testIdPattern: "[oopif.test] OOPIF nested *",
        platforms: ["linux"],
        parameters: ["firefox"],
        expectations: ["FAIL"]
      },
      { testIdPattern: "[other.test] *", platforms: ["linux"], parameters: [], expectations: ["SKIP"] }
    ])
    expect(tests.map((test) => test.key)).toEqual([
      "[oopif.test] OOPIF nested should work",
      "[oopif.test] OOPIF should not"
    ])
    expect(tests[0]!.upstream).toEqual([{ platforms: ["linux"], parameters: ["firefox"], expectations: ["FAIL"] }])
    expect(tests[1]!.upstream).toBeUndefined()
  })

  it("changes a test's hash when its source changes", () => {
    const hash = (body: string) =>
      indexFile("prefixed", "tests/page/sample.spec.ts", `it('AB-001 x', async () => { ${body} });`, [])
        .tests[0]!.hash
    expect(hash("await a();")).not.toEqual(hash("await b();"))
  })
})
