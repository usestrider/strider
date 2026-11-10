/**
 * Stock WebKit's capabilities, attached and launched: what its remote inspector serves, and what a launched
 * browser's Automation session adds. The documentation tools read them too.
 */
import * as Option from "effect/Option"
import * as Browser from "../../Browser.ts"
import type * as Adapter from "../adapter.ts"

// ── Capabilities ──────────────────────────────────────────────────────────────────────────────────────────

/**
 * Stock WebKit's, attached: what its remote inspector serves. It has no `Input`, `Dialog`,
 * `Emulation` or `Screencast` domain, no navigate command, no worlds of its own and no `DOM.describeNode`, and no
 * events for a frame's attachment, a same-document navigation, a file chooser or a download.
 */
export const attachedCapabilities = (info: Browser.Info, video = false) => {
  const evidence = `WebKit adapter, attached, ${info.product} ${info.revision}`
  const noInput = "stock WebKit's inspector protocol has no Input domain"
  const noEmulation = "stock WebKit's inspector has no Emulation domain"
  const noDownloads = "stock WebKit's inspector reports no downloads"
  const noPdf = "WebKit has no print-to-PDF"
  const entry = (
    name: string,
    status: Browser.CapabilityEntry["status"],
    limitations: ReadonlyArray<string> = []
  ): Browser.CapabilityEntry => ({ name, status, evidence, limitations: [...limitations] })
  return new Browser.CapabilitySet({
    entries: [
      entry("network.timing.redirect", "unsupported", ["redirect responses omit native timing origins"]),
      entry("network.timing", "unsupported", ["timing collection requires a newly created context"]),
      entry("input.topLevelDesignMode", "unsupported", [noInput]),
      entry("userContexts", "unsupported", [
        "stock WebKit's inspector makes no contexts or pages: the browser's own are observed"
      ]),
      entry("acceptInsecureCerts", "unsupported", ["an attached process cannot be reconfigured"]),
      entry("userContexts.proxy", "unsupported", ["an attached process cannot be reconfigured"]),
      entry("userContexts.proxy.credentials", "unsupported", ["stock WebKit does not support proxy credentials"]),
      entry("boundingBox.frameTransforms", "supported"),
      entry("isolatedWorlds", "unsupported", [
        "stock WebKit's inspector makes no worlds, so Strider's engine runs in the page's own"
      ]),
      entry("pauseOnStart.frames", "supported", ["frames run in their page's process, which is paused"]),
      entry("pauseOnStart.workers", "supported"),
      entry("pauseOnStart.popups", "unsupported", [
        "a page the browser opens is found by reading the inspector's list"
      ]),
      entry("initScripts.workers", "supported", ["dedicated workers started after the script was declared"]),
      entry("input.native", "unsupported", [noInput]),
      entry("input.keyboardLayout", "unsupported", [noInput]),
      entry("input.insertText", "unsupported", [noInput]),
      entry("input.pointerModifiers", "unsupported", [noInput]),
      entry("input.dragAndDrop", "unsupported", [noInput]),
      entry("input.touch", "unsupported", [noInput]),
      // An intercept never sees the requests of a page a service worker controls, even those the worker passes to
      // the network
      entry("interception.request", "partial", ["a page a service worker controls sends its requests past it"]),
      entry("interception.response", "partial", ["a page a service worker controls sends its requests past it"]),
      entry("interception.auth", "unsupported", ["WebKit answers challenges from credentials set in advance"]),
      entry("network.challenges", "unsupported", [
        "a challenge waits on the MiniBrowser, and neither the inspector nor Automation can answer it"
      ]),
      entry("interception.responseBody", "unsupported", ["WebKit can't read a response paused there"]),
      entry("interception.responseFulfill", "supported"),
      entry("interception.responseHeaders", "unsupported", [
        "WebKit can't read a response paused there, so it can't send it on with new headers"
      ]),
      entry("interception.continueUrl", "supported"),
      entry("interception.abortReason", "unsupported", ["WebKit reports every reason as \"Blocked by Web Inspector\""]),
      entry("interception.redirects", "partial", ["only a redirect's first hop pauses"]),
      entry("bodies", "supported"),
      entry("console", "supported", ["a message with only primitive arguments is attributed to the main frame"]),
      entry("prompts", "unsupported", [
        "stock WebKit's inspector has no Dialog domain: a dialog blocks the page unreported"
      ]),
      entry("prompts.kind", "unsupported", ["stock WebKit's inspector has no Dialog domain"]),
      entry("popups.opener", "unsupported", [
        "stock WebKit names no page's opener: a page another opens is reported as the browser's"
      ]),
      entry("close.runBeforeUnload", "unsupported", ["stock WebKit's inspector closes no pages"]),
      entry("navigation.referrer", "unsupported", [
        "stock WebKit navigates by script, with the document's own referrer"
      ]),
      entry("navigation.traverse", "unsupported", [
        "stock WebKit's inspector reports going back or forward under the old document's URL"
      ]),
      entry("navigation.sameDocument", "unsupported", [
        "stock WebKit's inspector reports no same-document navigation"
      ]),
      entry("frames.contentFrame", "unsupported", ["stock WebKit's inspector can't say which frame an iframe holds"]),
      entry("frames.readiness", "partial", [
        "a frame's load is reported for the page's main frame only"
      ]),
      entry("fileChooser", "unsupported", ["stock WebKit's inspector reports no file chooser"]),
      entry("downloads", "unsupported", [`${noDownloads}: a navigation that becomes one ends as BecameDownload`]),
      entry("downloads.progress", "unsupported", [noDownloads]),
      entry("downloads.cancel", "unsupported", [noDownloads]),
      entry("screenshot", "supported"),
      entry("screenshot.format", "partial", ["PNG only: stock WebKit's snapshotRect writes nothing else"]),
      entry("screenshot.cssScale", "unsupported", ["stock WebKit's snapshotRect captures device pixels, as PNG"]),
      entry("screenshot.omitBackground", "unsupported", ["stock WebKit's inspector has no background override"]),
      entry("pdf", "unsupported", [noPdf]),
      entry("pdf.headerFooter", "unsupported", [noPdf]),
      entry("pdf.preferCssPageSize", "unsupported", [noPdf]),
      entry("evaluation.userActivation", "supported"),
      entry("webSocketFrames", "supported"),
      entry("networkConnections", "partial", ["no EventSource connections: WebKit reports only their request"]),
      entry("networkConnections.eventSource", "unsupported", ["WebKit reports an EventSource as a request"]),
      entry("network.servedBy", "supported", [
        "a script or stylesheet reused from the memory cache within one document produces no request"
      ]),
      entry("network.requestBody.redirects", "supported", []),
      entry("network.requestBody.absence", "unsupported", [
        "empty or missing native text cannot establish absence or completeness"
      ]),
      entry("network.requestBody.empty", "unsupported", [
        "empty native reports can omit Blob or File payloads and are refused"
      ]),
      entry("network.requestBody.multipart", "unsupported", [
        "multipart file completeness cannot be established from the native report"
      ]),
      entry("network.requestBody.bytes", "unsupported", ["stock WebKit exposes decoded text, not original bytes"]),
      entry("network.requestBody.text", "partial", [
        "nonempty protocol-reported text only; empty, missing and multipart reports cannot establish completeness and are refused"
      ]),
      entry("network.failure", "supported"),
      entry("network.headersSent", "partial", [
        "without the Cookie header, which WebKitGTK's network process doesn't report"
      ]),
      entry("workers.shared", "unsupported", ["WebKit doesn't report shared workers"]),
      entry("workers.service", "unsupported", ["WebKit doesn't report service workers"]),
      entry("workers.evaluate", "supported"),
      entry("exceptions.kind", "supported"),
      entry("cookies", "partial", [
        "a context's list is the cookies its pages' documents and resources are sent"
      ]),
      entry("cookies.partitioned", "unsupported", ["WebKit doesn't report partitioned cookies"]),
      entry("storageState.closedFileHistory", "unsupported", [
        "file storage and file-top child partitions survive page closure; replacement refuses for the context lifetime"
      ]),
      entry("storageState.closedOpaqueHistory", "unsupported", [
        "opaque partition reachability across surviving descendants and workers is not established; replacement conservatively refuses for the context lifetime"
      ]),
      entry("storageState.partitioned", "supported", [
        "stock WebKit keys a frame's storage by its top-level origin, port included: a state saved without one is restored at its site's default port"
      ]),
      entry("permissions", "unsupported", [noEmulation]),
      entry("permissions.anyOrigin", "unsupported", [noEmulation]),
      ...[
        "emulation.viewport",
        "emulation.viewport.mobile",
        "emulation.userAgent",
        "emulation.locale",
        "emulation.timezone",
        "emulation.geolocation",
        "emulation.geolocation.unavailable",
        "emulation.media",
        "emulation.network.offline",
        "emulation.network.throttling",
        "emulation.cpuSlowdown",
        "emulation.javaScript",
        "emulation.extraHTTPHeaders",
        "emulation.touch",
        "emulation.focus"
      ].map((name) => entry(name, "unsupported", [noEmulation])),
      entry("snapshot.clickListeners", "unsupported", ["WebKit can't list event listeners"]),
      entry("capability.virtualAuthenticator", "unsupported", [
        "Stock WebKit Automation refuses credential management; inspector has no WebAuthn domain"
      ]),
      entry("capability.axTree", "unsupported", ["WebKit reads accessibility one node at a time"]),
      entry("capability.screencast", "unsupported", ["stock WebKit's inspector has no Screencast domain"]),
      entry(
        "capability.video",
        video ? "supported" : "unsupported",
        video
          ? ["Explicit PNG polling; variable-rate output can miss states between captures"]
          : ["Stock WebKit video requires video polling options and a VideoWriter service"]
      )
    ]
  })
}

/** The capability an override is applied under, and refused under where it's unsupported. */
export const overrideCapability = (override: Adapter.Override): string | undefined => {
  switch (override._tag) {
    case "Viewport":
      return override.mobile || override.deviceScaleFactor !== 1 ? "emulation.viewport.mobile" : "emulation.viewport"
    case "UserAgent":
      return "emulation.userAgent"
    case "Locale":
      return "emulation.locale"
    case "TimeZone":
      return "emulation.timezone"
    case "Geolocation":
      return Option.isNone(override.position) ? "emulation.geolocation.unavailable" : "emulation.geolocation"
    case "Media":
      return "emulation.media"
    case "Offline":
      return "emulation.network.offline"
    case "NetworkConditions":
      return "emulation.network.throttling"
    case "CpuThrottling":
      return "emulation.cpuSlowdown"
    case "JavaScriptEnabled":
      return "emulation.javaScript"
    case "ExtraHeaders":
      return "emulation.extraHTTPHeaders"
    case "Touch":
      return "emulation.touch"
    case "FocusEmulation":
      return "emulation.focus"
    default:
      return undefined
  }
}

/**
 * Stock WebKit launched in automation mode: the attached table, with what its Automation
 * session drives: contexts as browser processes, pages, trusted input, dialogs whose kind it doesn't say, the
 * window's size as the viewport, and file inputs. History traversal stays unsupported (`navigation.traverse`).
 */
export const launchedCapabilities = (info: Browser.Info, video = false) => {
  const evidence = `WebKit adapter, launched, ${info.product} ${info.revision}`
  const differ: Readonly<Record<string, readonly [Browser.CapabilityEntry["status"], ReadonlyArray<string>]>> = {
    "network.timing": ["partial", [
      "context-creation opt-in; ambiguous zero phases and TLS timing unavailable; redirect end is an observation bound"
    ]],
    acceptInsecureCerts: ["supported", ["native capability in the context-owned process"]],
    userContexts: ["supported", ["each context is a browser process of its own"]],
    "userContexts.proxy": ["supported", [
      "isolated process environment; HTTP proxy endpoints only; loopback stays direct"
    ]],
    "pauseOnStart.popups": ["unsupported", [
      "a page a page opens is found when the browser lists it, and isn't paused"
    ]],
    "input.topLevelDesignMode": ["supported", []],
    "input.native": ["supported", ["Automation's simulated input, which the page trusts"]],
    "input.insertText": ["supported", []],
    "input.keyboardLayout": ["unsupported", [
      "Automation types characters and named keys, not a layout's physical keys"
    ]],
    "input.pointerModifiers": ["supported", []],
    "input.dragAndDrop": ["unsupported", ["untested with Automation's pointer"]],
    "input.touch": ["unsupported", ["WebKitGTK builds its Automation without touch"]],
    prompts: ["partial", ["a dialog's kind and default text aren't reported"]],
    "prompts.kind": ["unsupported", [
      "every dialog is Unknown: stock WebKit's Automation says one is open, not which kind"
    ]],
    "close.runBeforeUnload": ["unsupported", ["stock WebKit's Automation closes a page without asking it"]],
    fileChooser: ["unsupported", [
      "a chooser a click opens is cancelled by the browser, unreported; a file input's files are set (setInputFiles)"
    ]],
    "emulation.viewport": ["partial", ["the window is sized to it; no device scale or mobile viewport"]],
    "emulation.viewport.mobile": ["unsupported", ["no mobile viewport"]],
    "emulation.javaScript": ["supported", []],
    "emulation.media": ["supported", []],
    "emulation.extraHTTPHeaders": ["supported", []],
    "emulation.focus": ["unsupported", ["each page is a window of its own"]],
    "emulation.timezone": ["unsupported", ["taken at launch, before a context's options reach it"]],
    "emulation.locale": ["unsupported", [
      "the MiniBrowser takes its language from nothing it's given"
    ]],
    "cookies": ["partial", [
      "a context's list is the cookies its open pages' documents and resources are sent, and a host's cookie is set as its domain's"
    ]],
    "frames.contentFrame": ["supported", [
      "found through Automation, by its document"
    ]]
  }
  const base = attachedCapabilities(info, video).entries
  const entries = base.map((entry) => {
    const different = differ[entry.name]
    return different === undefined
      ? { ...entry, evidence }
      : { ...entry, evidence, status: different[0], limitations: [...different[1]] }
  })
  for (const [name, [status, limitations]] of Object.entries(differ)) {
    if (!entries.some((entry) => entry.name === name)) {
      entries.push({ name, status, evidence, limitations: [...limitations] })
    }
  }
  return new Browser.CapabilitySet({ entries })
}
