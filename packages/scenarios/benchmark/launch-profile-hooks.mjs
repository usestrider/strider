// Diagnostic source transforms only: assert exact sites, add timestamps, preserve ordering and arguments.
import { registerHooks } from "node:module"

const mark = (name) => `globalThis.__launchTrace.mark(${JSON.stringify(name)});`
const rules = [
  ["/internal/chromiumLauncher.ts", [
    [
      "  const path = yield* Launch.executable(options.executablePath)",
      `${mark("executable.start")}\n  const path = yield* Launch.executable(options.executablePath)\n  ${
        mark("executable.end")
      }`
    ],
    [
      "  const userDataDir = yield* Launch.profileDirectory(options.userDataDir, \"strider-chromium-\")",
      `${
        mark("profile.start")
      }\n  const userDataDir = yield* Launch.profileDirectory(options.userDataDir, "strider-chromium-")\n  ${
        mark("profile.end")
      }`
    ],
    [
      "  const transport = yield* Transport.pipe(launched.handle)",
      `${mark("transport.start")}\n  const transport = yield* Transport.pipe(launched.handle)\n  ${
        mark("transport.end")
      }`
    ]
  ]],
  ["/internal/launch.ts", [
    [
      "  const handle = yield* ChildProcess.make(file, fileArgs, {",
      `${
        mark("spawn.start")
      }\n  globalThis.__launchTrace.mark("spawn.args", { file, args: fileArgs });\n  const handle = yield* ChildProcess.make(file, fileArgs, {`
    ],
    ["  launched = { _tag: \"Browser\",", `${mark("spawn.end")}\n  launched = { _tag: "Browser",`],
    ["  return {\n    executable,", `${mark("launcher.bookkeeping.end")}\n  return {\n    executable,`]
  ]],
  ["/chromium/Chromium.ts", [
    [
      "CdpAdapter.connect(transport, { sink, ownership: \"launched\" })",
      "CdpAdapter.connect(globalThis.__launchTrace.transport(transport), { sink, ownership: \"launched\" })"
    ]
  ]],
  ["/internal/cdpAdapter.ts", [
    [
      "    const cleanupScope = yield* Effect.scope",
      `    ${mark("adapter.start")}\n    const cleanupScope = yield* Effect.scope`
    ],
    [
      "    root = client.root",
      `    ${
        mark("client.ready")
      }\n    root = client.root;\n    globalThis.__launchTrace.rootCommand = () => Effect.runPromise(BrowserCdp.getVersion().pipe(Protocol.on(root), Effect.timeout("2 seconds")));`
    ],
    [
      "    state.defaultUserAgent = version.userAgent",
      `    ${mark("version.ready")}\n    state.defaultUserAgent = version.userAgent`
    ],
    [
      "    const contextIds = yield* Target.getBrowserContexts()",
      `    ${mark("contexts.start")}\n    const contextIds = yield* Target.getBrowserContexts()`
    ],
    [
      "    const defaultEntry = new State.ContextEntry(",
      `    ${mark("contexts.end")}\n    const defaultEntry = new State.ContextEntry(`
    ],
    [
      "    yield* Declare.applyDownloads(state, defaultEntry).pipe(Effect.ignore)",
      `    ${
        mark("downloads.start")
      }\n    yield* Declare.applyDownloads(state, defaultEntry).pipe(Effect.ignore)\n    ${mark("downloads.end")}`
    ],
    ["    yield* Target.setAutoAttach({", `    ${mark("autoattach.start")}\n    yield* Target.setAutoAttach({`],
    [
      "    yield* root.drainObserved",
      `    ${mark("autoattach.ack")}\n    yield* root.drainObserved\n    ${mark("targets.drained")}`
    ],
    ["    return {\n      ownership:", `    ${mark("adapter.end")}\n    return {\n      ownership:`]
  ]],
  ["/internal/browser.ts", [
    [
      "    const { sink, attach } = yield* Model.make()",
      `    ${mark("model.start")}\n    const { sink, attach } = yield* Model.make()\n    ${mark("model.sink.ready")}`
    ],
    [
      "    const model = yield* attach(adapter)",
      `    ${mark("model.attach.start")}\n    const model = yield* attach(adapter)\n    ${mark("model.attach.end")}`
    ],
    [
      "    return yield* make(model)",
      `    ${mark("browser.make.start")}\n    const result = yield* make(model)\n    ${
        mark("browser.make.end")
      }\n    return result`
    ]
  ]],
  ["/internal/cdpAdapter/targets.ts", [
    [
      "      Effect.scoped\n    )\n  }\n)",
      "      Effect.scoped,\n      Effect.ensuring(Effect.sync(() => globalThis.__launchTrace.mark(\"target.gate.end\", { targetId: target.targetId, kind: target.kind })))\n    )\n  }\n)"
    ],
    [
      "  const on = Protocol.on(target.session)\n  const autoAttach = Target.setAutoAttach({",
      "  globalThis.__launchTrace.mark(\"target.snapshot.start\", { targetId: target.targetId, kind: target.kind });\n  const on = Protocol.on(target.session)\n  const autoAttach = Target.setAutoAttach({"
    ],
    [
      "  const { result, received, failure } = yield* initialized",
      "  const { result, received, failure } = yield* initialized\n  globalThis.__launchTrace.mark(\"target.snapshot.end\", { targetId: target.targetId, kind: target.kind });"
    ]
  ]],
  ["/playwright-core/lib/coreBundle.js", [
    [
      "        this._sessions.set(\"\", this.rootSession);",
      "        this._sessions.set(\"\", this.rootSession);\n        globalThis.__launchTrace.rootCommand = () => this.rootSession.send(\"Browser.getVersion\");"
    ],
    [
      "          await browser._waitForAllPagesToBeInitialized();",
      `          await browser._waitForAllPagesToBeInitialized();\n          ${mark("pw.persistent.ready")}`
    ],
    [
      "      async _prepareToLaunch(options, isPersistent, userDataDir) {",
      `      async _prepareToLaunch(options, isPersistent, userDataDir) {\n        ${mark("pw.profile.start")}`
    ],
    [
      "        return { executable, browserArguments, userDataDir, artifactsDir, tempDirectories };",
      `        ${
        mark("pw.profile.end")
      }\n        globalThis.__launchTrace.mark("spawn.args", { file: executable, args: browserArguments });\n        return { executable, browserArguments, userDataDir, artifactsDir, tempDirectories };`
    ],
    [
      "  const spawnedProcess = childProcess.spawn(options.command, options.args || [], spawnOptions);",
      `  ${
        mark("pw.spawn.start")
      }\n  const spawnedProcess = childProcess.spawn(options.command, options.args || [], spawnOptions);\n  ${
        mark("pw.spawn.end")
      }`
    ],
    [
      "          return { browserProcess, artifactsDir: prepared.artifactsDir, userDataDir: prepared.userDataDir, transport, wsEndpoint };",
      `          ${
        mark("pw.transport.ready")
      }\n          return { browserProcess, artifactsDir: prepared.artifactsDir, userDataDir: prepared.userDataDir, transport, wsEndpoint };`
    ],
    [
      "        const connection = new CRConnection(parent, transport, options.protocolLogger, options.browserLogsCollector);",
      `        ${
        mark("pw.adapter.start")
      }\n        const connection = new CRConnection(parent, transport, options.protocolLogger, options.browserLogsCollector);`
    ],
    [
      "        this._protocolLogger(\"send\", message);",
      "        globalThis.__launchTrace.wire(\"send\", message);\n        this._protocolLogger(\"send\", message);"
    ],
    [
      "        this._protocolLogger(\"receive\", message);",
      "        globalThis.__launchTrace.wire(\"receive\", message);\n        this._protocolLogger(\"receive\", message);"
    ],
    [
      "          return browser;\n        }\n        browser._defaultContext = new CRBrowserContext",
      `          ${
        mark("pw.adapter.end")
      }\n          return browser;\n        }\n        browser._defaultContext = new CRBrowserContext`
    ]
  ]]
]

registerHooks({
  load(url, context, nextLoad) {
    const result = nextLoad(url, context)
    const rule = rules.find(([suffix]) => url.endsWith(suffix))
    if (rule === undefined) return result
    let source = String(result.source)
    for (const [before, after] of rule[1]) {
      if (!source.includes(before)) throw new Error(`Launch profiler site missing in ${url}: ${before}`)
      source = source.replaceAll(before, after)
    }
    return { ...result, source }
  }
})
