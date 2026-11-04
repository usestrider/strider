import { it } from "vitest"
import { connection } from "../../integration/failureTrace.ts"
it("discards passing context", () => connection("pass")("send", "PASS_FILE_ONLY"))
