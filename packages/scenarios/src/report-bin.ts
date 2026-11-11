/** Browser-free report generation from preserved measurements. */
import * as fs from "node:fs"
import { combine, type Measurements, type ReportContext } from "./report.ts"

const argv = process.argv.slice(2)
const files: Array<string> = []
let output: string | undefined
let context: ReportContext | undefined
for (let i = 0; i < argv.length; i++) {
  const argument = argv[i]!
  if (argument === "--output" || argument === "--context") {
    const value = argv[++i]
    if (value === undefined || value.startsWith("--")) throw new Error(`Missing value for ${argument}`)
    if (argument === "--output") output = value
    else context = JSON.parse(fs.readFileSync(value, "utf8")) as ReportContext
  } else if (argument.startsWith("--")) throw new Error(`Unknown option: ${argument}`)
  else files.push(argument)
}
if (output === undefined || files.length < 2) {
  throw new Error(
    "Usage: pnpm scenarios:report --output RESULTS.md [--context observations.json] chromium/measurements.json firefox/measurements.json"
  )
}
const measurements = files.map((file) => JSON.parse(fs.readFileSync(file, "utf8")) as Measurements)
const written = combine(measurements, context)
fs.writeFileSync(output, written)
process.stdout.write(`Wrote combined report to ${output}\n`)
