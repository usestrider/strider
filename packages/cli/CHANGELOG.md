# @usestrider/cli

## 0.2.1

### Patch Changes

- b4bcf73: Expose roleless password inputs in snapshots as inferred editable controls with password evidence, preserving accessible names and excluding values, including values referenced by another element for its name. Find matches the password designation using its usual case and exact rules. Export named password refs by waiting for their exact computed name in snapshots, preserving naming precedence, supporting a single framed match and leaving duplicate names ambiguous. Unnamed refs retain the password input selector.
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

## 0.2.0

### Minor Changes

- 2cf324b: Enable Chromium's CDPScreenshotNewSurface in the default automation and concurrent launch profiles, changing the capture rendering path for headed and headless launches. Captures can drive rendering observable to the page; no capture non-observability guarantee applies. This changes the previous unstable default/contract, including CLI launches.
  
  Stock, attached browsers and independently constructed custom profiles are unchanged. Caller switches remain verbatim: a later --enable-features list replaces the preset list, so include CDPScreenshotNewSurface in it to retain the new path. Chromium also replaces repeated --disable-features lists. To opt out while preserving the preset's five existing disabled features, supply --disable-features=Translate,MediaRouter,DialMediaRouteProvider,OptimizationHints,AutofillServerCommunication,CDPScreenshotNewSurface as one combined list. Strider does not merge feature lists. Validated on Chromium 155.0.8059.79; other Chrome and Edge versions remain unverified.
- dabf930: Make strict CLI and MCP find search only redacted snapshot content, preserving label searches and role filters.
  Mask semantic and plaintext-only editable content and all page-supplied exception details under strict capture,
  retaining exception occurrence time. Mask field content copied into other nodes' accessible or inferred names, following native/ARIA field ancestry
  through shadow hosts and assigned slots while preserving explicit public labels. Mixed names are masked whole;
  native select and ARIA listbox option text is masked with the field subtree.
  Add optional snapshot editability and name provenance;
  older snapshot data remains decodable. Local capture keeps its existing content and search behavior.
  
  Strict capture remains bounded: assertions such as `expect --text` and action selectors still operate on original
  page content and can confirm guesses at masked values.
  
  Collect field editability and field-content name provenance only for redacted capture, including custom masking policies. Ordinary library and local snapshots omit this masking metadata and skip its collection.

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

## 0.1.3

### Patch Changes

- Updated dependencies [2d18ff6]
- Updated dependencies [eced824]
- Updated dependencies [24a7c81]
- Updated dependencies [1c51f9c]
- Updated dependencies [1ffff69]
  - @usestrider/browser@0.2.0

## 0.1.2

### Patch Changes

- 9bf0ba8: Add `strider agent instructions` to print a versioned CLI usage guide for agent context, with `--skill` to emit the same guide as a skill.
- Updated dependencies [9bf0ba8]
- Updated dependencies [c256b0f]
  - @usestrider/browser@0.1.2

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
