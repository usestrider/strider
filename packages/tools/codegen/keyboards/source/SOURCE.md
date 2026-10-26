# Vendored: Unicode CLDR keyboard data

Six Windows keyboard layouts from Unicode CLDR's `keyboards/windows/`, unchanged, under the Unicode license
(`LICENSE` here, CLDR's `unicode-license.txt`).

- **Release:** CLDR `release-43`, the last release with the per-platform layouts: release 44 replaced them with
  Keyboard 3.0 data, which has only `fr` of these.
- **Fetched:** 2026-10-26, from `https://raw.githubusercontent.com/unicode-org/cldr/release-43/`.
- **Layouts:** `en-t-k0-windows` (Strider's `us`), `en-GB-t-k0-windows` (`uk`), `de-t-k0-windows` (`de`),
  `fr-t-k0-windows` (`fr`), `es-t-k0-windows` (`es`), `it-t-k0-windows` (`it`).
- **SHA-256:**
  - `de-t-k0-windows.xml`: `37568b0cd7984fc8181724da89b850f43514240767bde8d8cb647db2ff5a2607`
  - `en-GB-t-k0-windows.xml`: `31dc99b45aae6ad5c648034b3842b1302e3c3ec840c6eef2ac50be29882aed40`
  - `en-t-k0-windows.xml`: `3a5b8bb3931a5672cec7b271be1746de27de9e3c6c6677158859f114ce557a0b`
  - `es-t-k0-windows.xml`: `af5a172b94686ecc9a912f89fe879206dcd0d3db337e0ac591747d00bbb2b997`
  - `fr-t-k0-windows.xml`: `96c8b474463fa9bdc6042650f33c7f52b9b8222a85c0815301d07fbfca8552fa`
  - `it-t-k0-windows.xml`: `231192550555787965d5ed02896ac2c098748c368d7b98fce01a260dbea04696`
  - `LICENSE`: `830ec6dd25a943b70a31d74caa56b08b34c35f5c9679fba664c1658712849271`

`strider-codegen keyboards` reads them and writes `packages/browser/src/internal/keyboardLayouts.ts`: for each
layout, the key and modifiers that type each character (the base, Shift, AltGr and AltGr with Shift maps), its
dead keys, and the characters a dead key composes. The Caps Lock and Control maps aren't read.
