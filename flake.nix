{
  description = "Strider: the toolchain, and the browsers the integration tests are pinned to";

  # The revision the integration tests' browsers come from: Chromium 155.0.8059.79, Firefox 158.0 and
  # Playwright 1.63.0's WebKit build 2359, with Node 24.21.0 and pnpm 12.9.0. The tests' traffic fixtures and
  # the error tables' evidence were recorded from these builds.
  inputs.nixpkgs.url = "github:NixOS/nixpkgs/319e4cebef10cbb636c6ea392137b52ad105336a";

  outputs =
    { self, nixpkgs }:
    let
      inherit (nixpkgs) lib;
      # The pins the tests check too; see the file's comment for what moving one takes
      pins = lib.importJSON ./packages/browser/test/integration/browsers.json;
      packageManager = (lib.importJSON ./package.json).packageManager;
      # Chromium in nixpkgs, and Playwright's WebKit, are built for Linux only
      systems = [
        "x86_64-linux"
        "aarch64-linux"
      ];
      forAllSystems = f: lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});

      pinned =
        name: found: expected:
        if found == expected then
          true
        else
          throw "nixpkgs provides ${name} ${found}, but the integration tests are pinned to ${expected} (packages/browser/test/integration/browsers.json). Lock nixpkgs back, or move the pin and record the fixtures again.";

      browsers =
        pkgs:
        assert pinned "Chromium" pkgs.chromium.version pins.chromium.version;
        assert pinned "Firefox" pkgs.firefox.version pins.firefox.version;
        assert pinned "Playwright's WebKit build" pkgs.playwright-driver.browsersJSON.webkit.revision pins.webkit.revision;
        {
          chromium = pkgs.chromium;
          firefox = pkgs.firefox;
          webkit = pkgs.playwright-driver.components.webkit;
        };
    in
    {
      packages = forAllSystems browsers;

      devShells = forAllSystems (
        pkgs:
        let
          pinnedBrowsers = browsers pkgs;
        in
        assert pinned "pnpm" "pnpm@${pkgs.pnpm.version}" packageManager;
        {
          default = pkgs.mkShellNoCC {
            packages = [
              pkgs.nodejs_24
              pkgs.pnpm
            ];
            # What the integration tests run against; nothing else is looked up
            STRIDER_CHROMIUM = lib.getExe pinnedBrowsers.chromium;
            STRIDER_FIREFOX = lib.getExe pinnedBrowsers.firefox;
            STRIDER_WEBKIT = "${pinnedBrowsers.webkit}/pw_run.sh";
          };
        }
      );
    };
}
