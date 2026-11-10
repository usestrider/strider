import * as fs from "node:fs"
import { integrationEnvironment } from "./platform.ts"

integrationEnvironment(process.platform, process.env)

// CI's Firefox job logs Firefox's own IndexedDB and storage modules beside the failure traces, which CI keeps: a read
// of a page's storage sometimes goes unanswered for seconds, and the protocol traffic can't show what Firefox does
// inside the page. Firefox's processes inherit the variables (the launcher gives them no environment of its own);
// `rotate:64` keeps the log within 64 MB for each browser process by overwriting its oldest part, and nothing here touches a check or deadline.
if (process.env["STRIDER_INTEGRATION_JOB"] === "firefox" && process.env["MOZ_LOG"] === undefined) {
  const directory = `${process.cwd()}/.data/integration-failures`
  fs.mkdirSync(directory, { recursive: true })
  process.env["MOZ_LOG"] = "timestamp,rotate:64,IndexedDB:4,QuotaManager:4,LocalStorage:4"
  process.env["MOZ_LOG_FILE"] = `${directory}/firefox-moz-log-%PID.txt`
}
