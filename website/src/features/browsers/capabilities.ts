// What each backend supports, for the browser guides: `capabilities.json`, which `pnpm api-reference` writes from the
// adapters' own tables, with a label and a group for each capability's name. A capability the adapters add later
// shows under its name, in "Other", until it gets a label here.
import * as fs from "node:fs"
import * as path from "node:path"
import { datasetRoot } from "../reference/dataset.ts"

export type Status = "supported" | "partial" | "unsupported" | "unknown"

export interface Entry {
  readonly name: string
  readonly status: Status
  readonly limitations: ReadonlyArray<string>
}

export interface Backend {
  readonly id: "chromium" | "firefox" | "webkit"
  readonly label: string
  readonly layers: string
  /** As a browser Strider launched reports it; `null` for a backend that only attaches */
  readonly launched: ReadonlyArray<Entry> | null
  /** As a browser Strider attached to reports it; `null` for a backend that only launches */
  readonly attached: ReadonlyArray<Entry> | null
}

export const backends = (): ReadonlyArray<Backend> => {
  const file = path.join(datasetRoot(), "capabilities.json")
  if (!fs.existsSync(file)) {
    throw new Error(`${file} is missing. Run \`pnpm reference\` from the repository root to generate it.`)
  }
  return (JSON.parse(fs.readFileSync(file, "utf8")) as { backends: ReadonlyArray<Backend> }).backends
}

/** The capabilities, by group, in the order the guides show them; a label may use `code` */
export const groups: ReadonlyArray<{ readonly label: string; readonly names: Readonly<Record<string, string>> }> = [
  {
    label: "Contexts, pages and frames",
    names: {
      userContexts: "New contexts and pages",
      "userContexts.proxy": "HTTP proxies for a context",
      "userContexts.proxy.credentials": "Proxy credentials",
      isolatedWorlds: "Isolated worlds, where `page.evaluate` and Strider's engine run",
      "pauseOnStart.frames": "Declarations in place before a frame's first script",
      "pauseOnStart.workers": "Declarations in place before a worker's first script",
      "pauseOnStart.popups": "Declarations in place before a popup's first script",
      "frames.contentFrame": "Which frame an iframe holds",
      "frames.readiness": "Each frame's load state",
      "navigation.traverse": "`back` and `forward`",
      "navigation.sameDocument": "Same-document navigations: fragments and the History API",
      "navigation.referrer": "A navigation's referrer",
      "close.runBeforeUnload": "Closing with `runBeforeUnload`"
    }
  },
  {
    label: "Input",
    names: {
      "input.native": "Native input events",
      "input.webdriver": "WebDriver input actions",
      "input.insertText": "`insertText` without key events",
      "input.keyboardLayout": "Keyboard layouts",
      "input.pointerModifiers": "Modifiers on pointer actions",
      "input.dragAndDrop": "Native HTML drag and drop",
      "input.touch": "Touch input, `tap`",
      "capability.virtualAuthenticator": "Native virtual passkeys on one page, `Capability.VirtualAuthenticator`",
      "evaluation.userActivation": "Evaluating as a user gesture, `Page.withUserGesture`"
    }
  },
  {
    label: "Events",
    names: {
      console: "Console messages",
      "exceptions.kind": "Telling a throw from an unhandled rejection",
      prompts: "Dialogs",
      "prompts.kind": "Which kind a dialog is",
      fileChooser: "File choosers",
      downloads: "Downloads",
      "downloads.progress": "A download's progress",
      "downloads.cancel": "Canceling a download",
      "popups.opener": "Which page opened a popup, `Popup.next`",
      "workers.shared": "Shared workers",
      "workers.service": "Service workers",
      "workers.evaluate": "Evaluating in a worker",
      networkConnections: "WebSocket connections",
      "networkConnections.eventSource": "EventSource connections",
      webSocketFrames: "WebSocket frames"
    }
  },
  {
    label: "Network",
    names: {
      bodies: "Response bodies",
      "network.responseBody.terminalRedirect": "Bodies of terminal 301/302/303/307/308 responses without Location",
      "network.requestBody.bytes": "Collected request bytes",
      "network.requestBody.text": "Collected request text",
      "network.requestBody.absence": "Reporting absent request bodies",
      "network.requestBody.empty": "Distinguishing an empty request body",
      "network.requestBody.multipart": "Complete multipart request bodies",
      "network.requestBody.redirects": "Reading bodies by redirect hop",
      "network.headersSent": "The headers a request was sent with, `headersSent`",
      "network.servedBy": "What served a response, `servedBy`",
      "interception.request": "Routes at the request phase",
      "interception.response": "Routes at the response phase",
      "interception.auth": "Routes at an authentication challenge",
      "network.challenges": "The server's response to a challenge no route answers",
      "interception.responseBody": "Reading a paused response's body",
      "interception.responseFulfill": "Fulfilling at the response phase",
      "interception.responseHeaders": "Changing a response's status and headers",
      "interception.continueUrl": "Sending a request on to a new URL",
      "interception.abortReason": "Abort reasons other than `\"failed\"`",
      "interception.redirects": "Pausing every redirect hop",
      cookies: "Cookies",
      "cookies.partitioned": "Partitioned cookies",
      "storageState.partitioned": "Partitioned storage in a saved storage state",
      permissions: "Permission grants",
      "permissions.anyOrigin": "Granting to every origin at once"
    }
  },
  {
    label: "Emulation",
    names: {
      "emulation.viewport": "Viewport",
      "emulation.viewport.mobile": "Mobile viewport",
      "emulation.userAgent": "User agent",
      "emulation.locale": "Locale",
      "emulation.timezone": "Time zone",
      "emulation.geolocation": "Geolocation",
      "emulation.geolocation.unavailable": "An unavailable position",
      "emulation.media": "Media features, such as the color scheme",
      "emulation.network.offline": "Offline",
      "emulation.network.throttling": "Network throttling",
      "emulation.cpuSlowdown": "CPU slowdown",
      "emulation.javaScript": "Turning JavaScript off",
      "emulation.touch": "Touch",
      "emulation.focus": "Focus, `focus: \"emulated\"`"
    }
  },
  {
    label: "Scripts and captures",
    names: {
      "initScripts.workers": "Init scripts in workers",
      screenshot: "Screenshots",
      "screenshot.format": "Screenshot formats: PNG and JPEG",
      "screenshot.cssScale": "Screenshots in CSS pixels",
      "screenshot.omitBackground": "Transparent screenshots",
      pdf: "PDF",
      "pdf.headerFooter": "A PDF's header and footer",
      "pdf.preferCssPageSize": "A PDF at the page's CSS size",
      "snapshot.clickListeners": "Click listeners in snapshots",
      "capability.axTree": "The browser's accessibility tree, `Capability.AxTree`",
      "capability.screencast": "Screencast frames, `Capability.Screencast`",
      "capability.video": "A video file, `Capability.Video`"
    }
  }
]

const labelled = new Set(groups.flatMap((group) => Object.keys(group.names)))

/** The groups, with "Other" for any capability no group names */
export const allGroups = (all: ReadonlyArray<Backend>) => {
  const names = new Set(
    all.flatMap((backend) => [...(backend.launched ?? []), ...(backend.attached ?? [])].map((entry) => entry.name))
  )
  const other = [...names].filter((name) => !labelled.has(name)).sort()
  return other.length === 0
    ? groups
    : [...groups, { label: "Other", names: Object.fromEntries(other.map((name) => [name, `\`${name}\``])) }]
}

export const statusLabel: Readonly<Record<Status, string>> = {
  supported: "Yes",
  partial: "Partly",
  unsupported: "No",
  unknown: "Unknown"
}

/** A label's text and its `code`, as alternating runs: text, code, text… */
export const runs = (label: string) => label.split("`")
