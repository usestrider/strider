{
  description = "Strider: the toolchain, and the machine the browser integration tests run on";

  # The revision the integration tests' browsers come from: Chromium 155.0.8059.79, Firefox 158.0,
  # Playwright 1.63.0's WebKit build 2359 and WebKitGTK 2.54.1, with Node 24.21.0 and pnpm 12.9.0. The tests'
  # traffic fixtures and the error tables' evidence were recorded from these builds.
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
        assert pinned "WebKitGTK" pkgs.webkitgtk_6_0.version pins.webkitgtk.version;
        {
          chromium = pkgs.chromium;
          firefox = pkgs.firefox;
          webkit = pkgs.playwright-driver.components.webkit;
          # Stock WebKit, attached through its remote inspector: its MiniBrowser, which has no headless mode
          webkitgtk = pkgs.webkitgtk_6_0;
        };
    in
    {
      packages = forAllSystems browsers;

      devShells = forAllSystems (
        pkgs:
        let
          pinnedBrowsers = browsers pkgs;
          toolchain = [
            pkgs.nodejs_24
            pkgs.pnpm
          ];
        in
        assert pinned "pnpm" "pnpm@${pkgs.pnpm.version}" packageManager;
        {
          # The toolchain, for the standard checks, which run anywhere
          default = pkgs.mkShellNoCC { packages = toolchain; };

          # The machine the browser integration tests see, the same wherever they run. `pnpm test:integration`
          # enters it with `--ignore-environment`, so nothing else of the host's reaches them: no display, no
          # user configuration, no variables but these.
          integration = pkgs.mkShellNoCC {
            packages = toolchain;
            # What the tests check that they run in
            STRIDER_ENVIRONMENT = "nix-integration";
            # The browsers, and nothing else looked up
            STRIDER_CHROMIUM = lib.getExe pinnedBrowsers.chromium;
            STRIDER_FIREFOX = lib.getExe pinnedBrowsers.firefox;
            STRIDER_WEBKIT = "${pinnedBrowsers.webkit}/pw_run.sh";
            STRIDER_WEBKITGTK = "${pinnedBrowsers.webkitgtk}/libexec/webkitgtk-6.0/MiniBrowser";
            # A display of its own for the MiniBrowser, which a test starts on a free display number
            STRIDER_XVFB = lib.getExe' pkgs.xvfb "Xvfb";
            # Fonts, time zone and locale, which pages measure text and format dates and numbers with
            FONTCONFIG_FILE = pkgs.makeFontsConf {
              fontDirectories = [
                pkgs.dejavu_fonts
                pkgs.liberation_ttf
              ];
            };
            LANG = "C.UTF-8";
            LC_ALL = "C.UTF-8";
            shellHook = ''
              # nix develop doesn't pass a shell's TZ through, so it is set here
              export TZ=UTC
              # An empty home of its own, deleted on exit, so no profile or cache of the user's is read
              export HOME="$(mktemp -d -t strider-home-XXXXXX)"
              trap 'rm -rf "$HOME"' EXIT
            '';
          };
        }
      );
    };
}
