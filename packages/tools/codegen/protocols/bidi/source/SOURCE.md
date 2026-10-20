# Vendored: WebDriver BiDi

`remote.cddl` (what a client sends) and `local.cddl` (what a browser sends) are the CDDL of the WebDriver BiDi
editor's draft, extracted from its source, under the W3C Software and Document License
(<https://www.w3.org/copyright/software-license-2023/>), copyright © W3C.

- **Revision:** `w3c/webdriver-bidi` at `f922e6af669ead51496db85f37813f39438ef171` (2026-10-08, "fix: update is to
  string/is to avoid build warnings (#1175)").
- **Fetched:** 2026-10-20.
- **Extraction:** every `<pre class="cddl" data-cddl-module="…">` block of `index.bs`, HTML-unescaped and dedented,
  joined per module (`local-cddl`, `remote-cddl`) in document order, as the spec's own `scripts/cddl/generate.js`
  does. Two differences: HTML comments inside the blocks are removed, and runs of blank lines are collapsed.
- **SHA-256:**
  - `local.cddl`: `2b38dfc3750782a095affc05258fd8f04b28a64e267c3e356f39a5a0b8616324`
  - `remote.cddl`: `8a9d345b44cca814728cd894e5fbd9967283bea765de11b1619219660292bf4f`

Each command's result is the rule named after it with `Result` appended (`browsingContext.Activate` returns
`browsingContext.ActivateResult`), which is how every command section of the spec pairs its Command Type with its
Return Type. A roll replaces both files and this note, then regenerates the model; the model's diff names what
changed.
