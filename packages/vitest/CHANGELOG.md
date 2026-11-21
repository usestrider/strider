# @usestrider/vitest

## 0.2.9

### Added

- **`SnapshotBaseline.toMatch`** (#407) compares bytes a test already has, such as `page.pdf()`'s output, with a baseline file named with its own extension (`"invoice.pdf"`). A `.png` name is compared by pixels, with `ScreenshotBaseline.toMatch`'s `threshold`, `maxDiffPixels`, and `maxDiffPixelRatio`; any other extension, JPEG included, is compared byte for byte. Baselines live at `__baselines__/<test file>/` beside the test file, apart from Vitest's own snapshots, and follow the same update modes as screenshots: a local run writes a missing baseline and still fails, `vitest -u` rewrites differing ones, and CI writes none. Text keeps Vitest's `toMatchFileSnapshot`.

### Patch Changes

- Uses `@usestrider/browser` 0.14.1.

## 0.2.8

### Added

- **`ScreenshotBaseline.toMatch`** (#399) compares a page's screenshot, or one element's through `area: { element }`, with a PNG baseline kept per test file, name, browser engine, and platform. It captures until a capture matches or two in a row agree, ignores anti-aliasing, and takes `threshold`, `maxDiffPixels`, and `maxDiffPixelRatio`. Baselines follow Vitest's snapshot update state: a local run writes a missing baseline and still fails, `vitest -u` rewrites differing ones, and CI writes none. A mismatch writes and attaches the actual, expected, and diff images. A baseline's name is lower-case letters, digits, `.`, `_`, and `-`, and any other fails with `InvalidName` before a capture. `CurrentSettings` overrides the update mode and the paths.

### Patch Changes

- Uses `@usestrider/browser` 0.14.0.

## 0.2.7

### Patch Changes

- Uses `@usestrider/browser` 0.13.0.

## 0.2.6

### Patch Changes

- Uses `@usestrider/browser` 0.12.0.

## 0.2.5

### Patch Changes

- Uses `@usestrider/browser` 0.11.0.

## 0.2.4

### Patch Changes

- Uses `@usestrider/browser` 0.10.0.

## 0.2.3

### Patch Changes

- Uses `@usestrider/browser` 0.9.0.

## 0.2.2

### Changed

- Documentation comments and messages use the serial comma (#277).
- Updated dependencies: `@usestrider/browser@0.8.3`.

## 0.2.1

### Patch Changes

- Uses `@usestrider/browser` 0.8.0, whose `TestRun.attach` takes `{ trace }`, `{ har }` or `{ screenshot }` (#210). Reporters see the same artifact kinds as before.

## 0.2.0

### Breaking changes

- **Requires Effect 4.1.2** (#188): `effect` and `@effect/platform-node` `^4.1.2`.

### Patch Changes

- Uses `@usestrider/browser` 0.7.0.

## 0.1.6

### Patch Changes

- Uses `@usestrider/browser` 0.6.0.

## 0.1.5

### Patch Changes

- **Failure traces for every test, configured once** (#147): `VitestBrowser.layer(backend, { trace: { directory } })` records each bound test, attaches its trace when it fails and discards it when it passes, with per-action screenshots, DOM snapshots and network by default.
- **`VitestBrowser.withTest(context)`** (#139) ties a test's identity, retry and attachments to its own callback, so concurrent tests don't pick up each other's.
- **`VitestBrowser.traceFileName(info)`** (#138) gives safe, deterministic trace filenames, distinct per test, retry and repeat.
- Uses `@usestrider/browser` 0.5.0.

## 0.1.4

### Patch Changes

- Updated dependencies [72af3f6]
- Updated dependencies [80fd57e]
- Updated dependencies [38678ab]
- Updated dependencies [34171bc]
- Updated dependencies [eb9da18]
- Updated dependencies [c61613b]
- Updated dependencies [4cfc183]
- Updated dependencies [cbfa7f1]
- Updated dependencies [b4bcf73]
- Updated dependencies [a6c3c98]
- Updated dependencies [b282791]
- Updated dependencies [f12f85c]
- Updated dependencies [db5244d]
- Updated dependencies [99745b7]
- Updated dependencies [19dad83]
- Updated dependencies [0422966]
- Updated dependencies [21d6bcb]
- Updated dependencies [ca2eaf1]
- Updated dependencies [8196abe]
- Updated dependencies [992aee8]
  - @usestrider/browser@0.4.0

## 0.1.3

### Patch Changes

- Updated dependencies [b3a5611]
- Updated dependencies [2cf324b]
- Updated dependencies [8ec884f]
- Updated dependencies [fe41db7]
- Updated dependencies [f57de19]
- Updated dependencies [3b7dad7]
- Updated dependencies [b65bc7b]
- Updated dependencies [9728fec]
- Updated dependencies [b0c0931]
- Updated dependencies [dabf930]
- Updated dependencies [8d1ea51]
- Updated dependencies [ddf9e32]
- Updated dependencies [8d10bf7]
  - @usestrider/browser@0.3.0

## 0.1.2

### Patch Changes

- Updated dependencies [2d18ff6]
- Updated dependencies [eced824]
- Updated dependencies [24a7c81]
- Updated dependencies [1c51f9c]
- Updated dependencies [1ffff69]
  - @usestrider/browser@0.2.0

## 0.1.1

### Patch Changes

- fa12edd: Publish the current build. 0.1.0's `dist` was out of date against its `src`: among other things it lacked the `Operation` module and the `experimental` entry point, so use this version instead.
- Updated dependencies [fa12edd]
  - @usestrider/browser@0.1.1

## 0.1.0

### Minor Changes

- b24968b: Initial release.

### Patch Changes

- Updated dependencies [b24968b]
  - @usestrider/browser@0.1.0
