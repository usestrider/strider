// Opt-in pinned-bundle observation only. Fail closed when the source sites change.
import { registerHooks } from "node:module"
registerHooks({
  load(url, context, nextLoad) {
    const result = nextLoad(url, context)
    if (!url.endsWith("/playwright-core/lib/coreBundle.js")) return result
    let source = String(result.source)
    for (
      const [before, after] of [
        [
          "        this._protocolLogger(\"send\", message);",
          "        globalThis.__observationTrace.wire(\"send\", message);\n        this._protocolLogger(\"send\", message);"
        ],
        [
          "        this._protocolLogger(\"receive\", message);",
          "        globalThis.__observationTrace.wire(\"receive\", message);\n        this._protocolLogger(\"receive\", message);"
        ],
        [
          "          const resolved = await progress3.race(this.selectors.callOnSelectorHandle(target,",
          "          globalThis.__observationTrace.mark(\"pw.selectorAttempt\");\n          const resolved = await progress3.race(this.selectors.callOnSelectorHandle(target,"
        ]
      ]
    ) {
      if (!source.includes(before)) throw new Error(`Observation profiler site missing: ${before}`)
      source = source.replaceAll(before, after)
    }
    return { ...result, source }
  }
})
