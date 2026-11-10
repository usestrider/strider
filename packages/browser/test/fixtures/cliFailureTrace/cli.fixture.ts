/** Manual probe: the real CLI cases fail only after their normal cleanup has run. */
import { afterEach, expect } from "vitest"
import "../../integration/Cli.test.ts"

afterEach(() => expect.fail("Deliberate CLI failure-trace probe after cleanup"))
