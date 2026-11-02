import { registerHooks } from "node:module"
registerHooks({
  load(url, context, next) {
    const result = next(url, context)
    if (!url.endsWith("/playwright-core/lib/coreBundle.js")) return result
    let source = String(result.source)
    const send = "this._protocolLogger(\"send\", message);\n        this._transport.send(message);"
    const receive = "async _onMessage(message) {\n        this._protocolLogger(\"receive\", message);"
    if (!source.includes(send) || !source.includes(receive)) {
      throw new Error("Pinned Playwright instrumentation anchors changed")
    }
    source = source.replace(
      send,
      "this._protocolLogger(\"send\", message);\n        globalThis.__rookPWDispatch(this, message, () => this._transport.send(message));"
    )
    source = source.replace(
      receive,
      "async _onMessage(message) {\n        globalThis.__rookPWReceive(this, message);\n        this._protocolLogger(\"receive\", message);"
    )
    return { ...result, source }
  }
})
