# Vendored: the WebKit inspector protocol, as WebKit ships it

The 28 domain files of `Source/JavaScriptCore/inspector/protocol/` in WebKitGTK 2.54.1's source release, unchanged:
the inspector protocol of stock WebKit, which WebKitGTK's and WPE's remote inspector speak, without the domains and
commands Playwright's patched build adds, which the WebKit backend drove until review 23.

- **Release:** `webkitgtk-2.54.1.tar.xz`, as nixpkgs packages it (`webkitgtk_6_0.src`), the WebKitGTK the integration
  tests run.
- **Fetched:** 2026-10-26.
- **SHA-256** of the files' own SHA-256 lines, `sha256sum *.json | sha256sum`:
  `f993e9fcc9c76ebdd600e95d7c7fe8296da7c29441ea369c17e35a2bf9f5ea92`.
- **License.** The protocol files carry no header. The inspector code around them is under Apple's BSD-style license
  (`LICENSE`, from `inspector/scripts/codegen/generator.py`), and JavaScriptCore as a whole is also distributed under
  the GNU LGPL 2 (`COPYING.LIB`).

Each file is one domain in CDP's JSON format with WebKit's keys (`debuggableTypes`, `targetTypes`, `condition`).
Unlike Playwright's build, stock WebKit has no `Playwright`, `Input`, `Dialog`, `Emulation` or `Screencast` domain, no
`Page.navigate` or `Page.createUserWorld`, and no frame attachment, same-document navigation or file chooser events.
