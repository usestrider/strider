import { registerHooks } from "node:module"
registerHooks({
  load(url, context, next) {
    const result = next(url, context)
    if (url.endsWith("/src/chromium/Chromium.ts")) {
      return {
        ...result,
        source: String(result.source).replace(
          "CdpAdapter.connect(transport,",
          "CdpAdapter.connect(globalThis.__rook13Trace(transport),"
        )
      }
    }
    return result
  }
})
