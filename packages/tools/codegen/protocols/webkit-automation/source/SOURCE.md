# Vendored: WebKit's Automation protocol

`Automation.json`, from `Source/WebKit/UIProcess/Automation/` in WebKitGTK 2.54.1's source release, unchanged: the
protocol of a browser's automation session, which WebKit's WebDriver servers (`WebKitWebDriver`, `safaridriver`) and
Strider speak to a browser in automation mode, over its remote inspector server.

- **Release:** `webkitgtk-2.54.1.tar.xz`, as nixpkgs packages it (`webkitgtk_6_0.src`), the WebKitGTK the integration
  tests run.
- **Fetched:** 2026-10-26.
- **SHA-256:** `Automation.json`: `d7f52a48820139e74b9bb543220e77af86a1447c610919698e8141342fb7b6e4`
- **License.** The file carries no header. Debian's per-file audit of WebKitGTK lists it among no exceptions, so it is
  under WebKit's default, BSD-2-clause; `LICENSE` is the notice of the Automation code beside it
  (`WebAutomationSession.cpp`), copyright Apple Inc.

It is one domain in CDP's JSON format with WebKit's keys (`condition`, `platform`, `async`), read as
`protocols/webkit-stock/source/`'s are. Items under `condition` are compiled only into some builds: WebDriver BiDi's
are compiled out of WebKitGTK's releases, and the inspector tunnel answers only a client that allows inspector testing.
