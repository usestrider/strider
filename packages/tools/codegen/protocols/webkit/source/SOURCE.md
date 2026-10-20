# Vendored: the WebKit inspector protocol, as Playwright patches it

`protocol.json` is the inspector protocol of Playwright's WebKit build: WebKit's own domains, plus the ones
Playwright's patches add (`Playwright`, `Browser`, `Dialog`, `Emulation`, `Input`, `Screencast`) and the commands they
add to WebKit's (`Page.setBootstrapScript`, `Network.addInterception`, `DOM.setInputFiles`, …). WebKit's domains are
under WebKit's BSD-style license, copyright Apple Inc. and others; Playwright's additions are under the Apache License
2.0, copyright Microsoft Corporation.

- **Revision:** Playwright's WebKit build 2359 (WebKit 26.6), the build Playwright 1.63.0 uses, as nixpkgs packages it
  (`playwright-driver.browsers`). The file is copied unchanged from the build's directory.
- **Fetched:** 2026-10-20.
- **SHA-256:** `protocol.json`: `5962bc790bde7750ce127029962a6c1bd93aed884cbcf832da8393c2a12c106c`

The format is CDP's JSON with a few more keys per domain (`availability`, `targetTypes`, `debuggableTypes`,
`condition`), which say where a domain lives: `availability: ["web"]` marks Playwright's UI-process domains, reached on
the browser or a page proxy; `targetTypes` marks domains inside an inspector target. About a quarter of Playwright's
WebKit rolls change this file, so the WebKit backend is pinned to its build: a launch of another build compares the
file it ships with this one (PROTOCOL.md, Drift test).
