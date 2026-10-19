/**
 * Locators: values, resolved again on every attempt (a snapshot ref is the one exception: pinned, never
 * rebound). Chained queries are relative. Reads are one-shot; retrying assertions are `Expect`.
 *
 * Actionability is the CONCEPTS.md §8 predicate set, checked in one injected round trip per attempt; the
 * checks are named, adjustable per call and reported in errors. An action needs exactly one match; ambiguity
 * fails at once with candidates and a hint. An action dispatches at most once.
 */
import type { Duration, Effect, Equal, Inspectable, Option, Pipeable, Redacted } from "effect"
import type { AriaRole, CssPixels, FileName, KeyName, LocalPath, MimeType, RemotePath } from "./Brand.ts"
import type { ActionError, EvaluationError, ReadError, TargetGone, Timeout } from "./Errors.ts"
import type { Serialized } from "./Handle.ts"
import type { Snapshot } from "./Snapshot.ts"

export interface RoleOptions {
  /** A string matches as a case-insensitive substring unless `exact: true`; a RegExp is used as given. */
  readonly name?: string | RegExp
  readonly exact?: boolean
  readonly includeHidden?: boolean                      // default false: hidden elements are not matched
}
export interface TextOptions { readonly exact?: boolean }   // as RoleOptions.name

interface Queries<L> {
  getByRole(role: AriaRole, options?: RoleOptions): L
  getByText(text: string | RegExp, options?: TextOptions): L
  getByLabel(text: string | RegExp, options?: TextOptions): L
  getByPlaceholder(text: string | RegExp, options?: TextOptions): L
  getByAltText(text: string | RegExp, options?: TextOptions): L
  getByTitle(text: string | RegExp, options?: TextOptions): L
  getByTestId(id: string): L                            // the data-testid attribute
  locator(css: string): L                               // a bad selector fails at once with InvalidInput
}

export interface ReadonlyLocator extends Queries<ReadonlyLocator>, Pipeable.Pipeable, Equal.Equal, Inspectable.Inspectable {
  frame(iframe: ReadonlyLocator): ReadonlyFrameLocator  // enter an iframe by its element
  filter(options: {
    readonly has?: RelativeLocator; readonly hasNot?: RelativeLocator
    readonly hasText?: string | RegExp; readonly hasNotText?: string | RegExp
    readonly visible?: boolean
  }): ReadonlyLocator
  and(other: ReadonlyLocator): ReadonlyLocator
  or(other: ReadonlyLocator): ReadonlyLocator
  nth(index: number): ReadonlyLocator                   // positional, and says so
  readonly first: ReadonlyLocator                       // pure derivations are plain properties
  readonly last: ReadonlyLocator
  describe(label: string): ReadonlyLocator              // used in errors and traces
  // one-shot reads: no waiting, no retry
  readonly count: Effect.Effect<number, ReadError>
  readonly readText: Effect.Effect<string, ReadError>   // the rendered text (innerText)
  readonly readValue: Effect.Effect<string, ReadError>
  readonly readHtml: Effect.Effect<string, ReadError>   // outerHTML (new in the sketch)
  readAttribute(name: string): Effect.Effect<Option.Option<string>, ReadError>
  readonly isVisible: Effect.Effect<boolean, ReadError>
  readonly isEnabled: Effect.Effect<boolean, ReadError> // (new in the sketch)
  readonly isChecked: Effect.Effect<boolean, ReadError> // (new in the sketch)
  readonly all: Effect.Effect<ReadonlyArray<ReadonlyLocator>, ReadError>   // pinned to the current nth matches
  readonly snapshot: Effect.Effect<Snapshot<ReadonlyLocator>, ReadError>
  /** Isolated world, with the element as the first argument (new in the sketch). Strict: exactly one match. */
  evaluate<Args extends ReadonlyArray<unknown>, B>(
    fn: (element: Element, ...args: Args) => B | Promise<B>, ...args: Args
  ): Effect.Effect<Serialized<B>, EvaluationError | ReadError | TargetGone | Timeout>
}

export interface PointerOptions {
  readonly position?: { readonly x: CssPixels | number; readonly y: CssPixels | number }   // from the padding box; default its centre
  readonly modifiers?: ReadonlyArray<"Alt" | "Control" | "Meta" | "Shift">
  readonly checks?: Partial<Record<"visible" | "enabled" | "notInert" | "inViewport" | "receivesPointer", boolean>>
    & { readonly stable?: boolean | { readonly frames: number } }   // default frames per backend; shown in spans and errors
  readonly trial?: boolean                              // run every check, dispatch nothing
}
export interface ClickOptions extends PointerOptions {
  readonly button?: "left" | "right" | "middle"         // default left
}
export interface DragOptions extends PointerOptions {
  readonly targetPosition?: { readonly x: CssPixels | number; readonly y: CssPixels | number }
  readonly steps?: number                               // default 1
}
export type SelectOption = { readonly value: string } | { readonly label: string } | { readonly index: number }   // which one is always stated

export interface Locator extends ReadonlyLocator {
  // the queries return Locator: an action-capable page's locators can act
  getByRole(role: AriaRole, options?: RoleOptions): Locator
  getByText(text: string | RegExp, options?: TextOptions): Locator
  getByLabel(text: string | RegExp, options?: TextOptions): Locator
  getByPlaceholder(text: string | RegExp, options?: TextOptions): Locator
  getByAltText(text: string | RegExp, options?: TextOptions): Locator
  getByTitle(text: string | RegExp, options?: TextOptions): Locator
  getByTestId(id: string): Locator
  locator(css: string): Locator
  frame(iframe: ReadonlyLocator): FrameLocator
  filter(options: Parameters<ReadonlyLocator["filter"]>[0]): Locator
  and(other: ReadonlyLocator): Locator
  or(other: ReadonlyLocator): Locator
  nth(index: number): Locator
  readonly first: Locator
  readonly last: Locator
  describe(label: string): Locator
  readonly all: Effect.Effect<ReadonlyArray<Locator>, ReadError>
  readonly snapshot: Effect.Effect<Snapshot<Locator>, ReadError>
  // actions: each dispatches at most once
  readonly click: Effect.Effect<void, ActionError | TargetGone | Timeout>
  clickWith(options: ClickOptions): Effect.Effect<void, ActionError | TargetGone | Timeout>
  readonly dblclick: Effect.Effect<void, ActionError | TargetGone | Timeout>
  dblclickWith(options: ClickOptions): Effect.Effect<void, ActionError | TargetGone | Timeout>
  readonly tap: Effect.Effect<void, ActionError | TargetGone | Timeout>          // touch (new in the sketch)
  readonly hover: Effect.Effect<void, ActionError | TargetGone | Timeout>
  hoverWith(options: PointerOptions): Effect.Effect<void, ActionError | TargetGone | Timeout>
  readonly check: Effect.Effect<void, ActionError | TargetGone | Timeout>
  readonly uncheck: Effect.Effect<void, ActionError | TargetGone | Timeout>
  readonly focus: Effect.Effect<void, ActionError | TargetGone | Timeout>
  readonly clear: Effect.Effect<void, ActionError | TargetGone | Timeout>
  readonly scrollIntoView: Effect.Effect<void, ActionError | TargetGone | Timeout>   // (new in the sketch; the toolkit's scroll)
  fill(value: string | Redacted.Redacted<string>): Effect.Effect<void, ActionError | TargetGone | Timeout>
  press(key: KeyName | string, options?: { readonly modifiers?: ReadonlyArray<"Alt" | "Control" | "Meta" | "Shift"> }): Effect.Effect<void, ActionError | TargetGone | Timeout>
  pressSequentially(text: string | Redacted.Redacted<string>, options?: { readonly delay?: Duration.Input }): Effect.Effect<void, ActionError | TargetGone | Timeout>   // delay default 0
  selectOption(options: SelectOption | ReadonlyArray<SelectOption>): Effect.Effect<void, ActionError | TargetGone | Timeout>
  setInputFiles(files: FileInput | ReadonlyArray<FileInput>): Effect.Effect<void, ActionError | TargetGone | Timeout>
  dragTo(target: ReadonlyLocator, options?: DragOptions): Effect.Effect<void, ActionError | TargetGone | Timeout>
}

/** Only valid inside `filter({ has })`, so a page-rooted locator there is a type error. */
export interface RelativeLocator extends Queries<RelativeLocator> { readonly _RelativeLocator: unique symbol }
export declare const RelativeLocator: Queries<RelativeLocator>

/** An iframe's document, entered by its element; lazy like any locator (renamed from ReadonlyFrame in the sketch). */
export interface ReadonlyFrameLocator extends Queries<ReadonlyLocator> {
  readonly owner: ReadonlyLocator                       // the iframe element
  frame(iframe: ReadonlyLocator): ReadonlyFrameLocator
}
export interface FrameLocator extends ReadonlyFrameLocator {
  getByRole(role: AriaRole, options?: RoleOptions): Locator
  getByText(text: string | RegExp, options?: TextOptions): Locator
  getByLabel(text: string | RegExp, options?: TextOptions): Locator
  getByPlaceholder(text: string | RegExp, options?: TextOptions): Locator
  getByAltText(text: string | RegExp, options?: TextOptions): Locator
  getByTitle(text: string | RegExp, options?: TextOptions): Locator
  getByTestId(id: string): Locator
  locator(css: string): Locator
  frame(iframe: ReadonlyLocator): FrameLocator
}

declare const FileInputTypeId: unique symbol
export interface FileInput { readonly [FileInputTypeId]: "FileInput" }
export declare const FileInput: {                       // the brand is required, so paths can't be confused
  local(path: LocalPath | string): FileInput            // read on this machine, uploaded if the browser is remote
  remote(path: RemotePath): FileInput                   // already on the browser's host
  bytes(name: FileName | string, mimeType: MimeType | string, data: Uint8Array): FileInput
}
