/**
 * The integration tests' setup: they run only in the Nix environment (`flake.nix`, `devShells.integration`),
 * which fixes what the browsers see: the pinned builds, the fonts, the time zone and locale, an empty home and no
 * display. `pnpm test:integration` enters it; anywhere else, every integration test fails with this error rather
 * than running against whatever the machine has.
 */
if (process.env["STRIDER_ENVIRONMENT"] !== "nix-integration") {
  throw new Error(
    "The browser integration tests run in the Nix environment that fixes the machine they see: run `pnpm test:integration`"
  )
}
