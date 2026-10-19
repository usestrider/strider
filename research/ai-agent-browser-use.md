# AI-agent browser use: prior art for an Effect-native CDP library

Researched 2026-10-18. Every repo was cloned with `--depth 1` into `/tmp/prior-art/<name>` and read only; nothing was installed or run. Unless a section names another repo, each `file:line` citation is relative to that section's repo root.

| Repo | Clone dir | SHA | HEAD date |
|---|---|---|---|
| browserbase/stagehand | stagehand | c6b6f278c880 | 2026-10-18 |
| browser-use/browser-use | browser-use | aa093a843da5 | 2026-10-17 |
| browser-use/cdp-use | cdp-use | b46d0592130c | 2026-07-28 |
| microsoft/playwright (MCP source now lives here) | playwright | b335271cdc2b | 2026-10-17 |
| microsoft/playwright-mcp (README and wrapper only) | playwright-mcp | b8b4183e099f | 2026-10-08 |
| ChromeDevTools/chrome-devtools-mcp | chrome-devtools-mcp | ff5204aaf572 | 2026-10-18 |
| vercel-labs/agent-browser | agent-browser | dac13bb87468 | 2026-10-15 |
| lightpanda-io/browser | lightpanda | ebf8786096d4 | 2026-10-19 |
| Skyvern-AI/skyvern | skyvern | 1822679c68bf | 2026-10-18 |
| anthropics/anthropic-quickstarts | anthropic-quickstarts | 9ec32b91df50 | 2026-10-07 |
| openai/openai-cua-sample-app | openai-cua-sample-app | f2a3dc523ae4 | 2026-09-04 |

Abbreviations: **PW** is the Playwright monorepo. Under it, `tools/` means `packages/playwright-core/src/tools/`, `server/` means `packages/playwright-core/src/server/`, and `injected/` means `packages/injected/src/`.

---

## Summary

- **Every serious agent stack now speaks CDP directly or sits on its own CDP layer.**
  - browser-use dropped Playwright in August 2025.
  - Stagehand did the same in v3 (October 2025). At HEAD it is **v4**: the engine is a Chrome MV3 extension that drives the browser from inside the browser, and `agent()` has been removed.
  - agent-browser went from a Node+Playwright daemon to a 100% Rust daemon (install size 710 MB → 7 MB).
  - Skyvern is building a CDP engine (`skycdp`).
  - Anthropic's own browser-toolset driver example uses raw CDP.
  - Playwright MCP and Chrome DevTools MCP stay on Playwright and Puppeteer respectively, but they belong to the browser vendors.
- **Page state is the accessibility tree enriched with DOM and layout data.**
  - Chrome DevTools MCP, agent-browser and Stagehand start from `Accessibility.getFullAXTree`. Stagehand merges in `DOM.getDocument(pierce)` to get XPaths and frame/shadow structure.
  - Playwright computes its own aria tree with injected JS.
  - browser-use merges `DOMSnapshot.captureSnapshot`, the DOM and the AX tree, then filters by paint order and occlusion.
  - Screenshots with set-of-marks are fading: Skyvern deprecated it, and browser-use keeps it only as a debugging aid.
- **Element refs are short handles minted per document and resolved through a registry.** The strongest designs key the ref by `(frame, loaderId, backendNodeId)`:
  - Chrome DevTools MCP keys by `loaderId_backendNodeId`.
  - agent-browser keeps one bucket per `(page session, frame)` and wipes it when the loader changes.
  - Playwright instead caches `{role, name, ref}` on the element itself and renumbers the main frame on cross-document navigation, so old refs cannot resolve in the new document.
  - agent-browser is the only tool that falls back to role/name/nth when the backend node has died.
- **Post-action verification is mostly heuristic settling plus a re-snapshot.** The tools wait for navigation, network quiet or DOM-mutation quiet. Explicit outcome signals are still rare: new tabs, dialogs, downloads, checkbox state and input readback.
- **Determinism comes from recording the resolved target and method, then replaying with an LLM fallback.**
  - Stagehand caches `Action[]` with `%var%` placeholders.
  - Skyvern generates per-block Python with a `prompt=` fallback, and a reviewer patches the scripts.
  - browser-use replays its history through an element-hash cascade.
  - Playwright MCP emits Playwright code with semantic locators for every action.
- **2026 trend: "code mode" and toolsets defined by the model provider.**
  - Stagehand v4 tells users to write control flow themselves or let an LLM write the script.
  - OpenAI's sample exposes one `exec_js` tool backed by a persistent Playwright REPL.
  - Anthropic ships a server-defined `browser_toolset_20260801` with 31 members that clients implement.
  - Pages can now publish their own tools through WebMCP, which Playwright MCP, Stagehand, agent-browser and Lightpanda all surface.

---

## Tool by tool

### Stagehand (browserbase/stagehand)

At this SHA the package is **4.0.0**: "Rebuilt Stagehand around its v4 browser protocol… protocol-first monorepo with TypeScript, Python, and Go SDKs" (`CHANGELOG.md:315-321`). The v3 source is not in the tree, so the v3 claims below come from `packages/docs/v3/*` and the CHANGELOG.

**Driver**
- v3 "Removes internal Playwright dependency" and promised a "20-40% speed increase" and "Automatic action caching… Go from CUA → deterministic scripts w/o inference" (`CHANGELOG.md:838-857`).
- In v4 the SDK attaches to an extension service worker. It talks JSON-RPC over `Runtime.addBinding` / `Runtime.evaluate` (`packages/sdk-ts/src/cdpClient.ts:364-437`), and the worker opens its own CDP socket to the browser (`service-worker.ts:38-53`).
- The "understudy" CDP layer survives in `packages/extension/understudy/`:
  - It uses flattened sessions, with event handlers keyed by `${sessionId}:${event}` (`cdp.ts:478-525`).
  - Auto-attach uses `waitForDebuggerOnStart:true`. Listeners are installed *before* auto-attach, and per-target `enable` calls are dispatched before `runIfWaitingForDebugger` (`context.ts:591-819`).
  - OOPIF sessions are adopted into the owning Page's `FrameRegistry`, which is the single source of truth for frame→session ownership (`context.ts:939-975`, `frameRegistry.ts:4-19`). Root swaps keep the frame ordinal stable (`page.ts:408-447`).
- The extension design exists partly so Stagehand can reach **closed** shadow roots via `chrome.dom.openOrClosedShadowRoot` (`dom/locatorScripts/shadowRoots.ts:1-16`).

**Page state ("hybrid snapshot")** (`a11y/snapshot/capture.ts:42-147`)
- It calls `DOM.getDocument({depth:-1, pierce:true})` per session. On a CBOR stack overflow it retries at shallower depths and patches the gaps with `describeNode` (`domTree.ts:121-152`). It also builds a per-backendNodeId index holding absolute XPath, scrollability and DFS intervals (`domTree.ts:241-336`).
- It calls `Accessibility.getFullAXTree({frameId})` per frame, decorates roles with DOM facts (`scrollable`, `select`, `input, file`) and prunes structural noise (`a11yTree.ts:124-237`).
- Child-frame outlines are nested under their iframe line (`capture.ts:877-934`).
- Line format: `` `[${frameOrdinal}-${backendNodeId}] ${role}: ${name}` ``, indented by depth (`treeFormatUtils.ts:8-15`).
- There is no token budgeting, only `focusLocator` / `ignoreLocators` scoping and a 20 s time budget (`capture.ts:175-318, 598-751`; `page.ts:2312-2328`).
- A line-set diff is used in exactly one place: for "two-step" custom dropdowns, `act` sends only the new lines (`actService.ts:194-245`).

**Refs**
- Format: `` `${frameOrdinal}-${backendNodeId}` `` (`capture.ts:399`), validated by `^\d+-\d+$` in the LLM schemas (`inference.ts:39-69`). Ordinals are allocated per Page (`page.ts:1236-1247`).
- The ID is converted *immediately* to an absolute XPath with iframe hops and `//` shadow hops (`actService.ts:466-504`; `xpathUtils.ts:62-108`). The model never sees XPaths and the runtime keeps no backendNodeIds.
- Every action re-resolves the XPath.
- The v4 agent facade binds a snapshot to its URL. Stale use fails with "The active page navigated after its snapshot; call snapshot again." or `Snapshot ID "${id}" is stale or not actionable…` (`integrations/core/src/facade/tools.ts:288-313`).

**act / extract / observe** (`sdk-ts/src/stagehand.ts:245-320`)
- Action space: `click, fill, type, press, scrollTo, nextChunk, prevChunk, selectOptionFromDropdown, hover, doubleClick, dragAndDrop` (`types/private/handlers.ts:2-14`).
- The `act` pipeline (`actService.ts:116-246`):
  1. wait for DOM/network quiet (500 ms quiet, ignore requests stalled over 2 s, 5 s cap; `actHandlerUtils.ts:459-614`);
  2. check the cache;
  3. snapshot, then LLM → `{elementId, method, arguments, twoStep}`;
  4. execute deterministically;
  5. optionally run step two.
- Self-heal re-snapshots and re-infers on the "`${method} ${description}`" string. In v4 it is **off by default** (`actService.ts:77`), while the README still says "act() self-heals".
- `extract` sends Zod as JSON Schema and re-parses the result with the caller's schema (`stagehand.ts:309-319`).
  - The URL trick: `z.string().url()` fields are rewritten to element-ID regexes, the model returns IDs, and `injectUrls` swaps them back from the AX `url` map (`utils.ts:138-364`). This fixed the "Cannot extract link targets" regression (issue #651).
- `observe` returns `Action{selector, description, method, arguments}` objects that `act(action)` replays with no inference (`docs/v4/basics/act.mdx:540-550`).

**Caching**
- v4 caching is server-side. The runtime ships raw AX nodes, URL, method and params; the Browserbase API computes the key and stores `Action[]` in Redis (`cacheService.ts:22-35, 370-399`).
- Hits require a threshold count. Metadata reports `HIT|MISS`, `missReason` and `tokensSaved` (`schemas.ts:516-524, 920-944`).
- Replay runs with `selfHeal:false`. On failure it records `missReason:"replay_failed"`, runs full inference and **overwrites** the entry (`actService.ts:249-284`).
- Placeholders are cached, but variable *values* are sent to the cache API (`cacheService.ts:80-90`).
- v3 had a local `cacheDir`, keyed for agents by instruction, start URL and config, with manual invalidation (`docs/v3/best-practices/caching.mdx:158-278`).

**Agent**
- v4 says "`agent()` is gone… v4 exposes discrete tools and leaves the control flow to you" and recommends code mode or your own loop (`packages/docs/v4/migrations/v3.mdx:9-18, 196-214`).
- The CUA integrations implement Anthropic's `browser_toolset_20260801` over `snapshot`/`screenshot` and keep the last three screenshots (`integrations/claude-cua-sdk/ARCHITECTURE.md`).

**Sessions**
- The active page is "Chrome's active tab in its last-focused window" (`context.ts:240-261`), so a popup silently becomes the target.
- Downloads only have `setDownloadBehavior`.
- Uploads build `File` objects in the page from base64, capped at 50 MB (`locator.ts:81-140`).
- `localBrowser.connect({cdpUrl})` attaches to an existing browser. The Browserbase path uploads the extension and connects to `connectUrl` (`browserbaseSession.ts:79-110`).

**Novel**
- `experimentalBatch(cb)` ships the callback's *source text* to the service worker to collapse round trips (`stagehand.ts:136-192`).
- One shared deadline object covers all CDP steps (`progress.ts`).

### browser-use and cdp-use

**cdp-use** generates Python `TypedDict`s and `Literal` enums from the protocol JSON, pinned to Chromium 144 (`cdp_use/generator/*`). Calls look like `cdp.send.DOM.getDocument(params=..., session_id=...)`. The typing is static only:
- CDP errors become `RuntimeError(dict)` (`client.py:321`).
- There are no request timeouts; browser-use subclasses the client to add them (`browser_use/browser/_cdp_timeout.py`).
- The event registry has **one slot per method**, so a second registration silently replaces the first, and handlers run inline in the receive loop (`cdp/registry.py:17-73`).

**Session architecture**
- `SessionManager` is the source of truth for targets and sessions. It calls `setDiscoverTargets`, then recursive `setAutoAttach({flatten:true})` on every child (`browser/session_manager.py:63-508`).
- If the focused tab dies, it recovers agent focus to another tab or `about:blank` (`:530-782`).
- A `bubus` event bus dispatches typed events with per-event timeouts, e.g. `ClickElementEvent` 15 s (`browser/events.py:125-133`).
- **Watchdogs** bind `on_<Event>` methods by naming convention (`watchdog_base.py:243-291`). They cover downloads, popups (auto-accepting dialogs and reporting them to the LLM), security (allowed domains, redirect re-check), permissions, about:blank, screenshot, DOM, storage state, recording, HAR and captcha. The crash watchdog is commented out (`session.py:1706-1855`).

**DOM serialization** (`dom/service.py:403-700`)
- Four parallel calls:
  - `DOMSnapshot.captureSnapshot` with 10 computed styles, paint order and rects;
  - `DOM.getDocument(pierce)`;
  - `getFullAXTree` per frame;
  - layout metrics.
- Click listeners come from `getEventListeners` via `includeCommandLineAPI`.
- An interactivity heuristic runs from listeners → AX props → tags → `cursor:pointer` (`dom/serializer/clickable_elements.py`).
- **Paint-order occlusion** removes fully covered nodes (`paint_order.py:35-225`). **Bounding-box containment** collapses children of buttons and links (`serializer.py:772-901`).
- Line format: `*[38]<button aria-label=Submit form />`, where `*` means "new since last step", keyed by `(session_id, backend_node_id)` (`serializer.py:75-83, 1114-1140`).
- Token limits: attribute whitelist, 100-character values, 40k-character cap, URL hashing, compaction every 25 steps.

**Indexing**
- The index **is the CDP `backendNodeId`**, with a synthetic ID allocated only on cross-session collision (`serializer.py:637-658`). Indices therefore stay stable across steps for surviving nodes.
- Resolution goes through the cached selector map of the *last* state.
- A stale index returns `"Element index N not available - page may have changed. Try refreshing browser state."` as content, not as an error (`tools/service.py:715-718`).
- On a state-capture timeout the map is emptied (`session.py:1644-1655`).

**Frames and shadow DOM**
- OOPIFs are followed recursively up to `max_iframe_depth=5` and `max_iframes=100`, skipping invisible or under-10 px frames (`dom/service.py:976-1077`).
- Open and closed shadow roots are rendered with markers (`serializer.py:1104-1161`).

**Highlighting** is an injected JS overlay used for debugging only. Screenshots sent to the model are clean (`screenshot_watchdog.py:55-62`), even though the system prompt promises bounding boxes.

**Actions** include `search, navigate, go_back, wait, switch, close, click, input, upload_file, scroll, send_keys, find_text, dropdown_options, select_dropdown, extract, search_page, find_elements, screenshot, save_as_pdf, evaluate, file ops, done` (`tools/service.py`).
- Verification:
  - the tab list is diffed after a click to find new tabs;
  - checkbox state is read before the click and checked after;
  - input values are read back.
- Multi-action steps abort when the URL or focused target changes, and `terminates_sequence` actions stop the queue (`agent/service.py:2755-2873`).

**Replay**
- History stores `DOMInteractedElement` with `element_hash` (parent path + static attributes + AX name) and `stable_hash`. `rerun_history` matches EXACT → STABLE → XPATH → AX_NAME → ATTRIBUTE (`agent/service.py:3554-3712`).
- `extract` steps are re-run by an LLM.
- An LLM judge grades the trace (`agent/judge.py`).

**Secrets**
- The model sees placeholder names only. Values are substituted at execution time when the domain pattern matches, `bu_2fa_code` keys produce TOTP codes, and outgoing messages are redacted (`tools/registry/service.py:427-516`).

**Sessions**
- A real Chrome profile is **copied to a temp dir** (`profile.py:849-880`).
- `cdp_url` accepts http or ws, and `use_cloud` creates a cloud browser.
- Storage state is exported in Playwright format.

### Playwright MCP and playwright-cli (in the microsoft/playwright monorepo)

The MCP package is now a wrapper. Its source lives in PW `tools/` (`playwright-mcp/src/README.md`).

**Snapshot**
- Public API: `page.ariaSnapshot({mode:'ai'})` plus `page.getByRef(ref)`. The latter is just `locator('aria-ref=…')` (`client/page.ts:786-788, 938-945`).
- What `ai` mode changes (`injected/ariaSnapshot.ts:58-71`):
  - generic nodes are included;
  - the focused element gets `[active]`;
  - clickable nodes get `[cursor=pointer]`;
  - only visible, hit-testable elements get refs.
- A distiller merges strings, unwraps single-child generics and removes redundant names. Removed refs still resolve (`ariaSnapshotDistiller.ts:30-31, 256-263`).
- Iframes are stitched in by re-snapshotting through `aria-ref=<iframe ref> >> internal:control=enter-frame` (`server/page.ts:1151-1179`).
- Output is YAML: `- button "World" [ref=f1e2]`.

**Ref identity**
- A module-level `lastRef` counter lives in the injected script, so it is per document.
- Each element caches `_ariaRef = {role, name, ref}` and reuses the ref **only if role and name are unchanged** (`injected/ariaSnapshot.ts:225-238`).
- Frame prefix `f<seq>`: the main frame (seq 0) has no prefix. On a cross-document navigation away from a real URL the main frame is **renumbered** "so that aria refs… minted against the previous document do not accidentally resolve" (`server/frames.ts:273-277`).
- Resolution looks only at the frame's *latest* snapshot and requires `isConnected` (`injectedScript.ts:768-774`).
- The stale error is "Ref e5 not found in the current page snapshot. Try capturing new snapshot." (`tools/backend/tab.ts:572`). `target` also accepts locator strings (`tab.ts:554-575`).

**Responses**
- Each response is assembled from sections: Error, Result, "Ran Playwright code", Open tabs, Page, Modal state, Snapshot, Events (`response.ts:267-350`).
- After an action the snapshot goes to `.playwright-mcp/page-<ISO>.yml` and only a link is returned. Only an explicit `browser_snapshot` inlines the YAML (`response.ts:289-322`). Console output is also linked rather than inlined.
- There is **no diff mode**: `--snapshot-mode full|none` (`tools/mcp/program.ts:79`).
- `browser_find` greps the snapshot (`find.ts`).

**Tools**
- 70+ tools, prefixed `browser_` and grouped by capability (`core`, `tabs`, `input`, `vision`, `pdf`, `testing`, `network`, `storage`, `devtools`), with `skillOnly` extras for the CLI (`tools.ts:83-94`).
- Each action records a structured `Action` that codegen renders to JS, Python, Java or C#, with secrets as `process.env[...]` (`codegen.ts:29-87`).
- WebMCP tools exposed by the page become `browser_webmcp_list` / `browser_webmcp_call`, carrying `readOnly`, `untrustedContent` and `consequential` hints (`backend/webmcp.ts:30-35, 150-200`).

**Settling** (`waitForCompletion`, `tools/backend/utils.ts:20-57`)
1. Record requests made during the action.
2. Settle for 500 ms.
3. If a navigation happened, wait for `load` (up to 10 s).
4. Otherwise wait for doc/css/script/xhr/fetch bodies (up to 5 s).
5. The whole wait is raced against modal states.

**Modal states** (dialog, file chooser) block every tool except the one that handles them: `Tool "browser_click" does not handle the modal state.` (`tool.ts:70-84`).

**Sessions** (`tools/mcp/browserFactory.ts:63-237`)
- Sources: remote endpoint, CDP endpoint, isolated context, browser extension relay, or a persistent profile keyed by `sha256(cwd)`.
- A locked profile gives `Browser is already in use… use --isolated`.

**playwright-cli** spawns a detached daemon per session on a Unix socket, hosting the same backend. CLI plus skills is described as "more token-efficient" (`playwright-mcp/README.md:5-11`; `tools/cli-daemon/daemon.ts`).

### Chrome DevTools MCP (ChromeDevTools/chrome-devtools-mcp)

**Snapshot and uids**
- Snapshots come from Puppeteer's `accessibility.snapshot({includeIframes:true, interestingOnly:!verbose})` (`src/TextSnapshot.ts:56-59`).
- uid = `${snapshotId}_${counter}`, keyed by **`${loaderId}_${backendNodeId}`** in a per-page map (`TextSnapshot.ts:64-91`).
  - A node keeps its uid across snapshots while it lives in the same document; unseen keys are pruned.
  - A new document means a new loaderId, which means new uids.
- Line format: `uid=1_1 button "Click me" focusable focused` (`formatters/SnapshotFormatter.ts`).
- Stale errors: `Element uid "${uid}" not found on page ${id}.` and `Element with uid ${uid} no longer exists on the page.` (`McpPage.ts:928-944`).

**Settling** (`waitForEventsAfterAction`, `utils/WaitForHelper.ts:124-300`)
- Arm navigation listeners (`Page.frameStartedNavigating`, `frameRequestedNavigation`).
- After the action, wait up to 100 ms for a navigation to start, then up to 3 s for it to finish.
- Then wait for a **MutationObserver quiet window** (100 ms, capped at 3 s, scaled by CPU throttling).
- There is no network-idle check.
- Popups are reported as `## Opened pages`.
- Tool calls are serialized by a mutex.

**Tools**: input, navigation, emulation, performance traces with insights, network, debugging, Lighthouse, heap snapshots, and a `--slim` three-tool mode.

**Sessions**
- `pageId` is **required by default** on page tools (`config/mcp-options.ts:36-42`). This followed the multi-agent "selected page" race in issue #1019.
- Auto-connect reads `DevToolsActivePort` (Chrome 144+).
- Launch uses `pipe: true`.

### agent-browser (vercel-labs/agent-browser)

**Architecture**
- A Rust CLI talks to a per-session Rust daemon over a Unix socket. 0.20.0 "Removed the entire Node.js/Playwright daemon", taking install size from 710 MB to 7 MB and daemon memory from 143 MB to 8 MB (`CHANGELOG.md:1078-1088`).
- CDP types are generated at build time (`cli/build.rs`).
- A mutating command whose bytes were already sent returns `outcome_unknown` instead of being retried (`cli/src/connection.rs:1053-1100`).

**Snapshot**
- `getFullAXTree` per frame, plus a JS pass for cursor-interactive elements (`cli/src/native/snapshot.rs:321-428, 772-824`).
- Flags: `-i` (interactive only), `-c` (compact), `-d` (depth), `-s` (CSS scope).
- Line format: `- button "Submit" [ref=e2]`.

**Refs (the most complete design surveyed)**
- `RefEntry {backend_node_id, role, name, nth, frame_id}`, where `nth` is set only when role and name repeat (`element.rs:9-17`).
- `RefMap.documents` is keyed by `(page session, frame)` and records `session + loaderId`. A changed loader or session wipes the bucket, and unknown loaders never retain refs (`element.rs:145-232`). The docs: "Surviving DOM elements keep their refs across snapshots."
- Resolution order:
  1. `DOM.getBoxModel(backendNodeId)`;
  2. a hit-test check that produces "Element '…' is covered by <…>";
  3. if the backend node is dead, re-find by role/name/nth in the AX tree (`element.rs:425-632, 824`).
- Exact-backend refs fail with "Element ref {ref_id} is stale".
- Snapshot responses include `removedRefs`.
- **Delta snapshots** (`snapshot --delta`): a per-tab revision log (32 entries) answers `full | unchanged | delta`. A delta carries ref add/remove/replace operations and a line splice. It falls back to full when the URL changes or the delta reaches 70% of the full size (`actions.rs:5830-5945`).

**Surface**
- `find role|text|label…` mirrors `getByRole`.
- Also: `network route`, `state save|load`, an AES-GCM `auth` vault, `screenshot --annotate` (numbered marks with an `@eN` legend), `batch`, `mcp`, `--engine chrome|lightpanda`, providers (Browserbase, Browserless, Browser Use, Kernel), and iOS via Appium.

### Lightpanda (lightpanda-io/browser)

A Zig headless browser with a real DOM and JS engine but **no layout engine**: geometry is "faux layout" and screenshots are text flowed into blocks (`src/rust/render/lib.rs:19-23`).

**CDP subset** (`src/server/cdp/domains/*.zig`)

| Domain | Support |
|---|---|
| Accessibility | getFullAXTree, getPartialAXTree, queryAXTree |
| DOM | getDocument, querySelector(All), describeNode, resolveNode, getBoxModel (all box types identical), getContentQuads, scrollIntoViewIfNeeded, setFileInputFiles, getFrameOwner, focus |
| Input | mouse, key, touch, insertText |
| Page | navigate, lifecycle, frame tree, isolated worlds, init scripts, dialogs, file-chooser interception, PNG-only screenshots, printToPDF |
| Runtime | 22 methods |
| Target | Only one browser context at a time, one target per context (`target.zig:129, 181-183`) |
| Fetch | Real interception |
| Network | cookies and headers |
| Storage | cookies only |
| Emulation | several no-ops |
| CSS | `enable` stub |

- Absent: DOMSnapshot, Overlay, DOMStorage, IndexedDB, Tracing.
- The custom **`LP` domain** adds `getSemanticTree` (with `maxDepth`, `interactiveOnly` and a `max_bytes` priority budget), `getInteractiveElements` (based on *actual registered listeners*), `getMarkdown`, `getStructuredData`, `detectForms`, and `clickNode` / `fillNode` by backendNodeId (`lp.zig:35-358`; `SemanticTree.zig:100-135`).
- A native MCP server and a `lightpanda agent` mode that exports "PandaScript" for "deterministic and token-free" replay (`README.md:174-191`).
- Blog claim: Puppeteer moved 11 KB of websocket traffic where Playwright moved 326 KB for the same task (Pierre Tachoire, 2025-11-07).

### Skyvern (Skyvern-AI/skyvern)

**Page state**
- `domUtils.js` stamps a **`unique_id` attribute into the live DOM**: a frame character plus a base62 counter. Elements are resolved with `querySelector('[unique_id=…]')` (`skyvern/webeye/scraper/domUtils.js:1887-1931, 2366`).
- The element tree is rendered as pseudo-HTML with whitelisted attributes (`scraped_page.py:63-133`).
- Above 100k tokens it switches to an "economy" tree, then truncates to two thirds, under a `# !!! HACK alert` comment (`utils/prompt_engine.py:145-185`).
- Set-of-marks overlays are deprecated (`scraper.py:322-325`).

**Verification**
- *Incremental scraping* installs a MutationObserver before a click or input, so newly appeared dropdown or autocomplete options drive a follow-up prompt (`scraper.py:1010-1070`; `handler.py:7470-7500, 9791-9811`).
- Optional `complete_verify` asks an LLM whether the goal was met.

**Determinism**
- Per-block Python codegen: `await page.click(selector=…, prompt=…)`, with selector priority aria-label → placeholder → name → text (`core/script_generations/generate_script.py:373-382, 891-893`).
- At runtime, `SkyvernPage.click(selector, prompt=, ai="fallback"|"proactive")` tries the selector first and falls back to AI (`skyvern_page.py:421-500`).
- `ScriptReviewer` turns fallback episodes into new script branches and never removes paths (`services/script_reviewer.py:527-536`).
- Workflows carry `run_with: "agent"|"code"`, `ai_fallback`, `cache_key` (`schemas/workflows.py:1946-1954`). Docs: if cached code fails, it "falls back to the agent and regenerates the code".

**Browser**
- Playwright by default. A raw-CDP `skycdp` facade exists but is disabled (`webeye/browser_engine.py:62-76`).
- Credential vaults and TOTP support.

### Other reference points

**Anthropic `browser_toolset_20260801`** (anthropic-quickstarts `browser-toolset/`)
- A *provider-defined* toolset with 31 members: `navigate, read_page, find, form_input, left_click…, type, key, scroll, screenshot, zoom, tabs, file_upload, read_console, read_network, javascript_exec`, among others.
- The client driver extends `BetaAbstractBrowserToolset20260801`. The SDK calls `browserState` after **every** call; it must report tabs and drain `state_changes` (tabs opened, downloads, `dialog_dismissed`, `navigation_refused`).
- The SDK also provides `urlPolicy`, `confirm` and `filePolicy` hooks. `javascript_exec` and `file_upload` cannot be enabled without `confirm`.
- The example driver uses raw CDP:
  - `navigate` matches its own `loaderId` in `Page.lifecycleEvent` (`typescript/cdp-browser.ts:222-289`).
  - `ref_N` values live in a page-side `WeakMap`, so "a navigation drops them".
  - The stale error is "Unknown or stale ref: … Call read_page again for current refs." (`:305-310, 370-395`).
- `computer-use-best-practices/README.md:348-378` makes the cache-economics point that matters for snapshots too. Pruning old observations naively changes the prompt prefix every turn and defeats prompt caching. Pruning in intervals keeps it byte-stable.

**OpenAI CUA sample app**
- A single tool, `exec_js`, runs model-written code in a "persistent Playwright REPL" with `page/context/browser` globals and a 60 s deadline. Replay bundles record runs for review, not for re-execution (`javascript-app/src/responses-loop.ts:121-147`; `docs/architecture.md`).
- The README frames code as the action space: "Code lets the model combine actions, process observations, and choose when to look again."

**Other tools and standards**
- **Browserbase Director** turns natural language into a Stagehand script (launch post).
- **WebMCP** (`document.modelContext`, Chrome origin trial M149–M156) lets pages register tools. Playwright, Stagehand v4, agent-browser and Lightpanda already surface them.
- **dev-browser** (a Playwright skill with a persistent page) and **Midscene.js** (vision-first `aiTap`/`aiQuery`) are popular but were only checked through secondary sources.

---

## Why these teams left Playwright for direct CDP

**browser-use** (Nick Sweeting, "Closer to the Metal: Leaving Playwright for CDP", 2025-08-20; changelog 2025-08-19, "All interactions are now 100% CDP-based—no more Playwright dependencies")
- **Extra hop and state drift.** Playwright adds "a 2nd network hop going through a node.js playwright server websocket". State then drifts between the browser, the Node relay and the Python client, and relay hangs end in kill -9 and a reconnect.
- **Per-call overhead.** A single snapshot makes thousands of CDP calls (position, opacity, paint order, listeners, ARIA), so each extra layer is expensive.
- **Crashes.** `fullPage` screenshots over 16,000 px "reliably crashes playwright". There are "at least 10 different ways a tab can crash", and Playwright "handled about half".
- **Targets.** A tab is "a constellation of targets". Cross-origin iframes need per-target session routing and event correlation, which Playwright hides.
- **Events.** They wanted event-driven reactions (downloads, crashes, streaming content), and built the bubus bus and watchdogs for it.
- **Admitted costs.** They lose Playwright's typed cross-language RPC and its edge-case coverage, and "ignored the (wise) advice". Bot detection is not given as a reason.

**Stagehand v3** (Miguel Gonzalez, 2025-10-29)
- "Playwright's actionability checks and auto-waiting are ideal for tests, but they add overhead in automation scenarios where throughput and control take priority."
- They needed CDP-level control for iframes, multi-tab work, and streaming AX trees, DOM snapshots and network events. They also wanted lighter long-lived sessions, fewer websocket round trips, and Bun support.
- Claimed result: "44.11% faster on average across iframes and shadow-root interactions". This is a vendor benchmark and is entangled with Browserbase infrastructure.
- v4 then moved the driver *into* the browser as an extension. That cuts latency and gives access to closed shadow roots.

**agent-browser**: footprint, with install size 710 MB → 7 MB and daemon RSS 143 MB → 8 MB (`CHANGELOG.md:1078-1088`).

**Lightpanda**: "the abstraction layers become constraints" for custom interception. It cites browser-use and Stagehand as precedent.

**Across the four**, the reasons are:
- the cost of a Node driver process and an extra hop;
- loss of event visibility (target attach, crashes, downloads, dialogs);
- OOPIF routing;
- Playwright's test-oriented auto-waiting.

Detection is not a stated reason anywhere. The counter-evidence also matters: both browser vendors' MCP servers stay on Playwright and Puppeteer and reach CDP only for specific probes.

---

## Cross-cutting comparison

### Element and document identity (the core design question)

| Tool | Ref shown to model | Identity key behind it | Survives re-render? | Survives navigation? | Stale behaviour | Fallback |
|---|---|---|---|---|---|---|
| Playwright MCP | `e5`, `f1e2` | expando `_ariaRef` on the element; per-document counter; frame seq | only if role and name are unchanged | no: main frame renumbered | "Ref … not found in the current page snapshot. Try capturing new snapshot." | none for refs; generated code uses `getByRole` |
| Chrome DevTools MCP | `3_14` | `loaderId_backendNodeId` → uid map | yes (same node) | no (new loaderId) | "Element with uid … no longer exists" | none |
| agent-browser | `@e3` | `{backendNodeId, role, name, nth, frame}` per `(session, frame, loaderId)` bucket | yes | no (bucket wiped) | AX re-find by role/name/nth, else "Element ref … is stale" | **role/name/nth** |
| browser-use | `[38]` | `backendNodeId` itself (synthetic on collision) | yes | backend IDs differ after navigation | "Element index N not available…" returned as content | replay only: hash/xpath/AX-name cascade |
| Stagehand | `0-123` | `frameOrdinal-backendNodeId` → absolute XPath (iframe and shadow hops) | XPath re-resolved per action | v4 facade rejects use after navigation | self-heal (opt-in) re-infers | LLM re-inference |
| Skyvern | `AB3x` | `unique_id` attribute stamped in the DOM | while the element persists | no | re-scrape | codegen selectors → `prompt=` AI fallback |
| Lightpanda LP | `14` | NodeRegistry ID = backendNodeId | yes | no | n/a | n/a |
| Anthropic example | `ref_3` | page-side `WeakMap` | yes | no | "Unknown or stale ref… Call read_page again" | coordinates |

Observations:
1. **Document identity comes from the loader, not from the URL.** Chrome DevTools MCP and agent-browser key refs by `loaderId`. Stagehand v4 binds snapshots to URL, which misses same-URL reloads. Playwright gets the same effect with frame renumbering, but only for the main frame and only when navigating away from a real URL.
2. **Frame ordinals must outlive session swaps.** Stagehand keeps the ordinal when an OOPIF root swaps sessions (`page.ts:408-447`). agent-browser treats a session change as a new document, which is conservative but loses refs on a same-document process swap.
3. **Two ref philosophies.**
   - *Node-identity refs* (backendNodeId): cheap, and stable across re-renders that keep the node.
   - *Semantic refs* (role+name): survive node replacement, but Playwright's version churns on text changes.
   - agent-browser combines them: node identity first, semantic fallback second. The fallback is visible in the data model (`nth`).
4. **Staleness is always reported as text with a "re-snapshot" hint.** Nobody returns a typed reason (document replaced, node detached, unknown ref, frame gone).

### Page state and token control
- **Representation.** AX-first everywhere except browser-use (DOM-first with AX joined in) and Skyvern (pseudo-HTML). Screenshots are optional add-ons, set-of-marks is in retreat, and coordinate tools are capability-gated (Playwright `vision`, Chrome DevTools MCP `experimentalVision`, Anthropic coordinates as an alternative to refs).
- **Budgets.** Explicit byte or token budgets exist only in Lightpanda (`max_bytes`) and Skyvern (100k). The rest rely on scoping (`-s`, `focusLocator`, `depth`), interactive-only filters, attribute whitelists, file offloading (Playwright), or grep tools (`browser_find`).
- **Incremental output.**
  - agent-browser deltas: ref ops plus a line splice, with a 70% fallback to full.
  - browser-use `*` new-element markers.
  - Stagehand's two-step diff.
  - Playwright has no diff mode; its `findNewNode` is used only by the recorder.

### Post-action settling and verification

| Tool | Settle strategy | Outcome signals |
|---|---|---|
| Playwright MCP | requests made during the action → 500 ms → `load` or resource bodies, raced against modals | modal state, tabs header diff, downloads, console link |
| Chrome DevTools MCP | navigation probe (100 ms / 3 s), then MutationObserver quiet (100 ms / 3 s) | opened pages, "Page navigated to X", dialog |
| Stagehand | network quiet *before* the action | twoStep diff |
| browser-use | event timeouts; URL and target comparison | new tabs, checkbox toggle, input readback, auto-closed dialogs |
| Skyvern | MutationObserver around the action | new elements → dropdown flow; LLM goal check |
| Anthropic example | `sleep(100)` | `state_changes` drained after every call |

Nobody returns a typed "this action had no observable effect", even though that is the signal an agent most needs.

### Record, replay, self-heal
- **What gets stored.**
  - Stagehand: `Action{xpath, method, args with %var%}`.
  - browser-use: element fingerprints.
  - Skyvern: generated Python with semantic selectors and prompts.
  - Playwright: code in four languages.
  - Lightpanda: PandaScript.
- **Healing.** Stagehand and Skyvern both "replay, then on failure re-infer and overwrite or branch". Skyvern's reviewer is the most principled: it never deletes paths and it compile-checks new versions.
- **Cache keys.** Stagehand v3 used instruction + URL (query sorted) + config, with manual invalidation; v4 hides the key server-side. Key sensitivity to instruction wording is a documented pain point.

### Failure modes reported in issues
- **Token blowups.** playwright-mcp #889 saw 6× tokens between 0.0.30 and 0.0.32, which led to snapshot-to-file.
- **Snapshot blind spots.**
  - Power Apps showing only iframes (playwright-mcp #447).
  - `visibility:hidden` parent with a visible child (#535).
  - A checkbox not detected (browser-use #871).
  - Nested iframes returning zero elements (stagehand #870).
- **Navigation races.**
  - "Execution context was destroyed" during a snapshot (playwright-mcp #439).
  - A screenshot right after navigate times out on internal lock contention (chrome-devtools-mcp #2459).
  - The Anthropic README: after a click that navigates, "the next read can fail once or read the old page".
- **Profiles.** Profile lock errors ("Browser is already in use", playwright-mcp #769/#942). Chrome 136+ refuses remote debugging on the default user-data-dir (browser-use #1520). Storage-state persistence broken in Stagehand v3 (#1250).
- **Dialogs** hang the session (chrome-devtools-mcp #713; the Anthropic example notes that every later call fails after 60 s).
- **Scale and lifecycle.**
  - Eager per-tab work crashes Chrome with about 2000 tabs (chrome-devtools-mcp #1921).
  - Focus stealing on macOS (#1254).
  - A global "selected page" races across agents (#1019).
  - Orphaned headless Chrome helpers spin at full CPU (agent-browser #1371); a `--cdp` attach hangs (#1193).
  - Windows daemon startup failures (agent-browser #56, #390).
- **Extraction.** Link URLs were dropped from the snapshot (stagehand #651/#912).

---

## Ergonomics: what to steal, what to avoid

### Call sites at their best

```ts
// Stagehand v4: observe once, replay deterministically, secrets never reach the model
const { data: [action] } = await stagehand.observe("click the login button")   // docs/v4/basics/act.mdx:544-549
await stagehand.act(action)
await stagehand.act("type %password% into the password field",
  { variables: { password: process.env.USER_PASSWORD } })                       // act.mdx:688-690

// Stagehand: schema in, typed data out (sdk-ts/examples/extract.ts:20-26)
const result = await stagehand.extract("Extract the page heading and description",
  z.object({ heading: z.string(), description: z.string() }))
```
```sh
# agent-browser: the canonical three-step loop (skill-data/core/SKILL.md:27-30)
agent-browser open <url>; agent-browser snapshot -i; agent-browser click @e3
agent-browser find label "Email" fill "test@test.com"        # semantic fallback (README.md:256)
```
```python
# Skyvern: selector first, prompt as the declared fallback (README.md:182)
await page.click("#submit-btn", prompt="Click the Submit button")
# browser-use: domain-scoped secrets (examples/features/sensitive_data.py:27-39)
Agent(task=..., sensitive_data={'httpbin.org': company_credentials})
```

Playwright MCP's click takes `{element: 'Submit button', target: 'e2'}` and returns `await page.getByRole('button', { name: 'Submit' }).click();` (PW `tests/mcp/click.spec.ts:36-45`). Every action teaches the model, and the user, the deterministic equivalent.

### Call sites at their worst

```ts
// Stagehand: failure is a value every caller must check (examples/act.ts:25-27)
if (!result.data.success) throw new Error(`act() failed: ${result.data.message}`)
```
```python
# browser-use: leaked internals and config nesting (examples/browser/using_cdp.py:32)
BrowserSession(browser_profile=BrowserProfile(cdp_url='http://localhost:9222', is_local=True))
```
```sh
# agent-browser: mandatory ceremony because the default session is shared machine-wide (SKILL.md:39-41)
export AGENT_BROWSER_SESSION="$(agent-browser session id --scope worktree --prefix task)"
```

Two more:
- Skyvern encodes control flow in prose YAML (`navigation_goal: "If you're not on the login page… If you fail… terminate."`).
- Chrome DevTools MCP's `navigate_page` hides a discriminated union in a flat schema (`type: url|back|forward|reload`, with `url` "only for type=url").

### Friction patterns
- **Implicit current page.** Stagehand follows Chrome's focused tab, so a popup silently retargets `act`. Chrome DevTools MCP needed a global `select_page` until `pageId` became mandatory.
- **Two-object lifecycles and aliases.**
  - Stagehand closes only browsers it launched.
  - browser-use has `Browser = BrowserSession`, `Controller = Tools`, a roughly 62-parameter `Agent.__init__`, and two decorator spellings.
- **Docs that drift from code.**
  - Stagehand: "act() self-heals" in the README while `selfHeal=false` in code.
  - browser-use: the prompt promises bounding boxes and `|SCROLL|`, which the code doesn't produce.
  - agent-browser: `diff snapshot` doesn't match its README.
- **Silent no-ops.**
  - Lightpanda's Emulation and CSS stubs return success.
  - agent-browser's deprecated `-C` flag still parses and does nothing; its CHANGELOG records `--state` "never wired up" and cross-domain state "silently dropped".
  - Skyvern's `enable_self_healing` "has no runtime effect".
  - cdp-use's one-slot handler registry silently replaces handlers.
- **Untyped errors.**
  - cdp-use raises `RuntimeError(dict)`.
  - browser-use re-wraps everything as `RuntimeError('Error executing action X: …')`.
  - Stagehand's error says "Please use a supported Playwright locator method." even though it has no Playwright.
- **Errors that are good.**
  - agent-browser: "Element '…' is covered by <div.modal> at its click point… Dismiss or interact with the covering element first".
  - browser-use: the upload error spells out the exact `available_file_paths=[...]` fix.
  - Chrome DevTools MCP's design principles call for "Self-Healing Errors".
- **Unsafe retries.** Stagehand warns that a failed `act()` may already have submitted. agent-browser's `outcome_unknown` is the right answer.

### How internals make the nice surface possible
- **One definition, several surfaces.** Playwright defines a tool once with zod. It becomes an MCP tool (`zod.toJSONSchema`, with `readOnlyHint`/`destructiveHint` from the tool type), a CLI command (`declareCommand`), and raw/JSON output, all served by one backend (`tools/utils/mcp/tool.ts:30-44`; `cli-daemon/command.ts:22-106`). Chrome DevTools MCP also generates its CLI from tool definitions.
- **A response builder.** Playwright tools only call `setIncludeSnapshot()`, `addAction()` and `addTextResult()`. The builder appends the tabs diff, modal state, snapshot file, console and downloads. Chrome DevTools MCP resolves requested parts in parallel and emits `structuredContent`.
- **A daemon that owns the ref map**, which lets stateless shell calls say `@e3` (agent-browser `daemon.rs:582-588`).
- **Injection by name.** browser-use builds a Pydantic param model from a function signature and injects `browser_session` and `page_extraction_llm` by parameter name. Pleasant to write, but the dependency contract is implicit, which is exactly what Effect's `R` channel fixes.
- **Typed extract.** Stagehand's `extract` keeps static types (`z.output<Schema>`) while rewriting the wire schema (URL → element ID). The model sees one schema, the caller another.

---

## Lessons and candidate abstractions for an Effect-native design

The user wants the native layer to model browser concepts faithfully. The surveyed tools converge on one identity model. Each was reached ad hoc, and none expresses it in types.

### 1. Browser identity as typed values
- **Branded IDs.** `TargetId`, `SessionId`, `FrameId`, `LoaderId`, `BackendNodeId` and `ExecutionContextId` as `Schema.String.pipe(Schema.brand(...))`.
- **`DocumentKey = { frameId, loaderId }`.** This is the unit of ref validity (Chrome DevTools MCP, agent-browser). A `Frame` holds a `SubscriptionRef<DocumentKey>` updated from `Page.frameNavigated` / `Page.lifecycleEvent`. Same-document navigations keep the key.
- **`NodeKey = { document: DocumentKey, backendNodeId }`.** This is the stable identity. Never hand out raw `nodeId` values; they are invalidated by `DOM.documentUpdated`.
- **Frame ordinals** are allocated per `Page` and keyed by `FrameId`, not by session. Keep the ordinal when an iframe becomes an OOPIF (Stagehand `page.ts:408-447`). Sessions are a routing detail that the `FrameRegistry` maps from frame to session.
- **`Ref`** is a branded string rendered as `e12` / `f2e7` for the model. Behind it, `RefRegistry` (a `Context.Service` per Page) stores `RefEntry { node: NodeKey, fingerprint: { role, name, nth, xpath }, mintedIn: SnapshotId }`. One ref per `NodeKey` is reused across snapshots, so refs survive re-renders that keep the node, which agent-browser documents. Buckets are dropped when a `DocumentKey` changes, so a ref can never resolve into a new document. This gives Playwright's renumbering guarantee without its churn on renames.
- **Resolution returns a typed outcome.**

  ```ts
  resolve(ref): Effect<ResolvedNode, StaleRef | FrameDetached, Page>
  // StaleRef.reason: "UnknownRef" | "DocumentReplaced" | "NodeDetached"
  ```

  Rebinding by semantics is an explicit *policy*, not a silent behaviour:

  ```ts
  RefPolicy.strict | RefPolicy.rebindBySemantics({ sameDocumentOnly: true })
  ```

  The second policy re-finds by role/name/nth (agent-browser) and reports `Rebound { from, to }` in the outcome, so neither the model nor a script is fooled.
- **BiDi forward-compatibility.** WebDriver BiDi offers `sharedId` node references and `browsingContext.locateNodes` with an `accessibility` locator (`{role, name}`) (webdriver-bidi `index.bs:3683`). `NodeKey` should be an interface the CDP backend fills with `backendNodeId` and the BiDi backend fills with `sharedId`.

### 2. Snapshots as values, with diffs and budgets
- **`Snapshot`** is a `Schema.Class` with `id`, `documents: ReadonlyArray<DocumentKey>`, a tree of `SnapshotNode { ref?, role, name, states, value?, url?, children }`, and a `render(format, budget)` method.
- **Sources** are pluggable providers:
  - `AxTreeSource` (`getFullAXTree` per frame, Stagehand/agent-browser style);
  - `DomSnapshotSource` (DOMSnapshot + paint order, browser-use style, for occlusion and `cursor:pointer`);
  - `LightpandaSemanticSource` (`LP.getSemanticTree`);
  - injected-script sources.
- **Diffs** are a pure `Snapshot.diff(prev, next): SnapshotDelta`, keyed by `NodeKey`: added and removed refs, changed names and states, plus a fallback to full above a size ratio (agent-browser's 70%). Rendering a delta also yields browser-use's `*` markers for free.
- **Budgets.** `effect/ai` `Tokenizer` for token budgets, with priority-based line dropping (Lightpanda `max_bytes` priorities) and `[more]` markers. Scope by ref or locator rather than hard truncation (Skyvern's "HACK alert" is the anti-pattern).
- **Cache-friendly history.** Provide a `ContextPolicy` that replaces old observations in *intervals* (the Anthropic best-practices point), so prompt caching survives.

### 3. Actions return typed outcomes
- **Every action is** `Effect<ActionOutcome, ActionError, Page>`.
- **`ActionOutcome`** is a `Data.TaggedEnum`:
  - `Navigated { from, to, documentKey }`;
  - `OpenedPage { pageId }`;
  - `DialogOpened { kind, message }`;
  - `FileChooserOpened`;
  - `DownloadStarted { guid, suggestedFilename }`;
  - `DomChanged { delta }`;
  - `ValueVerified { expected, actual }`;
  - `NoObservableEffect`.
  - `NoObservableEffect` is the signal nobody provides today.
- **Settling** is a composable `Settle` strategy, raced against modal events:

  ```ts
  Settle.navigationOr(Settle.all(Settle.networkQuiet("500 millis"), Settle.domQuiet("100 millis")))
  ```

  It is built from `Stream`s over the session's CDP events with `Effect.raceAll` and timeouts, and the strategy's parameters are visible and testable (unlike the hard-coded 500 ms / 3 s / 5 s constants above).
- **Pre-action checks** are explicit steps: `scrollIntoViewIfNeeded`, `getBoxModel`, hit-test (agent-browser's "covered by") and readback (browser-use, Skyvern). They are not Playwright-style hidden auto-waiting.
- **Retry safety** is in the error type. `OutcomeUnknown` marks a mutating command that was sent before the transport failed. `Effect.retry` policies should refuse to retry it by default.

### 4. Modal state and concurrency are first-class
- **Modal state.** A `Page` exposes `SubscriptionRef<Option<ModalState>>` for dialogs and file choosers. Actions fail with `ModalStateBlocking { state, handledBy }` rather than hanging (chrome-devtools-mcp #713). An optional watchdog fiber can auto-handle dialogs and record them, as browser-use does.
- **No global "current page."** Tools take an explicit `PageRef`, or a toolkit is built *per agent* from that agent's page set (`LayerMap` / `RcMap`). Per-page `Semaphore`s serialize CDP sequences. This avoids the chrome-devtools-mcp #1019 race and Stagehand's silent retargeting by popups.
- **Watchdogs** are `Effect.forkScoped` fibers over a per-browser `PubSub` of CDP events, filtered by session: downloads, crashes, dialogs, popups, storage-state autosave and the domain policy. Unlike cdp-use's one-slot registry, every subscriber gets every event and handler failures are typed.
- **Lifetimes.** `Browser`, `BrowserContext`, `Page` and `Frame` are `Scope`d resources. `Browser.launch`, `Browser.connect(cdpUrl)` and provider layers (Browserbase, Browser Use cloud, Lightpanda) are alternative `Layer`s. Scope finalizers kill the child process and remove the temp profile, which addresses agent-browser #1371 (orphaned processes) and the Anthropic example's leaked profile dir.

### 5. Toolkits from one definition: library, MCP, CLI, provider toolsets
- **Tools.** Define each action as an `effect/ai` `Tool.make("click", { parameters: Schema.Struct({ ref: Ref, element: Schema.optional(Schema.String) }), success: ActionOutcome, failure: StaleRef | ModalStateBlocking, failureMode: "return" })`.
  - `failureMode: "return"` feeds typed failures back to the model.
  - Gate `javascript_exec`, uploads and purchase-like actions with `needsApproval`.
- **Handlers.** `Toolkit.toLayer` handlers require `Page | RefRegistry`.
- **Same toolkit, three surfaces.**
  - an MCP server via `McpServer.toolkit` with `layerStdio` / `layerHttp`;
  - a CLI via `effect/cli` from the same Schemas (Playwright's three-surface trick, typed);
  - the library API itself.
- **Provider toolsets.** Implement Anthropic's `browser_toolset_20260801` as handlers behind `Tool.providerDefined`, with `browserState` / `state_changes` derived from `ActionOutcome`.
- **WebMCP.** Page-registered WebMCP tools map to `Tool.dynamic`, marked untrusted.
- **A response builder** (`Observation`) appends the snapshot delta, tabs, modal state and events, so handlers stay small.

### 6. Schema-driven extraction
- `page.extract(schema, { instruction, scope })` uses `LanguageModel.generateObject` with an Effect `Schema`.
- Stagehand's URL trick becomes a Schema transformation. Fields annotated as `Url` are encoded to the wire as `Ref` patterns and decoded back through the snapshot's URL map, which the decoding service provides. The caller gets `Schema.Type`, and the model sees the encoded side.
- Secrets are `Redacted` values and are never in prompts. A `SecretStore` service substitutes them at execution time only when the domain pattern matches (browser-use), and logs and traces stay redacted by construction.

### 7. Record, replay, heal
- **Record.** Every AI-decided step emits `ActionRecord { instruction, url, documentFingerprint, target: { fingerprint, candidates: [roleName, css, xpath] }, method, args (with Secret/Variable placeholders), outcome }`, as a Schema-encodable value and a `Stream`.
- **Replay.** A replay is an ordinary Effect program that resolves candidates in order. On `TargetNotFound` it `catchTag`s into an LLM re-inference and *appends* a new branch rather than overwriting (Skyvern's reviewer principle). Replay must also check that the recorded `ActionOutcome` *tag* recurs. A replay that "clicked" but produced `NoObservableEffect` has failed.
- **Cache.** `effect/persistence` `KeyValueStore` / `PersistedCache` keyed by a Schema-encoded `{ normalizedInstruction, urlPattern, frameShape }`. Keep the key transparent and local: Stagehand v4's opaque server key and value-bearing variables are both complaints.
- **Codegen.** Records render to TypeScript against the deterministic API, as Playwright MCP's "Ran Playwright code" and Director do. For long runs, `effect/workflow` can make the agent loop durable, but browser actions are re-executed, not memoised. Only reads such as extractions are safe to memoise.

### 8. Code mode
- OpenAI's `exec_js`, Stagehand v4's "code mode", playwright-cli and dev-browser all let the model script against a persistent page. An Effect library can offer a typed version: model-written `Effect.gen` snippets that are type-checked against the public API before they run, with the `Scope` and `Page` provided.
- This is speculative but distinctive. The type checker becomes a pre-execution verifier.

---

## Open questions

1. **Snapshot source cost.** Which source should be the default: `getFullAXTree` per frame, or DOMSnapshot plus AX, or an injected script? browser-use's four-call merge is accurate but heavy. We need measurements on OOPIF-heavy pages (Power Apps, ERPs) before choosing.
2. **Same-URL reloads.** Should refs survive a reload of the same URL? Loader-keyed designs say no. Is an opt-in semantic rebind across documents worth exposing?
3. **Ref rendering.** Do frame ordinals belong in the ref string (Playwright `f1e2`, Stagehand `1-123`) or only in the registry (agent-browser `@e3`)? Shorter refs save tokens, but they hide cross-frame mistakes.
4. **BiDi parity.** BiDi has `sharedId` and accessibility locators but no full-AX-tree dump and no `backendNodeId`. Can `NodeKey` and `Snapshot` be backend-neutral without an injected-script fallback?
5. **Settle defaults.** Which defaults suit agents versus tests? Should `Settle` be inferred from the action (submit vs hover), as Playwright MCP partly does?
6. **Extension-hosted driver.** Is Stagehand v4's extension-hosted driver, which brings closed shadow roots and in-browser latency, worth supporting as a transport, or is it out of scope for a library?
7. **Caching hosted browsers.** How should the action cache key handle Browserbase-style remote browsers, where DOM fingerprints vary by region and A/B bucket?
8. **Prompt injection.** Snapshot text is untrusted (Anthropic's guidance; Skyvern's prompt boundary; Playwright's `untrustedContent` hint). Should `Snapshot.render` mark page-sourced spans structurally?
9. **Lightpanda as a fast, layout-free test backend.** It is attractive, but it has one context per connection, faux geometry and stubbed Emulation. Do we need a capability descriptor per backend, so tools fail with `Unsupported` rather than a silent no-op?

---

Sources (web): browser-use.com/posts/playwright-to-cdp; browser-use.com/changelog/19-8-2025; browserbase.com/blog/stagehand-v3; browserbase.com/blog/introducing-director; lightpanda.io/blog/posts/lp-domain-commands-and-native-mcp; lightpanda.io/blog/posts/cdp-vs-playwright-vs-puppeteer-is-this-the-wrong-question; skyvern.com/docs/developers/features/code-caching; github.com/anthropics/anthropic-sdk-typescript/blob/main/browser-toolset.md. GitHub issues cited by repo and number. Effect module names were checked against a local `effect@4.0.0` (`effect/ai`: Tool, Toolkit, McpServer, Tokenizer, LanguageModel; `effect/persistence`; `effect/workflow`). They have not been checked against 4.0.5.
