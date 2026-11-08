/** Manual probe: retain shared rendering diagnostics after an unrelated ordinary fill test. */
import { afterEach, expect } from "vitest"
import "../../integration/slice/Chromium.slice.test.ts"

afterEach(() => expect.fail("Deliberate rendering failure-trace probe after cleanup"))
