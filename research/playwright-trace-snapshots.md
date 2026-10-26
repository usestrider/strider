# Playwright's trace snapshots: the contract a capture writes to

*Research for review 22's first candidate (DOM snapshots in traces, captured our own way). Read, not run, from
`microsoft/playwright` at the release tag `v1.64.1` (2026-10-14), the release trace.playwright.dev serves, fetched
2026-10-26. Paths are relative to the repository. Playwright is Apache-2.0; nothing here is copied into Strider:
this note records what the viewer expects, which our own capture writes.*

The four files read are pinned by their SHA-256 in `packages/tools/codegen/trace-contract.json`:

- `packages/playwright-core/src/server/trace/recorder/snapshotterInjected.ts`, the capture;
- `packages/playwright-core/src/server/trace/recorder/snapshotter.ts`, its driver;
- `packages/isomorphic/trace/snapshotRenderer.ts`, the viewer's renderer;
- `packages/isomorphic/trace/versions/traceV10.ts`, the event types.

On each roll, `strider-codegen trace-contract <playwright checkout>` compares them; where one differs, the parts
below are read again, and the capture (`packages/browser/src/internal/capture.ts`) and the hashes follow. The
attributes have no version of their own: the trace format's version (9 and 10 have the same `FrameSnapshot`)
doesn't change when they do.

## What changed since `playwright-trace-format.md`

- **v1.64 writes trace version 10** (`tracing.ts:59`), which that note (from `main` at `b335271`) recorded as
  unreleased. The reader upgrades 9 to 10 by adopting a step id as the call id (`traceModernizer.ts:548-566`), so
  writing 9 still loads. `FrameSnapshot` is the same in both (`traceV9.ts`, `traceV10.ts:239-254`).

## The event

`trace.trace` holds one `{ type: "frame-snapshot", snapshot }` per frame captured (`tracing.ts:679`):

```ts
type FrameSnapshot = {
  phase?: "before" | "action" | "after", // with callId, how the viewer finds it (snapshotStorage.ts:47-61)
  callId: string,
  pageId: string,
  frameId: string,
  frameUrl: string,
  timestamp: number,                  // monotonic milliseconds, as other events
  wallTime?: number,
  collectionTime: number,             // how long the capture took
  doctype?: string,                   // document.doctype.name
  html: NodeSnapshot,
  resourceOverrides: Array<{ url: string, file?: string, ref?: number }>,
  viewport: { width: number, height: number },
  isMainFrame: boolean,
}
```

- **Finding a snapshot.** The viewer asks for `callId` and `phase`, and a `frameId` for a frame, else the main
  frame's (`snapshotStorage.ts:59-61`, `snapshotServer.ts:70`). A capture before and after an action is two
  events per frame, `phase: "before"` and `"after"`, with the action's `callId`.
- **`resourceOverrides`.** A stylesheet the snapshot needs by URL, whose text the network copy doesn't have
  (rules changed through the CSSOM): `file` names a blob in the trace's `resources/` (its SHA-1 and an
  extension, `snapshotter.ts:150-159`), and `ref` says "the same as N snapshots ago".

## Nodes

`NodeSnapshot` (`traceV10.ts:221-231`):

- a **text node** is its string;
- an **element** is `[name, attributes?, ...children]`; with no attributes and no children, `[name]`;
- a **back-reference** is `[[snapshotsAgo, index]]`: the node at `index` of that frame's capture `snapshotsAgo`
  captures back, counting only nodes that aren't references, in **post-order** (`snapshotRenderer.ts`,
  `snapshotNodes`). A capture whose node hasn't changed since the last is a reference to it.
- A **shadow root** is a child `["template", { "__playwright_shadow_root_": "open" }, ...]` of its host, first
  among the host's children (`snapshotterInjected.ts:473-474, 531-536`).
- An **adopted stylesheet** is a child `["template", { "__playwright_style_sheet_": cssText }]` of the root element
  (for the document) or of the shadow root's template, after its other children (`:553-561, 637-648`). An
  unchanged sheet is a back-reference.
- A **`<style>`** is `["STYLE", {}, cssText]`, its text read from its sheet's `cssRules` when it has one (`:441-452`).
- **Left out:** `SCRIPT`; `LINK` with `rel` `preload` or `prefetch`; `NOSCRIPT` when JavaScript is enabled; `META`
  with `http-equiv` `content-security-policy`, `refresh` or `set-cookie`; an iframe inside `HEAD` (`:388-411`).
- **`HEAD`** gets a `<base href>` first child with the document's base URI, so relative URLs resolve
  (`:543-548`).

Element names are `nodeName` (upper case for HTML). The renderer refuses names with whitespace, `=`, `<`, `>` or
`/`, and drops `SCRIPT` and every `on*` attribute (`snapshotRenderer.ts:106-136`).

## Attributes the capture writes

| Attribute | On | Value | The renderer |
|---|---|---|---|
| `__playwright_value_` | `INPUT`, `TEXTAREA` | `.value` | sets `.value`, removes it |
| `__playwright_checked_` | checkbox and radio `INPUT` | `"true"` or `"false"` | sets `.checked` |
| `__playwright_selected_` | `OPTION` | `"true"` or `"false"` | sets `.selected` |
| `__playwright_scroll_top_`, `__playwright_scroll_left_` | an element scrolled | the offset, when not 0 | scrolls it after load |
| `__playwright_shadow_root_` | the shadow root's `template` | `"open"` | attaches a shadow root with the template's content |
| `__playwright_style_sheet_` | an adopted sheet's `template` | its `cssText` | adopts a sheet with it |
| `__playwright_bounding_rect__` | `CANVAS`, `IFRAME`, `FRAME` | JSON `{left, top, right, bottom}` | places a canvas's pixels from the action's screenshot |
| `__playwright_popover_open_` | an open popover | `"true"` | shows it |
| `__playwright_dialog_open_` | an open `DIALOG` | `"modal"` or `"true"` | opens it, modally or not; its `open` attribute is left out |
| `__playwright_target__` | the action's target | `""` | highlights it |
| `__playwright_custom_elements__` | `BODY` | defined custom element names, comma-separated | defines empty ones, so `:defined` matches |
| `__playwright_current_src__` | `IMG` | `currentSrc`, `""` for `PICTURE` | renders it as `src` |
| `src` | `IFRAME`, `FRAME` | `/snapshot/<frameId>`, or `""` | loads that frame's snapshot for the same call and phase |

Also: an iframe's own `src`, `srcdoc` and `sandbox`, a `LINK`'s `integrity`, and a `DIALOG`'s `open` are left out;
`IMG` `src` and `srcset`, `SOURCE` `srcset` and `LINK` `href` are sanitized URLs; every `on*` value is empty
(`snapshotterInjected.ts:596-627`).

## What the capture is told by its driver

- **The frame an iframe holds** (`markIframe`, `snapshotter.ts:180-195`): the driver gives each iframe element its
  frame's id, which the capture writes as `src`.
- **The target** (`__playwright_mark_target__`, `snapshotterInjected.ts:159-169`): a generation counter, so the
  element marked for this action is the one written as `__playwright_target__`.
- **A reset** (`captureSnapshot("history")`): after a capture failed, the next one writes no back-references.

## Canvases

The viewer draws a canvas from the action's screenshot, cropped by its `__playwright_bounding_rect__` and its
iframes' rects (`snapshotRenderer.ts:322-470`), when asked to (`shouldPopulateCanvasFromScreenshot`). So a
canvas's pixels come from screenshots, not from the capture: a trace without screenshots shows canvases empty.

## Checked in the viewer

A trace Strider wrote (`recordings.ts`'s DOM snapshot test, on Chromium) was opened in trace.playwright.dev
(v1.64.1) by a CLI session, which read the rendered "After" snapshot of the click through a frame locator: the
button's new text, the inputs' values with the password `REDACTED`, the iframe's own snapshot, the open shadow
root, the `<style>`'s color and the adopted sheet's weight were all there.
