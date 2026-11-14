import { firefoxPrefs } from "../../src/internal/profiles.ts"
import * as FirefoxCrashReports from "./firefoxCrashReports.ts"
import { integrationEnvironment } from "./platform.ts"

integrationEnvironment(process.platform, process.env)

// Every Firefox the tests launch writes the crash reports of a content process it kills (`firefoxCrashReports.ts`)
Object.assign(process.env, FirefoxCrashReports.environment)
for (const prefs of Object.values(firefoxPrefs)) Object.assign(prefs, FirefoxCrashReports.prefs)
// and its reports move out of its profile, which the launcher deletes, once it exits
FirefoxCrashReports.install()
