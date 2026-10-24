# Design review: interacting and asserting

*2026-10-23. Review of commit `d1d1b4a` (every event module built, and `next` handing out an `Effect`, after reviews 14 and 15) on the rest of what a test does besides clicking: the actions besides `click`, the one-shot reads, the keyboard and the mouse, and the expectations besides visibility, with the L1 mechanisms they share (input state, the guard on the first trusted event, modifiers, and re-checking expectations on change). Prompted by the maintainer choosing batch 1: "Let's do 1". This commit records the review only.*

What is built acts by clicking and asserts by visibility. Everything else a test does (fill a form, press a key, read a value, expect a text) is declared and fails as `NotBuilt`. Three shared mechanisms are also missing, all named in CONCEPTS.md: input state kept per page (§5), the guard that checks the first trusted event lands where the checks said it would (§8, ReceivesPointer), and expectations that re-check when something changes rather than on a timer (§9, Reactivity).

`Locator.snapshot`, `Locator.evaluate`, frames and `Expect.toMatchAria` need snapshots, evaluation and frames, which are batch 3, and stay unbuilt here. So does `FileInput.bytes`.

## What the browsers do

Probed through the three adapters on the pinned builds (a throwaway test, not kept).

| Probe | Chromium 155 | Firefox 158 | WebKit 2359 |
|---|---|---|---|
| **P1.** A click's events | `pointerdown`, `mousedown`, `pointerup`, `mouseup`, `click`, all trusted | the same | the same |
| **P1.** Two clicks, the second with `clickCount: 2` | `dblclick` with `detail: 2` | the same (Firefox counts clicks itself; the adapter sends no count) | the same |
| **P1.** A mouse event's `modifiers` flags | reach the event (`shiftKey`) | ignored by the adapter | ignored by the browser |
| **P1.** Shift held as a key across calls, then a click | `shiftKey` | `shiftKey` | not `shiftKey` |
| **P2.** Keys into an input: a letter, Shift + letter, arrows, Backspace, Tab | as a user's, with `key`, `code`, `keyCode` | the same, except Enter arrives with `code: "NumpadEnter"` (the adapter sends WebDriver's numpad Enter) | the same |
| **P2.** Control + A, then inserted text | replaces the value (Linux) | the same | the same |
| **P3.** Inserted text `héllo €😀` | `beforeinput` and `input`, no key events | typed: key events for each character | like Chromium |
| **P3.** A key with text not on the keyboard (`é`) | typed, `code: ""` | typed | typed |
| **P4.** A page after another page opens in its context | `hidden`, unfocused, no frames rendered; keys and clicks still reach it | `hidden`, about one frame in 150 ms | `visible`, rendering |
| **P10.** The same, with each Chromium page created in its own window (`newWindow`) | `visible`, rendering | — | — |
| **P10.** A page after a page opens in *another* context | `visible`, rendering | `hidden`, throttled | `visible` |
| **P5, P9.** Mouse down, moves and up over a `draggable` element | no drag (Chromium needs `Input.setInterceptDrags`) | `dragstart`, `dragenter`, `dragover`, and no `drop` | no drag; the protocol has no drag commands |
| **P9.** `pointermove` with a button held | `buttons: 0`: the adapter sends no `buttons` | pressed | pressed within one call; the adapter forgets between calls |
| **P6.** Touch start and end, with no touch emulation | `touchstart`, touch pointer events, `click` | the same | the same, with no `click` |
| **P7.** From the utility world: setting a `<select>` and dispatching `input` and `change`; `focus()`; a `MutationObserver` | reach the page (untrusted events); focus moves; mutations seen | the same | the same |
| **P7.** An element returned by value from the utility world, then `setInputFiles` | (a handle is no node; by value it carries its binding, per the conformance suite) | sets the files, `change` fires | the same |
| **P8.** Hover, wheel | `:hover`, `mouseover`; scrolls 400 px | the same | the same |
| The `concurrent` launch profile (P11) | a background page in a context still renders nothing | — | — |

## Candidates

### 1. Input state is L1's, and every gesture carries it

**Where:** CONCEPTS.md §5; `src/internal/input.ts` (new); the adapter contract; the three adapters.

**What changes.**

- **L1 keeps each page's input state:** the keys and buttons held and the pointer's position. Every gesture is built from it, and the adapters keep none of their own. The CDP adapter never sent `buttons`, and WebKit's forgot them between calls, so a drag looked like a hover (P9).
- **`InputEvent`'s `Mouse` gains `buttons`**, the buttons held during the event.
- **Modifiers are keys.** An action or click with `modifiers` presses them before the gesture and releases them after, in the same dispatch, as well as setting the events' flags. Firefox ignores the flags (P1). WebKit's mouse events ignore modifiers either way, which a new capability, `input.pointerModifiers`, says: `unsupported` there, so a pointer action with modifiers fails with `Unsupported` on WebKit.
- **Held input is scoped.** `keyboard.hold` and `mouse.hold` add to the state and release in their scope's finalizer, in reverse order, and later gestures carry what is held. A hold whose release fails is recorded, and the next gesture on the page fails with `BackendFailure` until it is reset, rather than acting with a key that may still be down (CONCEPTS.md §5, Compensation).

**Recommendation.** Adopt.

### 2. Each page is a window of its own on Chromium

**Where:** the CDP adapter (`createPage`); QUIRKS.md.

**What changes.** A page created after another in the same Chromium context puts the first one in the background, where it renders nothing, so every action on it waits for frames that never come (P4). The `concurrent` profile's switches don't change that (P11). Creating each page in its own window (`Target.createTarget{newWindow}`) keeps every page visible and rendering (P10), as pages in different contexts already are, and as WebKit's are. A popup still opens where its opener's script puts it, so Q19 stands.

Firefox throttles a background page to about one frame in 150 ms but keeps rendering (P4): actions there are slower, not stuck. Creating Firefox pages as windows broke the probe's navigation, so it isn't proposed.

**Recommendation.** Adopt.

### 3. Keys are named as UI Events names them, from a table of ours

**Where:** `Keyboard`; `src/internal/keys.ts` (new); the BiDi adapter.

**What changes.**

- **A key** is a UI Events `key` value (`"Enter"`, `"a"`, `"ArrowDown"`, `"Shift"`). A table of ours, for the US layout, gives each its `code`, the text it inserts, and which keys Shift changes. A single character the table lacks, such as `é`, is sent as a key whose text is the character, which every browser types (P3). Anything else is `InvalidInput`, naming the key.
- **Modifiers are an option, never a `+` syntax:** `press("a", { modifiers: ["Control"] })`.
- **`insertText` inserts without key events on CDP and WebKit; BiDi has no command for it,** so the adapter types the characters (P3). A new capability, `input.insertText`, is `partial` on BiDi, saying so.
- **The BiDi adapter sends Enter as Enter,** not the numpad's (P2).

**Recommendation.** Adopt.

### 4. Actions: what each sends, and what each checks

**Where:** `Locator`; `src/internal/locator.ts`; the engine.

**What changes.** Each action is checked as `click` is (rounds in the page at each frame, then the input permit and the checks once more), and then:

- **`dblclick`:** two clicks, the second with `clickCount: 2` (P1).
- **`hover`:** a move to the action point.
- **`tap`:** a touch start and end at the action point, without touch emulation, which no backend needed (P6). WebKit fires no `click` after it, which QUIRKS.md records.
- **`check` and `uncheck`:** nothing at all when the element is already in that state; otherwise a click, then the state read again, which fails with a new reason, `StateUnchanged{expected}`, when the click didn't change it. An element that isn't a checkbox, a radio or an ARIA checkable fails with a new reason, `WrongElement{expected}`.
- **`fill` and `clear`:** the element focused and its contents selected from the utility world, then the value inserted as text (or, for `""`, deleted). An input whose value isn't typed (`date`, `time`, `color`, `range` and their kin) has it set from the utility world, with `input` and `change` dispatched; a value it refuses (`fill("soon")` on a date) fails with `InvalidInput`. Checks: visible, enabled, editable, notInert. A `Redacted` value never reaches a span.
- **`press` and `pressSequentially`:** the element focused, then the keys. Checks: visible, notInert. `delay` waits between keys.
- **`focus`, `scrollIntoView`:** done in the utility world. Checks as declared.
- **`selectOption`:** chosen from the utility world, with `input` and `change` dispatched, as a user's choice would (P7): a `<select>`'s popup isn't something input can drive headless. An option that doesn't exist yet is waited for, `NotReady{NoSuchOption}`, until the deadline. Checks: visible, enabled.
- **`setInputFiles`:** the element returned by value, whose node binding the adapter's `setInputFiles` takes (P7). A local file that doesn't exist fails with `FileUnreadable` before anything is sent; an element that isn't a file input with `WrongElement`.
- **`dragTo`:** a pointer drag from the element's action point to the target's, in `steps` moves, with the button held (candidate 1), which drives libraries that drag with pointer events. An HTML drag (`draggable="true"` on the source or an ancestor) is a capability, `input.dragAndDrop`: the CDP adapter intercepts Chromium's drag (`Input.setInterceptDrags`) and finishes it with drag events, so the same pointer drag drops; BiDi starts it and never drops, and WebKit's protocol has no drag (P5, P9), so there it fails with `Unsupported` before anything is sent.

**Recommendation.** Adopt.

### 5. The first trusted event is guarded

**Where:** CONCEPTS.md §8, ReceivesPointer; the engine; `locator.ts`.

**What changes.** The checks run before the input is sent, and the page can change in between: a toast appears over the button. Under the permit, just before dispatch, the engine arms a guard on the element: capture-phase listeners for the gesture's pointer, mouse, touch and click events. If the first of them lands outside the element, the guard stops it and the rest of the gesture (`preventDefault`, `stopImmediatePropagation`), and the action goes back to checking, with `Covered{by}` and the hint "the element was covered when the input arrived".

Sending again is the exception to "nothing that may have dispatched is repeated" (CONCEPTS.md §9), and is allowed only because the guard proves the page's handlers never saw the gesture. Hover effects and `pointerover` still happen, and the action's span records each guarded attempt.

**Recommendation.** Adopt.

### 6. Reads: one-shot, strict, and the engine's text

**Where:** `Locator`; API.md, Locators; the engine.

**What changes.**

- **Strict and immediate.** A read needs exactly one match. Several fail with `StrictViolation`, as an action does; none fails at once with a new reason, `NoMatch`, since a read never waits. PROTOCOL.md listed this reason as missing since review 12.
- **`readText` is the engine's text,** the whitespace-collapsed text content `getByText` matches, not `innerText` as its declaration said. `innerText` depends on layout and differs between engines (CONCEPTS.md §8), and a locator found by a text should read that text back.
- **The others:**
  - `readValue`, of an input, textarea or select, else `WrongElement`;
  - `readHtml`, its `outerHTML`;
  - `readAttribute`;
  - `isEnabled`, the Enabled predicate;
  - `isChecked`, a checkbox's, a radio's or an ARIA checkable's state, else `WrongElement`.

**Recommendation.** Adopt.

### 7. Expectations wait in the page

**Where:** `Expect`, `Condition`; CONCEPTS.md §9 (Reactivity); API.md, Expectations; the engine.

**What changes.** CONCEPTS.md says an expectation re-checks when the model invalidates something its subject depends on, and review 12 built a 100 ms interval for visibility as a stopgap. For a locator's expectation the change happens in the page, so the page is where to wait for it.

- **One round is one engine request.** It checks the condition, and if it doesn't hold, waits in the page for a change: a mutation (`MutationObserver` on the document: children, attributes, text), an `input` or `change` event (a value isn't a mutation), or, for a condition that depends on layout (visible, hidden, editable), the next animation frame. It checks again on each, and answers when the condition holds or after a second, like an action's round. L1 sends rounds until the deadline.
- **No polling cadence,** and no change missed between checks. A condition that changes without a mutation, an input event or a frame (a hidden page whose script changes nothing) is checked again at the next round.
- **Built matchers:** `toBeVisible` and `toBeHidden` (moved onto rounds), `toBeEnabled`, `toBeDisabled`, `toBeChecked`, `toBeFocused` (the deep active element), `toBeEditable`, `toHaveText` (a string matches the whole engine text exactly; a `RegExp` is tested; a list matches each match in order, and their count), `toContainText`, `toHaveValue`, `toHaveAttribute`, `toHaveCount` and `toHaveTitle`.
- **Expectations outside the page:**
  - `toHaveURL` waits on `page.url`, a `Watchable`, so on its changes;
  - `Expect.that` waits on a `Watchable`'s changes, and runs any other effect again at `Expect.CheckInterval`, which keeps its 100 ms default and now applies only there.
- **`Condition`** is built: `make`, `not`, `and`, `because`.
- **Failure** is `ExpectationFailed` as declared. `checks.triggeredBy` now says `change` for rounds that re-checked in the page. `nearest` and `suggestions` stay empty until snapshots are built.

**Recommendation.** Adopt.

### 8. The keyboard and the mouse

**Where:** `Keyboard`, `Mouse`; `page.keyboard`, `page.mouse`.

**What changes.**

- **`keyboard.press`, `pressSequentially`, `insertText` and `hold`** go to whatever has focus, under the page's input permit.
- **`mouse.move`** goes from the current position in `steps` moves.
- **`mouse.click`** takes `clickCount` and `modifiers` and checks nothing, since there is no element.
- **`mouse.hold`** keeps the button down; moves while it is held carry it.
- **`mouse.wheel`** scrolls at the pointer.
- **`mouse.position`** reads L1's state.
- **Errors.** An unknown key is `KeyboardError{InvalidInput}`, and a modifier on WebKit's pointer is `MouseError{Unsupported}`.

**Recommendation.** Adopt.

### 9. Tests, on every backend

**Where:** `test/integration/slice/`; the conformance suite.

**What changes.** A fourth slice suite, through the public layers:

- call site 1 up to its storage state: fill, click, and `toBeVisible`;
- a form: `fill` with a `Redacted` password, `clear`, `press`, `pressSequentially` with a delay, `selectOption`, `check` and `uncheck`, and `setInputFiles`;
- the pointer:
  - `dblclick`, `hover` and `tap`;
  - `dragTo` with pointer events, and HTML drag where supported, `Unsupported` elsewhere;
  - modifiers, and `Unsupported` on WebKit;
- the guard: an overlay that appears between the checks and the input, and the action retried;
- held keys and buttons released when their scope closes, including on failure;
- every read, with `NoMatch`, `StrictViolation` and `WrongElement`;
- every matcher passing after a delayed change, and failing with its history;
- `toHaveURL` across a navigation;
- `Expect.that` on a `Watchable` and on a plain effect;
- two pages of one Chromium context, acting on the first after the second opens.

The conformance suite checks `buttons` held across a drag and Enter on BiDi.

**Recommendation.** Adopt.

## Considered and not adopted

- **The `concurrent` profile as the answer to background pages.** It doesn't make a background Chromium page render (P11).
- **Activating a page before every action on it.** It changes what the page observes (focus, visibility) without the caller asking (rule 23); a window per page doesn't.
- **Firefox pages as windows.** Navigation broke in the probe; Firefox's background pages render, slowly.
- **Retrying an action after a guarded gesture without proof.** The guard is what makes sending again safe; without it, nothing is sent twice.
- **Selecting all with Control + A in `fill`.** It is Meta + A on macOS, and a page can rebind it; selecting from the utility world is the same everywhere.
- **`innerText` for `readText` and `toHaveText`.** A locator found by text would read back different text.
- **A key syntax such as `"Control+A"`.** Modifiers are an option, stated.
- **`toMatchAria`, `Locator.snapshot` and `Locator.evaluate`.** They need snapshots and evaluation, batch 3.

## Decision

Adopted, 2026-10-23, under the maintainer's direction to build batch 1. The revision follows this commit, and the build records where it differs.
