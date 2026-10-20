/**
 * Supports additional targets discovery and allows to attach to them.
 *
 * Generated from the Chrome DevTools Protocol, devtools-protocol 0.0.1696802 (Chrome 155). Don't edit: correct the model (`packages/tools/codegen/protocols/cdp`) and run `pnpm codegen:protocol`.
 *
 * @stability unstable
 * @since 0.1.0
 */
import type * as Brand from "effect/Brand"
import * as Schema from "effect/Schema"
import * as Protocol from "../protocol/Protocol.ts"
import * as Browser from "./Browser.ts"
import * as Page from "./Page.ts"

/**
 * A filter used by target query/discovery/auto-attach operations.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface FilterEntry {
  /**
   * If set, causes exclusion of matching targets from the list.
   */
  readonly exclude?: boolean | undefined
  /**
   * If not present, matches any type.
   */
  readonly type?: string | undefined
}

/**
 * Schema for `FilterEntry`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const FilterEntry = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    exclude: Schema.optional(Schema.Boolean),
    type: Schema.optional(Schema.String)
  }).annotate({ identifier: "Target.FilterEntry" })
) as any as Schema.Codec<FilterEntry>

/**
 * `RemoteLocation`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface RemoteLocation {
  readonly host: string
  readonly port: number
}

/**
 * Schema for `RemoteLocation`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const RemoteLocation = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    host: Schema.String,
    port: Schema.Int
  }).annotate({ identifier: "Target.RemoteLocation" })
) as any as Schema.Codec<RemoteLocation>

/**
 * Unique identifier of attached debugging session.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type SessionID = Brand.Branded<string, "~@usestrider/browser/cdp/Target/SessionID">

/**
 * Schema for `SessionID`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SessionID = /*#__PURE__*/ Schema.String.pipe(
  /*#__PURE__*/ Schema.brand("~@usestrider/browser/cdp/Target/SessionID")
) as any as Schema.Codec<SessionID>

/**
 * The entries in TargetFilter are matched sequentially against targets and
 * the first entry that matches determines if the target is included or not,
 * depending on the value of `exclude` field in the entry.
 * If filter is not specified, the one assumed is
 * [{type: "browser", exclude: true}, {type: "tab", exclude: true}, {}]
 * (i.e. include everything but `browser` and `tab`).
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type TargetFilter = ReadonlyArray<FilterEntry>

/**
 * Schema for `TargetFilter`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const TargetFilter = /*#__PURE__*/ Schema.suspend(() => Schema.Array(FilterEntry)) as any as Schema.Codec<
  TargetFilter
>

/**
 * `TargetID`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type TargetID = Brand.Branded<string, "~@usestrider/browser/cdp/Target/TargetID">

/**
 * Schema for `TargetID`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const TargetID = /*#__PURE__*/ Schema.String.pipe(
  /*#__PURE__*/ Schema.brand("~@usestrider/browser/cdp/Target/TargetID")
) as any as Schema.Codec<TargetID>

/**
 * `TargetInfo`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface TargetInfo {
  readonly targetId: TargetID
  /**
   * List of types: https://source.chromium.org/chromium/chromium/src/+/main:content/browser/devtools/devtools_agent_host_impl.cc?ss=chromium&q=f:devtools%20-f:out%20%22::kTypeTab%5B%5D%22
   */
  readonly type: string
  readonly title: string
  readonly url: string
  /**
   * Whether the target has an attached client.
   */
  readonly attached: boolean
  /**
   * Id of the parent target, if any. For example, "iframe" target may have a "page" parent.
   */
  readonly parentId?: TargetID | undefined
  /**
   * Opener target Id
   */
  readonly openerId?: TargetID | undefined
  /**
   * Whether the target has access to the originating window.
   */
  readonly canAccessOpener?: boolean | undefined
  /**
   * Frame id of originating window (is only set if target has an opener).
   */
  readonly openerFrameId?: Page.FrameId | undefined
  /**
   * Id of the parent frame, present for "iframe" and "worker" targets. For nested workers,
   * this is the "ancestor" frame that created the first worker in the nested chain.
   */
  readonly parentFrameId?: Page.FrameId | undefined
  readonly browserContextId?: Browser.BrowserContextID | undefined
  /**
   * Provides additional details for specific target types. For example, for
   * the type of "page", this may be set to "prerender".
   */
  readonly subtype?: string | undefined
  /**
   * Embedder-specific target metadata. This is only set for targets of
   * type "tab".
   */
  readonly embedderData?: { readonly [key: string]: unknown } | undefined
}

/**
 * Schema for `TargetInfo`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const TargetInfo = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    targetId: TargetID,
    type: Schema.String,
    title: Schema.String,
    url: Schema.String,
    attached: Schema.Boolean,
    parentId: Schema.optional(TargetID),
    openerId: Schema.optional(TargetID),
    canAccessOpener: Schema.optional(Schema.Boolean),
    openerFrameId: Schema.optional(Page.FrameId),
    parentFrameId: Schema.optional(Page.FrameId),
    browserContextId: Schema.optional(Browser.BrowserContextID),
    subtype: Schema.optional(Schema.String),
    embedderData: Schema.optional(Schema.Record(Schema.String, Schema.Unknown))
  }).annotate({ identifier: "Target.TargetInfo" })
) as any as Schema.Codec<TargetInfo>

/**
 * The state of the target window.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type WindowState =
  | "normal"
  | "minimized"
  | "maximized"
  | "fullscreen"
  | (string & {})

/**
 * Schema for `WindowState`: known values, and any other string.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const WindowState = Schema.String as any as Schema.Codec<WindowState>

/**
 * Activates (focuses) the target.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface ActivateTargetParams {
  readonly targetId: TargetID
}

/**
 * Schema for `ActivateTargetParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ActivateTargetParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    targetId: TargetID
  }).annotate({ identifier: "Target.ActivateTargetParams" })
) as any as Schema.Codec<ActivateTargetParams>

/**
 * Attaches to the browser target, only uses flat sessionId mode.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface AttachToBrowserTargetResult {
  /**
   * Id assigned to the session.
   */
  readonly sessionId: SessionID
}

/**
 * Schema for `AttachToBrowserTargetResult`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const AttachToBrowserTargetResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    sessionId: SessionID
  }).annotate({ identifier: "Target.AttachToBrowserTargetResult" })
) as any as Schema.Codec<AttachToBrowserTargetResult>

/**
 * Attaches to the target with given id.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface AttachToTargetParams {
  readonly targetId: TargetID
  /**
   * Enables "flat" access to the session via specifying sessionId attribute in the commands.
   * We plan to make this the default, deprecate non-flattened mode,
   * and eventually retire it. See crbug.com/991325.
   */
  readonly flatten?: boolean | undefined
}

/**
 * Schema for `AttachToTargetParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const AttachToTargetParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    targetId: TargetID,
    flatten: Schema.optional(Schema.Boolean)
  }).annotate({ identifier: "Target.AttachToTargetParams" })
) as any as Schema.Codec<AttachToTargetParams>

/**
 * Attaches to the target with given id.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface AttachToTargetResult {
  /**
   * Id assigned to the session.
   */
  readonly sessionId: SessionID
}

/**
 * Schema for `AttachToTargetResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const AttachToTargetResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    sessionId: SessionID
  }).annotate({ identifier: "Target.AttachToTargetResult" })
) as any as Schema.Codec<AttachToTargetResult>

/**
 * Issued when attached to target because of auto-attach or `attachToTarget` command.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface AttachedToTargetParams {
  /**
   * Identifier assigned to the session used to send/receive messages.
   */
  readonly sessionId: SessionID
  readonly targetInfo: TargetInfo
  readonly waitingForDebugger: boolean
}

/**
 * Schema for `AttachedToTargetParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const AttachedToTargetParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    sessionId: SessionID,
    targetInfo: TargetInfo,
    waitingForDebugger: Schema.Boolean
  }).annotate({ identifier: "Target.AttachedToTargetParams" })
) as any as Schema.Codec<AttachedToTargetParams>

/**
 * Adds the specified target to the list of targets that will be monitored for any related target
 * creation (such as child frames, child workers and new versions of service worker) and reported
 * through `attachedToTarget`. The specified target is also auto-attached.
 * This cancels the effect of any previous `setAutoAttach` and is also cancelled by subsequent
 * `setAutoAttach`. Only available at the Browser target.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface AutoAttachRelatedParams {
  readonly targetId: TargetID
  /**
   * Whether to pause new targets when attaching to them. Use `Runtime.runIfWaitingForDebugger`
   * to run paused targets.
   */
  readonly waitForDebuggerOnStart: boolean
  /**
   * Only targets matching filter will be attached.
   */
  readonly filter?: TargetFilter | undefined
}

/**
 * Schema for `AutoAttachRelatedParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const AutoAttachRelatedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    targetId: TargetID,
    waitForDebuggerOnStart: Schema.Boolean,
    filter: Schema.optional(TargetFilter)
  }).annotate({ identifier: "Target.AutoAttachRelatedParams" })
) as any as Schema.Codec<AutoAttachRelatedParams>

/**
 * Closes the target. If the target is a page that gets closed too.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface CloseTargetParams {
  readonly targetId: TargetID
}

/**
 * Schema for `CloseTargetParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const CloseTargetParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    targetId: TargetID
  }).annotate({ identifier: "Target.CloseTargetParams" })
) as any as Schema.Codec<CloseTargetParams>

/**
 * Closes the target. If the target is a page that gets closed too.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface CloseTargetResult {
}

/**
 * Schema for `CloseTargetResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const CloseTargetResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({}).annotate({ identifier: "Target.CloseTargetResult" })
) as any as Schema.Codec<CloseTargetResult>

/**
 * Creates a new empty BrowserContext. Similar to an incognito profile but you can have more than
 * one.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface CreateBrowserContextParams {
  /**
   * If specified, disposes this context when debugging session disconnects.
   */
  readonly disposeOnDetach?: boolean | undefined
  /**
   * Proxy server, similar to the one passed to --proxy-server
   */
  readonly proxyServer?: string | undefined
  /**
   * Proxy bypass list, similar to the one passed to --proxy-bypass-list
   */
  readonly proxyBypassList?: string | undefined
  /**
   * An optional list of origins to grant unlimited cross-origin access to.
   * Parts of the URL other than those constituting origin are ignored.
   */
  readonly originsWithUniversalNetworkAccess?: ReadonlyArray<string> | undefined
}

/**
 * Schema for `CreateBrowserContextParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const CreateBrowserContextParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    disposeOnDetach: Schema.optional(Schema.Boolean),
    proxyServer: Schema.optional(Schema.String),
    proxyBypassList: Schema.optional(Schema.String),
    originsWithUniversalNetworkAccess: Schema.optional(Schema.Array(Schema.String))
  }).annotate({ identifier: "Target.CreateBrowserContextParams" })
) as any as Schema.Codec<CreateBrowserContextParams>

/**
 * Creates a new empty BrowserContext. Similar to an incognito profile but you can have more than
 * one.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface CreateBrowserContextResult {
  /**
   * The id of the context created.
   */
  readonly browserContextId: Browser.BrowserContextID
}

/**
 * Schema for `CreateBrowserContextResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const CreateBrowserContextResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    browserContextId: Browser.BrowserContextID
  }).annotate({ identifier: "Target.CreateBrowserContextResult" })
) as any as Schema.Codec<CreateBrowserContextResult>

/**
 * Creates a new page.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface CreateTargetParams {
  /**
   * The initial URL the page will be navigated to. An empty string indicates about:blank.
   */
  readonly url: string
  /**
   * Frame left origin in DIP (requires newWindow to be true or headless shell).
   */
  readonly left?: number | undefined
  /**
   * Frame top origin in DIP (requires newWindow to be true or headless shell).
   */
  readonly top?: number | undefined
  /**
   * Frame width in DIP (requires newWindow to be true or headless shell).
   */
  readonly width?: number | undefined
  /**
   * Frame height in DIP (requires newWindow to be true or headless shell).
   */
  readonly height?: number | undefined
  /**
   * Frame window state (requires newWindow to be true or headless shell).
   * Default is normal.
   */
  readonly windowState?: WindowState | undefined
  /**
   * The browser context to create the page in.
   */
  readonly browserContextId?: Browser.BrowserContextID | undefined
  /**
   * Whether BeginFrames for this target will be controlled via DevTools (headless shell only,
   * not supported on MacOS yet, false by default).
   */
  readonly enableBeginFrameControl?: boolean | undefined
  /**
   * Whether to create a new Window or Tab (false by default, not supported by headless shell).
   */
  readonly newWindow?: boolean | undefined
  /**
   * Whether to create the target in background or foreground (false by default, not supported
   * by headless shell).
   */
  readonly background?: boolean | undefined
  /**
   * Whether to create the target of type "tab".
   */
  readonly forTab?: boolean | undefined
  /**
   * Whether to create a hidden target. The hidden target is observable via protocol, but not
   * present in the tab UI strip. Cannot be created with `forTab: true`, `newWindow: true` or
   * `background: false`. The life-time of the tab is limited to the life-time of the session.
   */
  readonly hidden?: boolean | undefined
  /**
   * If specified, determines whether the new target should be focused.
   * By default, the focus behavior depends on the `background` parameter:
   * - If `background` is false (default) and `focus` is omitted, the new target is focused and the browser window is brought to the foreground.
   * - If `background` is false and `focus` is false, the target is opened but the browser window's focus remains unchanged (e.g., if the window was in the background, it stays there).
   * - If `background` is true, setting `focus` to true is not supported and will result in an error.
   */
  readonly focus?: boolean | undefined
}

/**
 * Schema for `CreateTargetParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const CreateTargetParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    url: Schema.String,
    left: Schema.optional(Schema.Int),
    top: Schema.optional(Schema.Int),
    width: Schema.optional(Schema.Int),
    height: Schema.optional(Schema.Int),
    windowState: Schema.optional(WindowState),
    browserContextId: Schema.optional(Browser.BrowserContextID),
    enableBeginFrameControl: Schema.optional(Schema.Boolean),
    newWindow: Schema.optional(Schema.Boolean),
    background: Schema.optional(Schema.Boolean),
    forTab: Schema.optional(Schema.Boolean),
    hidden: Schema.optional(Schema.Boolean),
    focus: Schema.optional(Schema.Boolean)
  }).annotate({ identifier: "Target.CreateTargetParams" })
) as any as Schema.Codec<CreateTargetParams>

/**
 * Creates a new page.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface CreateTargetResult {
  /**
   * The id of the page opened.
   */
  readonly targetId: TargetID
}

/**
 * Schema for `CreateTargetResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const CreateTargetResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    targetId: TargetID
  }).annotate({ identifier: "Target.CreateTargetResult" })
) as any as Schema.Codec<CreateTargetResult>

/**
 * Detaches session with given id.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface DetachFromTargetParams {
  /**
   * Session to detach.
   */
  readonly sessionId?: SessionID | undefined
}

/**
 * Schema for `DetachFromTargetParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const DetachFromTargetParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    sessionId: Schema.optional(SessionID)
  }).annotate({ identifier: "Target.DetachFromTargetParams" })
) as any as Schema.Codec<DetachFromTargetParams>

/**
 * Issued when detached from target for any reason (including `detachFromTarget` command). Can be
 * issued multiple times per target if multiple sessions have been attached to it.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface DetachedFromTargetParams {
  /**
   * Detached session identifier.
   */
  readonly sessionId: SessionID
}

/**
 * Schema for `DetachedFromTargetParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const DetachedFromTargetParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    sessionId: SessionID
  }).annotate({ identifier: "Target.DetachedFromTargetParams" })
) as any as Schema.Codec<DetachedFromTargetParams>

/**
 * Deletes a BrowserContext. All the belonging pages will be closed without calling their
 * beforeunload hooks.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface DisposeBrowserContextParams {
  readonly browserContextId: Browser.BrowserContextID
}

/**
 * Schema for `DisposeBrowserContextParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const DisposeBrowserContextParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    browserContextId: Browser.BrowserContextID
  }).annotate({ identifier: "Target.DisposeBrowserContextParams" })
) as any as Schema.Codec<DisposeBrowserContextParams>

/**
 * Inject object to the target's main frame that provides a communication
 * channel with browser target.
 *
 * Injected object will be available as `window[bindingName]`.
 *
 * The object has the following API:
 * - `binding.send(json)` - a method to send messages over the remote debugging protocol
 * - `binding.onmessage = json => handleMessage(json)` - a callback that will be called for the protocol notifications and command responses.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface ExposeDevToolsProtocolParams {
  readonly targetId: TargetID
  /**
   * Binding name, 'cdp' if not specified.
   */
  readonly bindingName?: string | undefined
  /**
   * If true, inherits the current root session's permissions (default: false).
   */
  readonly inheritPermissions?: boolean | undefined
}

/**
 * Schema for `ExposeDevToolsProtocolParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const ExposeDevToolsProtocolParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    targetId: TargetID,
    bindingName: Schema.optional(Schema.String),
    inheritPermissions: Schema.optional(Schema.Boolean)
  }).annotate({ identifier: "Target.ExposeDevToolsProtocolParams" })
) as any as Schema.Codec<ExposeDevToolsProtocolParams>

/**
 * Returns all browser contexts created with `Target.createBrowserContext` method.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface GetBrowserContextsResult {
  /**
   * An array of browser context ids.
   */
  readonly browserContextIds: ReadonlyArray<Browser.BrowserContextID>
  /**
   * The id of the default browser context if available.
   */
  readonly defaultBrowserContextId?: Browser.BrowserContextID | undefined
}

/**
 * Schema for `GetBrowserContextsResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const GetBrowserContextsResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    browserContextIds: Schema.Array(Browser.BrowserContextID),
    defaultBrowserContextId: Schema.optional(Browser.BrowserContextID)
  }).annotate({ identifier: "Target.GetBrowserContextsResult" })
) as any as Schema.Codec<GetBrowserContextsResult>

/**
 * Gets the targetId of the DevTools page target opened for the given target
 * (if any).
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface GetDevToolsTargetParams {
  /**
   * Page or tab target ID.
   */
  readonly targetId: TargetID
}

/**
 * Schema for `GetDevToolsTargetParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const GetDevToolsTargetParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    targetId: TargetID
  }).annotate({ identifier: "Target.GetDevToolsTargetParams" })
) as any as Schema.Codec<GetDevToolsTargetParams>

/**
 * Gets the targetId of the DevTools page target opened for the given target
 * (if any).
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface GetDevToolsTargetResult {
  /**
   * The targetId of DevTools page target if exists.
   */
  readonly targetId?: TargetID | undefined
}

/**
 * Schema for `GetDevToolsTargetResult`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const GetDevToolsTargetResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    targetId: Schema.optional(TargetID)
  }).annotate({ identifier: "Target.GetDevToolsTargetResult" })
) as any as Schema.Codec<GetDevToolsTargetResult>

/**
 * Returns information about a target.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface GetTargetInfoParams {
  readonly targetId?: TargetID | undefined
}

/**
 * Schema for `GetTargetInfoParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const GetTargetInfoParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    targetId: Schema.optional(TargetID)
  }).annotate({ identifier: "Target.GetTargetInfoParams" })
) as any as Schema.Codec<GetTargetInfoParams>

/**
 * Returns information about a target.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface GetTargetInfoResult {
  readonly targetInfo: TargetInfo
}

/**
 * Schema for `GetTargetInfoResult`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const GetTargetInfoResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    targetInfo: TargetInfo
  }).annotate({ identifier: "Target.GetTargetInfoResult" })
) as any as Schema.Codec<GetTargetInfoResult>

/**
 * Retrieves a list of available targets.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface GetTargetsParams {
  /**
   * Only targets matching filter will be reported. If filter is not specified
   * and target discovery is currently enabled, a filter used for target discovery
   * is used for consistency.
   */
  readonly filter?: TargetFilter | undefined
}

/**
 * Schema for `GetTargetsParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const GetTargetsParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    filter: Schema.optional(TargetFilter)
  }).annotate({ identifier: "Target.GetTargetsParams" })
) as any as Schema.Codec<GetTargetsParams>

/**
 * Retrieves a list of available targets.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface GetTargetsResult {
  /**
   * The list of targets.
   */
  readonly targetInfos: ReadonlyArray<TargetInfo>
}

/**
 * Schema for `GetTargetsResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const GetTargetsResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    targetInfos: Schema.Array(TargetInfo)
  }).annotate({ identifier: "Target.GetTargetsResult" })
) as any as Schema.Codec<GetTargetsResult>

/**
 * Opens a DevTools window for the target.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface OpenDevToolsParams {
  /**
   * This can be the page or tab target ID.
   */
  readonly targetId: TargetID
  /**
   * The id of the panel we want DevTools to open initially. Currently
   * supported panels are elements, console, network, sources, resources,
   * timeline, chrome-recorder, heap-profiler, lighthouse, and security.
   */
  readonly panelId?: string | undefined
}

/**
 * Schema for `OpenDevToolsParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const OpenDevToolsParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    targetId: TargetID,
    panelId: Schema.optional(Schema.String)
  }).annotate({ identifier: "Target.OpenDevToolsParams" })
) as any as Schema.Codec<OpenDevToolsParams>

/**
 * Opens a DevTools window for the target.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface OpenDevToolsResult {
  /**
   * The targetId of DevTools page target.
   */
  readonly targetId: TargetID
}

/**
 * Schema for `OpenDevToolsResult`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const OpenDevToolsResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    targetId: TargetID
  }).annotate({ identifier: "Target.OpenDevToolsResult" })
) as any as Schema.Codec<OpenDevToolsResult>

/**
 * Notifies about a new protocol message received from the session (as reported in
 * `attachedToTarget` event).
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface ReceivedMessageFromTargetParams {
  /**
   * Identifier of a session which sends a message.
   */
  readonly sessionId: SessionID
  readonly message: string
}

/**
 * Schema for `ReceivedMessageFromTargetParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ReceivedMessageFromTargetParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    sessionId: SessionID,
    message: Schema.String
  }).annotate({ identifier: "Target.ReceivedMessageFromTargetParams" })
) as any as Schema.Codec<ReceivedMessageFromTargetParams>

/**
 * Controls whether to automatically attach to new targets which are considered
 * to be directly related to this one (for example, iframes or workers).
 * When turned on, attaches to all existing related targets as well. When turned off,
 * automatically detaches from all currently attached targets.
 * This also clears all targets added by `autoAttachRelated` from the list of targets to watch
 * for creation of related targets.
 * You might want to call this recursively for auto-attached targets to attach
 * to all available targets.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface SetAutoAttachParams {
  /**
   * Whether to auto-attach to related targets.
   */
  readonly autoAttach: boolean
  /**
   * Whether to pause new targets when attaching to them. Use `Runtime.runIfWaitingForDebugger`
   * to run paused targets.
   */
  readonly waitForDebuggerOnStart: boolean
  /**
   * Enables "flat" access to the session via specifying sessionId attribute in the commands.
   * We plan to make this the default, deprecate non-flattened mode,
   * and eventually retire it. See crbug.com/991325.
   */
  readonly flatten?: boolean | undefined
  /**
   * Only targets matching filter will be attached.
   */
  readonly filter?: TargetFilter | undefined
}

/**
 * Schema for `SetAutoAttachParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SetAutoAttachParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    autoAttach: Schema.Boolean,
    waitForDebuggerOnStart: Schema.Boolean,
    flatten: Schema.optional(Schema.Boolean),
    filter: Schema.optional(TargetFilter)
  }).annotate({ identifier: "Target.SetAutoAttachParams" })
) as any as Schema.Codec<SetAutoAttachParams>

/**
 * Controls whether to discover available targets and notify via
 * `targetCreated/targetInfoChanged/targetDestroyed` events.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface SetDiscoverTargetsParams {
  /**
   * Whether to discover available targets.
   */
  readonly discover: boolean
  /**
   * Only targets matching filter will be attached. If `discover` is false,
   * `filter` must be omitted or empty.
   */
  readonly filter?: TargetFilter | undefined
}

/**
 * Schema for `SetDiscoverTargetsParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SetDiscoverTargetsParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    discover: Schema.Boolean,
    filter: Schema.optional(TargetFilter)
  }).annotate({ identifier: "Target.SetDiscoverTargetsParams" })
) as any as Schema.Codec<SetDiscoverTargetsParams>

/**
 * Enables target discovery for the specified locations, when `setDiscoverTargets` was set to
 * `true`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface SetRemoteLocationsParams {
  /**
   * List of remote locations.
   */
  readonly locations: ReadonlyArray<RemoteLocation>
}

/**
 * Schema for `SetRemoteLocationsParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const SetRemoteLocationsParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    locations: Schema.Array(RemoteLocation)
  }).annotate({ identifier: "Target.SetRemoteLocationsParams" })
) as any as Schema.Codec<SetRemoteLocationsParams>

/**
 * Issued when a target has crashed.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface TargetCrashedParams {
  readonly targetId: TargetID
  /**
   * Termination status type.
   */
  readonly status: string
  /**
   * Termination error code.
   */
  readonly errorCode: number
}

/**
 * Schema for `TargetCrashedParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const TargetCrashedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    targetId: TargetID,
    status: Schema.String,
    errorCode: Schema.Int
  }).annotate({ identifier: "Target.TargetCrashedParams" })
) as any as Schema.Codec<TargetCrashedParams>

/**
 * Issued when a possible inspection target is created.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface TargetCreatedParams {
  readonly targetInfo: TargetInfo
}

/**
 * Schema for `TargetCreatedParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const TargetCreatedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    targetInfo: TargetInfo
  }).annotate({ identifier: "Target.TargetCreatedParams" })
) as any as Schema.Codec<TargetCreatedParams>

/**
 * Issued when a target is destroyed.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface TargetDestroyedParams {
  readonly targetId: TargetID
}

/**
 * Schema for `TargetDestroyedParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const TargetDestroyedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    targetId: TargetID
  }).annotate({ identifier: "Target.TargetDestroyedParams" })
) as any as Schema.Codec<TargetDestroyedParams>

/**
 * Issued when some information about a target has changed. This only happens between
 * `targetCreated` and `targetDestroyed`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface TargetInfoChangedParams {
  readonly targetInfo: TargetInfo
}

/**
 * Schema for `TargetInfoChangedParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const TargetInfoChangedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    targetInfo: TargetInfo
  }).annotate({ identifier: "Target.TargetInfoChangedParams" })
) as any as Schema.Codec<TargetInfoChangedParams>

/**
 * Activates (focuses) the target.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const activateTarget: Protocol.CommandDef<"Target.activateTarget", ActivateTargetParams, void> =
  /*#__PURE__*/ Protocol.command(
    "Target.activateTarget",
    ActivateTargetParams,
    undefined,
    { status: "stable", session: "browser" }
  )

/**
 * Attaches to the browser target, only uses flat sessionId mode.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const attachToBrowserTarget: Protocol.CommandDef<
  "Target.attachToBrowserTarget",
  void,
  AttachToBrowserTargetResult
> = /*#__PURE__*/ Protocol.command(
  "Target.attachToBrowserTarget",
  undefined,
  AttachToBrowserTargetResult,
  { status: "experimental", session: "browser" }
)

/**
 * Attaches to the target with given id.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const attachToTarget: Protocol.CommandDef<"Target.attachToTarget", AttachToTargetParams, AttachToTargetResult> =
  /*#__PURE__*/ Protocol.command(
    "Target.attachToTarget",
    AttachToTargetParams,
    AttachToTargetResult,
    {
      status: "stable",
      session: "browser",
      createsResource: true,
      release: [{ method: "Target.detachFromTarget", param: "sessionId", from: "/sessionId" }]
    }
  )

/**
 * Adds the specified target to the list of targets that will be monitored for any related target
 * creation (such as child frames, child workers and new versions of service worker) and reported
 * through `attachedToTarget`. The specified target is also auto-attached.
 * This cancels the effect of any previous `setAutoAttach` and is also cancelled by subsequent
 * `setAutoAttach`. Only available at the Browser target.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const autoAttachRelated: Protocol.CommandDef<"Target.autoAttachRelated", AutoAttachRelatedParams, void> =
  /*#__PURE__*/ Protocol.command(
    "Target.autoAttachRelated",
    AutoAttachRelatedParams,
    undefined,
    { status: "experimental" }
  )

/**
 * Closes the target. If the target is a page that gets closed too.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const closeTarget: Protocol.CommandDef<"Target.closeTarget", CloseTargetParams, CloseTargetResult> =
  /*#__PURE__*/ Protocol.command(
    "Target.closeTarget",
    CloseTargetParams,
    CloseTargetResult,
    { status: "stable", session: "browser" }
  )

/**
 * Creates a new empty BrowserContext. Similar to an incognito profile but you can have more than
 * one.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const createBrowserContext: Protocol.CommandDef<
  "Target.createBrowserContext",
  CreateBrowserContextParams,
  CreateBrowserContextResult
> = /*#__PURE__*/ Protocol.command(
  "Target.createBrowserContext",
  CreateBrowserContextParams,
  CreateBrowserContextResult,
  {
    status: "stable",
    session: "browser",
    createsResource: true,
    release: [{ method: "Target.disposeBrowserContext", param: "browserContextId", from: "/browserContextId" }]
  }
)

/**
 * Creates a new page.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const createTarget: Protocol.CommandDef<"Target.createTarget", CreateTargetParams, CreateTargetResult> =
  /*#__PURE__*/ Protocol.command(
    "Target.createTarget",
    CreateTargetParams,
    CreateTargetResult,
    {
      status: "stable",
      session: "browser",
      createsResource: true,
      release: [{ method: "Target.closeTarget", param: "targetId", from: "/targetId" }]
    }
  )

/**
 * Detaches session with given id.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const detachFromTarget: Protocol.CommandDef<"Target.detachFromTarget", DetachFromTargetParams, void> =
  /*#__PURE__*/ Protocol.command(
    "Target.detachFromTarget",
    DetachFromTargetParams,
    undefined,
    { status: "stable", session: "browser" }
  )

/**
 * Deletes a BrowserContext. All the belonging pages will be closed without calling their
 * beforeunload hooks.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const disposeBrowserContext: Protocol.CommandDef<
  "Target.disposeBrowserContext",
  DisposeBrowserContextParams,
  void
> = /*#__PURE__*/ Protocol.command(
  "Target.disposeBrowserContext",
  DisposeBrowserContextParams,
  undefined,
  { status: "stable", session: "browser" }
)

/**
 * Inject object to the target's main frame that provides a communication
 * channel with browser target.
 *
 * Injected object will be available as `window[bindingName]`.
 *
 * The object has the following API:
 * - `binding.send(json)` - a method to send messages over the remote debugging protocol
 * - `binding.onmessage = json => handleMessage(json)` - a callback that will be called for the protocol notifications and command responses.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const exposeDevToolsProtocol: Protocol.CommandDef<
  "Target.exposeDevToolsProtocol",
  ExposeDevToolsProtocolParams,
  void
> = /*#__PURE__*/ Protocol.command(
  "Target.exposeDevToolsProtocol",
  ExposeDevToolsProtocolParams,
  undefined,
  { status: "experimental", session: "browser" }
)

/**
 * Returns all browser contexts created with `Target.createBrowserContext` method.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const getBrowserContexts: Protocol.CommandDef<"Target.getBrowserContexts", void, GetBrowserContextsResult> =
  /*#__PURE__*/ Protocol.command(
    "Target.getBrowserContexts",
    undefined,
    GetBrowserContextsResult,
    { status: "stable", session: "browser" }
  )

/**
 * Gets the targetId of the DevTools page target opened for the given target
 * (if any).
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const getDevToolsTarget: Protocol.CommandDef<
  "Target.getDevToolsTarget",
  GetDevToolsTargetParams,
  GetDevToolsTargetResult
> = /*#__PURE__*/ Protocol.command(
  "Target.getDevToolsTarget",
  GetDevToolsTargetParams,
  GetDevToolsTargetResult,
  { status: "experimental", session: "browser" }
)

/**
 * Returns information about a target.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const getTargetInfo: Protocol.CommandDef<"Target.getTargetInfo", GetTargetInfoParams, GetTargetInfoResult> =
  /*#__PURE__*/ Protocol.command(
    "Target.getTargetInfo",
    GetTargetInfoParams,
    GetTargetInfoResult,
    { status: "experimental", session: "browser" }
  )

/**
 * Retrieves a list of available targets.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const getTargets: Protocol.CommandDef<"Target.getTargets", GetTargetsParams, GetTargetsResult> =
  /*#__PURE__*/ Protocol.command(
    "Target.getTargets",
    GetTargetsParams,
    GetTargetsResult,
    { status: "stable", session: "browser" }
  )

/**
 * Opens a DevTools window for the target.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const openDevTools: Protocol.CommandDef<"Target.openDevTools", OpenDevToolsParams, OpenDevToolsResult> =
  /*#__PURE__*/ Protocol.command(
    "Target.openDevTools",
    OpenDevToolsParams,
    OpenDevToolsResult,
    { status: "experimental", session: "browser" }
  )

/**
 * Controls whether to automatically attach to new targets which are considered
 * to be directly related to this one (for example, iframes or workers).
 * When turned on, attaches to all existing related targets as well. When turned off,
 * automatically detaches from all currently attached targets.
 * This also clears all targets added by `autoAttachRelated` from the list of targets to watch
 * for creation of related targets.
 * You might want to call this recursively for auto-attached targets to attach
 * to all available targets.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const setAutoAttach: Protocol.CommandDef<"Target.setAutoAttach", SetAutoAttachParams, void> =
  /*#__PURE__*/ Protocol.command(
    "Target.setAutoAttach",
    SetAutoAttachParams,
    undefined,
    { status: "stable" }
  )

/**
 * Controls whether to discover available targets and notify via
 * `targetCreated/targetInfoChanged/targetDestroyed` events.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const setDiscoverTargets: Protocol.CommandDef<"Target.setDiscoverTargets", SetDiscoverTargetsParams, void> =
  /*#__PURE__*/ Protocol.command(
    "Target.setDiscoverTargets",
    SetDiscoverTargetsParams,
    undefined,
    { status: "stable", session: "browser" }
  )

/**
 * Enables target discovery for the specified locations, when `setDiscoverTargets` was set to
 * `true`.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const setRemoteLocations: Protocol.CommandDef<"Target.setRemoteLocations", SetRemoteLocationsParams, void> =
  /*#__PURE__*/ Protocol.command(
    "Target.setRemoteLocations",
    SetRemoteLocationsParams,
    undefined,
    { status: "experimental", session: "browser" }
  )

/**
 * Issued when attached to target because of auto-attach or `attachToTarget` command.
 *
 * @stability experimental
 * @category events
 * @since 0.1.0
 */
export const attachedToTarget: Protocol.EventDef<"Target.attachedToTarget", AttachedToTargetParams> =
  /*#__PURE__*/ Protocol.event(
    "Target.attachedToTarget",
    AttachedToTargetParams,
    { status: "experimental" }
  )

/**
 * Issued when detached from target for any reason (including `detachFromTarget` command). Can be
 * issued multiple times per target if multiple sessions have been attached to it.
 *
 * @stability experimental
 * @category events
 * @since 0.1.0
 */
export const detachedFromTarget: Protocol.EventDef<"Target.detachedFromTarget", DetachedFromTargetParams> =
  /*#__PURE__*/ Protocol.event(
    "Target.detachedFromTarget",
    DetachedFromTargetParams,
    { status: "experimental" }
  )

/**
 * Notifies about a new protocol message received from the session (as reported in
 * `attachedToTarget` event).
 *
 * @stability unstable
 * @category events
 * @since 0.1.0
 */
export const receivedMessageFromTarget: Protocol.EventDef<
  "Target.receivedMessageFromTarget",
  ReceivedMessageFromTargetParams
> = /*#__PURE__*/ Protocol.event(
  "Target.receivedMessageFromTarget",
  ReceivedMessageFromTargetParams,
  { status: "stable" }
)

/**
 * Issued when a target has crashed.
 *
 * @stability unstable
 * @category events
 * @since 0.1.0
 */
export const targetCrashed: Protocol.EventDef<"Target.targetCrashed", TargetCrashedParams> = /*#__PURE__*/ Protocol
  .event(
    "Target.targetCrashed",
    TargetCrashedParams,
    { status: "stable" }
  )

/**
 * Issued when a possible inspection target is created.
 *
 * @stability unstable
 * @category events
 * @since 0.1.0
 */
export const targetCreated: Protocol.EventDef<"Target.targetCreated", TargetCreatedParams> = /*#__PURE__*/ Protocol
  .event(
    "Target.targetCreated",
    TargetCreatedParams,
    { status: "stable" }
  )

/**
 * Issued when a target is destroyed.
 *
 * @stability unstable
 * @category events
 * @since 0.1.0
 */
export const targetDestroyed: Protocol.EventDef<"Target.targetDestroyed", TargetDestroyedParams> =
  /*#__PURE__*/ Protocol.event(
    "Target.targetDestroyed",
    TargetDestroyedParams,
    { status: "stable" }
  )

/**
 * Issued when some information about a target has changed. This only happens between
 * `targetCreated` and `targetDestroyed`.
 *
 * @stability unstable
 * @category events
 * @since 0.1.0
 */
export const targetInfoChanged: Protocol.EventDef<"Target.targetInfoChanged", TargetInfoChangedParams> =
  /*#__PURE__*/ Protocol.event(
    "Target.targetInfoChanged",
    TargetInfoChangedParams,
    { status: "stable" }
  )
