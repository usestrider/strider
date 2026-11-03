# Playwright trace format: what it takes to write traces its viewer can open

Sources: a full clone of `microsoft/playwright` at `b335271` (2026-10-17), at `/tmp/prior-art/playwright`. The clone is shallow, so the format history below comes from the version comments, not from git. Paths are relative to `packages/`. Every claim was **read** from source; nothing was run. Playwright is Apache-2.0.

## Summary

- **Feasible.** The minimum is one JSONL file (`trace.trace`) in a zip. It holds a `context-options` header and `before`/`after` pairs, which give the viewer a nested timeline with params, logs and errors.
- **Effect spans map onto nested steps.** Playwright already shows `tracing.group()` and test steps this way.
- **Write version 9.** The viewer rejects any version newer than its own, and trace.playwright.dev runs the latest release.
- **DOM snapshots are the expensive tier.** They need Playwright's capture script, injected into the page's **main world**, where it hooks CSSOM methods. They also need HAR entries in `trace.network` to render with CSS and images.
- **Timestamps must come from a real monotonic clock.** Effect's `Clock` won't do, because under `TestClock` every timestamp freezes.

## 1. On-disk format

**Zip layout.**
- **Required entries.** The loader treats every `<prefix>.trace` entry as one context and reads the matching `<prefix>.network` and `<prefix>.stacks` if present. Only `.trace` is required (`isomorphic/trace/traceLoader.ts:42-76`).
- **Files Playwright writes:**
  - `trace.trace` and `trace.network` (`recorder/tracing.ts:488-489`);
  - blobs as `resources/<sha1>.<ext>`;
  - `screencast/<pageId>-<ts>.jpeg`, `screenshots/` and `aria/`;
  - sources as `src/<sha1(path)><ext>` (`server/localUtils.ts:78`);
  - optionally `trace.stacks` (`localUtils.ts:65`).
- **Test runner names.** The runner adds `test.trace` and renames library traces to `0-trace.trace` and so on (`playwright/src/worker/testTracing.ts:376-381`).
- **Compression.** zip.js's inflate-only build reads the archive, so entries must be stored or deflated (`sw/traceLoaderBackends.ts:17`).
- **Directories.** An unzipped directory also works, but only the subdirectories `resources`, `screencast`, `screenshots`, `aria`, `attachments` and `src` are listed (`server/trace/viewer/traceViewer.ts:337`).

**Events.** Each file is JSONL. The types are in `versions/traceV10.ts`:
- `context-options` (:86-102). Required fields: `version`, `origin` (`library` or `testRunner`), `browserName`, `platform`, `wallTime`, `monotonicTime`, `options`.
- `before` (:143-155): `callId`, `startTime`, `class`, `method`, `params`, plus optional `title`, `subtitle`, `parentId`, `stack` and `group`.
- `input` (:157) and `after` (:177): `callId`, `endTime`, plus optional `error{name, message, stack}`, `attachments`, `result` and `point`. A combined `action` event also exists (:266).
- `log` (:188) and `event` (:195).
- `console` (:204). Its `location` is effectively required, because `consoleTab.tsx:98` dereferences it.
- `screencast-frame` (:104), `video` (:114), and `screenshot`/`aria-snapshot` per `callId` and `phase` (:125-141).
- `resource-snapshot` and `frame-snapshot` (:256-264).
- `stdout`, `stderr` and `error` (:272-283).

**Versions.**
- **History.** Current `main` writes version 10, marked "not released yet". Earlier versions: 6 ≈ 1.40, 7 ≈ 1.45, 8 = 1.53, 9 = 1.63 (`traceV10.ts:70-76`).
- **Upgrades.** The reader upgrades older versions step by step (`_modernize_0_to_1` … `_modernize_9_to_10`, `traceModernizer.ts:239-566`). A missing version is treated as 6.
- **Newer versions are rejected.** The reader refuses anything above its own version (`traceModernizer.ts:110-112`). trace.playwright.dev's stable channel deploys the latest release (`utils/build/deploy-trace-viewer.sh`, `publish_release.yml:49-81`). **So we must write 9 or lower.**
- **What changed:**
  - 9→10 and 7→8 were small.
  - 8→9 was the big one. `sha1` became a `file` path, and actions stopped naming their snapshots (`beforeSnapshot`) in favor of snapshots that carry a `phase`.
  - Writing 8 reaches viewers from 1.53 on, but loses the `screenshot`, `aria-snapshot` and `video` events.

## 2. Required vs optional

**Required:** `context-options` as the first line, then `before`/`after` pairs (or `action` events). That alone gives:
- the action tree and durations;
- the Call tab, which shows all params (`callTab.tsx:34`);
- the Errors tab. For `library` origin, errors come from `action.error` (`traceModel.ts:241-253`).

**Optional:**
- `log`, for each action's Log tab.
- `console`, `stdout` and `event: pageError`, for the Console tab.
- An inline `stack` on `before` plus `src/` files, for the Source tab (`sourceTab.tsx:62-70`).
- A screencast, for the filmstrip and playback.
- `screenshot`, a PNG per action phase. It is shown when there are no DOM snapshots (`ariaModeView.tsx:39-45`).
- `frame-snapshot` and `.network`.

## 3. DOM snapshots

**The capture script.**
- `frameSnapshotStreamer` is one self-contained function; its only import is a type (`snapshotterInjected.ts:17,34`).
- Playwright injects it as `(${fn})(name, jsEnabled)`, both as a context init script and by evaluating it in every existing frame, **in the main world** (`snapshotter.ts:96-99`). It needs the main world because it hooks the page's CSSOM methods and reads `customElements`.
- To capture, the driver evaluates `window[name].captureSnapshot(reset)` in each frame (`snapshotter.ts:106-121`). That returns `{html, doctype, viewport, url, wallTime, collectionTime, resourceOverrides}` (`:19-32`).

**Data model.**
- A node is a text string, `[name, attrs, ...children]`, or a back-reference `[[snapshotsAgo, nodeIndex]]`. Indices count only non-reference nodes, in post-order (`traceV10.ts:220-231`, `snapshotterInjected.ts:424-432`, `snapshotRenderer.ts:96-104,280-297`).
- Back-references resolve against **that frame's earlier snapshots in trace order** (`snapshotStorage.ts:40-46`). So captures must be emitted in order, and after a lost capture the next call must pass `'history'` to reset (`snapshotter.ts:108-118`).
- Live state travels as `__playwright_*` attributes: value, checked, scroll, shadow root, bounding rect, target and so on (`:39-52`). This is a private contract between the script and the renderer, with no separate version, so a vendored copy must be pinned to a release.
- Only the CSS of modified `<link>` sheets becomes resource overrides, either as content (`resources/<sha1>.css`) or as "same as N snapshots ago" (`snapshotter.ts:146-155`).
- External images, fonts and CSS are served from `.network` HAR entries. An entry matches on URL, method and `_frameref`, with `_monotonicTime < snapshot.timestamp` (`snapshotRenderer.ts:215-271`).

**What the driver must supply.**
- Stable `pageId` and `frameId` strings.
- A call to `markIframe(iframeElement, frameId)` in the parent frame, which needs the frame-owner element handle (`snapshotter.ts:167-179`). The iframe's src becomes `/snapshot/<frameId>`.
- The driver's monotonic `timestamp`, plus `callId` and `phase`.
- Target highlighting: dispatch `__playwright_reset_targets__` on the document, then `__playwright_mark_target__` on the target. These are DOM CustomEvents, so they cross worlds (`injectedScript.ts:1456-1471`).

**Protocol dependence is low.** Playwright's own BiDi backend runs the script through `script.addPreloadScript` and `script.evaluate`. One catch: its BiDi `rawEvaluateJSON` uses `maxObjectDepth: 10` (`bidiExecutionContext.ts:46-56`), which truncates deep trees. Having the page return `JSON.stringify(...)` avoids that.

## 4. Network

`trace.network` holds one `{type: 'resource-snapshot', snapshot: <HAR Entry>}` per line (`tracing.ts:636-641`, `versions/har.ts:41-62`). The viewer reads these fields (`networkTab.tsx:51-62,225-260`, `snapshotServer.ts:83-124`):
- `request.{url, method, headers[], queryString[], postData?}`;
- `response.{status, statusText, headers[], content.mimeType, content._file, bodySize, _transferSize}`;
- `time`, `startedDateTime`, `_monotonicTime`, `pageref`, `_frameref` and `_resourceType`.

The UI doesn't use cookies or timings. Bodies go in `resources/<sha1>.<ext>`, referenced through `_file` (`harTracer.ts:561-565`). This is the same entry format as a recorded HAR.

## 5. Actions and nesting

- **Ids and nesting.** `callId` can be any string. `parentId` builds the tree; an unknown parent falls back to the root (`traceModel.ts:374-404`).
- **Titles.** The title is `title ?? metainfo[class.method].title ?? method` (`protocolFormatter.ts:81`).
- **Snapshots.** Actions no longer carry `wallTime`, `pageId` or snapshot names; snapshots point at their action instead.
- **Effect spans as steps.** Playwright does the same for `tracing.group()` (`class: 'Tracing', method: 'tracingGroup'`, `tracing.ts:253-298`) and for test steps (`class: 'Test'`, `testTracing.ts:284-309`).
  - A span becomes `before{callId: spanId, parentId, title, class, method, params: attributes, stack}` followed by `after{endTime, error}`.
  - Effect logs become `log` events.
  - A step with no snapshot of its own borrows its last nested action's (`snapshotTab.tsx:403-445`).

## 6. Timing

- **One clock.** All `startTime`, `endTime`, `time`, `timestamp` and `_monotonicTime` fields are milliseconds on one monotonic clock per context. Playwright uses `performance.now()`-based time with three decimals (`time.ts:35-37`).
- **Wall time.** The `{wallTime, monotonicTime}` pair in `context-options` maps that clock to wall time and aligns contexts (`traceModel.ts:304-308`).
- **Timeline.** The timeline spans the earliest to the latest action, event and frame times (`traceModernizer.ts:221-232`).
- **Screencast.** Frames are placed by `timestamp` (`filmStrip.tsx:195-199`). `frameSwapWallTime` only matches a snapshot's page-side `wallTime` to the nearest frame (`snapshotRenderer.ts:79-85`).
- **Two implications:**
  - The trace writer must not read Effect's `Clock`, or `TestClock` freezes every timestamp.
  - BiDi has no screencast. Playwright fakes one by polling `captureScreenshot` about every 40 ms (`bidiPage.ts:610-631`).

## 7. Risks

- **The version gate.** Writing a version newer than the reader's makes the trace unloadable.
- **Special-cased `class.method` names** (`protocolMetainfo.ts:357`). Reusing Playwright's names pulls in Playwright's titles and selector rendering:
  - `selector` params are rendered as locators (`callTab.tsx:118`).
  - For methods whose names contain `eval`, `arg`/`value` are parsed as SerializedValue, which can throw (`:103-109`).
  - `Route` actions are skipped when assigning events (`traceModel.ts:196`).
  - `Test`/`test.step` get skip handling (`actionList.tsx:151`).
  - `{x}` placeholders in titles are filled from params (`actionList.tsx:182`).
  - `origin: 'testRunner'` changes where errors come from and merges actions by `callId` (`traceModel.ts:156,291-340`).
- **Embedding.**
  - The viewer is a static Vite build (`trace-viewer/vite.config.ts:49`) plus a service worker registered at a relative path (`index.tsx:31`). The service worker answers every snapshot subresource request (`sw/main.ts:184-201`).
  - It needs HTTPS or localhost; `file:` URLs are rejected.
  - Traces load through `?trace=<CORS url>` or `postMessage({method: 'load', params: {trace: Blob}})` (`workbenchLoader.tsx:70-111`).
  - `show-trace --port` serves the viewer to any browser.
  - Apache-2.0 allows shipping the built bundle.
  - The `playwright trace actions` CLI commands use the same loader.

## Minimum viable trace, and the tiers above it

A `trace.zip` containing only `trace.trace`:

```
{"version":9,"type":"context-options","origin":"library","browserName":"chromium","platform":"linux","wallTime":…,"monotonicTime":…,"options":{"viewport":{…}},"title":"adds to cart"}
{"type":"before","callId":"s1","startTime":…,"class":"Effect","method":"span","title":"checkout","params":{}}
{"type":"before","callId":"a1","parentId":"s1","startTime":…,"class":"Locator","method":"click","title":"Click","params":{"target":"…"},"stack":[…]}
{"type":"log","callId":"a1","time":…,"message":"waiting for …"}
{"type":"after","callId":"a1","endTime":…,"error":{"name":"Timeout","message":"…"}}
{"type":"after","callId":"s1","endTime":…}
```

This gives a nested timeline, durations, params, logs and errors.

**Tier 1, cheap visuals:**
- `screenshot` events (a PNG per action phase), and `input{point}` for click markers;
- `screencast-frame` JPEGs: native on CDP, polled screenshots elsewhere;
- `console` events, and `src/` files for the Source tab.

**Tier 2, full fidelity:**
- the vendored `snapshotterInjected` producing `frame-snapshot` events, with iframe marking and target events;
- `trace.network` HAR entries with bodies in `resources/`, so snapshots render with their CSS, images and fonts.
