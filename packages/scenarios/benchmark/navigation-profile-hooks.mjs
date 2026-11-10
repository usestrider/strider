import { registerHooks } from "node:module"

export const transform = (url, source) => {
  const mark = (name) => `globalThis.__navigationTrace.mark(${JSON.stringify(name)});`
  const rules = [
    ["/chromium/Chromium.ts", [[
      "CdpAdapter.connect(transport, { sink, ownership: \"launched\" })",
      "CdpAdapter.connect(globalThis.__navigationTrace.transport(transport), { sink, ownership: \"launched\" })"
    ]]],
    ["/internal/runtime.ts", [
      [
        "      const realm = yield* model.adapter.realm(document, yield* engineWorld({ model }))",
        `${
          mark("realm.start")
        }\n      const realm = yield* model.adapter.realm(document, yield* engineWorld({ model }))\n      ${
          mark("realm.end")
        }\n      ${mark("install.start")}`
      ],
      [
        "      if (installed._tag === \"Exception\") {",
        `${mark("install.end")}\n      if (installed._tag === "Exception") {`
      ]
    ]],
    ["/playwright-core/lib/coreBundle.js", [
      [
        "        this._protocolLogger(\"send\", message);",
        "        globalThis.__navigationTrace.wire(\"send\", message);\n        this._protocolLogger(\"send\", message);"
      ],
      [
        "        this._protocolLogger(\"receive\", message);",
        "        globalThis.__navigationTrace.wire(\"receive\", message);\n        this._protocolLogger(\"receive\", message);"
      ]
    ]]
  ]
  const rule = rules.find(([suffix]) => url.endsWith(suffix))
  if (!rule) return source
  for (const [before, after] of rule[1]) {
    if (source.split(before).length !== (url.endsWith("/playwright-core/lib/coreBundle.js") ? 6 : 2)) {
      throw new Error(`Navigation profiler site not unique in ${url}: ${before}`)
    }
    source = source.replaceAll(before, after)
  }
  return source
}

registerHooks({
  load(url, context, nextLoad) {
    const result = nextLoad(url, context)
    return { ...result, ...(result.source == null ? {} : { source: transform(url, String(result.source)) }) }
  }
})
