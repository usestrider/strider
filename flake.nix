{
  description = "Strider: the toolchain, and the machine the browser integration tests run on";

  # The revision the integration tests' browsers come from: Chromium 155.0.8059.79, Firefox 158.0 and WebKitGTK
  # 2.54.1, with Node 24.21.0 and pnpm 12.9.0. The tests' traffic fixtures and the error tables' evidence were
  # recorded from these builds.
  inputs.nixpkgs.url = "github:NixOS/nixpkgs/319e4cebef10cbb636c6ea392137b52ad105336a";

  outputs =
    { self, nixpkgs }:
    let
      inherit (nixpkgs) lib;
      # The pins the tests check too; see the file's comment for what moving one takes
      pins = lib.importJSON ./packages/browser/test/integration/browsers.json;
      packageManager = (lib.importJSON ./package.json).packageManager;
      # Chromium in nixpkgs, and WebKitGTK's automation mode, are Linux's
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
        assert pinned "WebKitGTK" pkgs.webkitgtk_6_0.version pins.webkitgtk.version;
        {
          chromium = pkgs.chromium;
          firefox = pkgs.firefox;
          # Stock WebKit: its MiniBrowser, launched in automation mode or attached, which has no headless mode
          webkitgtk = pkgs.webkitgtk_6_0;
          # playwright-core 1.64.1's Firefox 157.0, revision 1555. Stock Firefox cannot speak Juggler.
          # Pin the downloaded tree as well as its revision; reuse nixpkgs' ELF patching dependencies.
          scenario-firefox = pkgs.stdenv.mkDerivation {
            name = "scenario-playwright-firefox-157.0-1555";
            src = pkgs.fetchzip {
              url = "https://cdn.playwright.dev/dbazure/download/playwright/builds/firefox/1555/firefox-debian-12.zip";
              hash = "sha256-PCLfh8+Gm8NFq/6ysLwFaDI+yDK2AaZ6BCTPcWmL6Rg=";
            };
            inherit (pkgs.firefox-bin.unwrapped)
              nativeBuildInputs buildInputs runtimeDependencies appendRunpaths patchelfFlags;
            buildPhase = ''
              mkdir -p $out/firefox
              cp -R . $out/firefox
            '';
            meta.platforms = [ "x86_64-linux" ];
          };
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
            pkgs.git # Real repositories for state-save warning tests
          ];
        in
        assert pinned "pnpm" "pnpm@${pkgs.pnpm.version}" packageManager;
        {
          # The toolchain, for the standard checks, which run anywhere, and sops, which the docs' deploy decrypts its
          # readers with
          default = pkgs.mkShellNoCC { packages = toolchain ++ [ pkgs.sops pkgs.bun ]; };

          # The machine the browser integration tests see, the same wherever they run. `pnpm test:integration`
          # enters it with `--ignore-environment`, so nothing else of the host's reaches them: no display, no
          # user configuration, no variables but these.
          integration = pkgs.mkShellNoCC {
            # ffmpeg for Chromium video recordings
            packages = toolchain ++ [ pkgs.ffmpeg-headless ];
            # What the tests check that they run in
            STRIDER_ENVIRONMENT = "nix-integration";
            # The browsers, and nothing else looked up
            STRIDER_CHROMIUM = lib.getExe pinnedBrowsers.chromium;
            STRIDER_FFMPEG = lib.getExe pkgs.ffmpeg-headless;
            STRIDER_FFPROBE = lib.getExe' pkgs.ffmpeg-headless "ffprobe";
            STRIDER_FIREFOX = lib.getExe pinnedBrowsers.firefox;
            STRIDER_WEBKITGTK = "${pinnedBrowsers.webkitgtk}/libexec/webkitgtk-6.0/MiniBrowser";
            # The MiniBrowser isn't wrapped: GIO finds a TLS backend only where this says, or HTTPS fails with
            # "TLS support is not available" (QUIRKS.md, Q237)
            GIO_EXTRA_MODULES = "${pkgs.glib-networking}/lib/gio/modules";
            # No sound card: an ALSA configuration that defines no device, so the browsers reach no audio server
            # of the host's, as on a machine without one. Through the host's, Firefox's screencasts hung the
            # browser (QUIRKS.md, Q236)
            ALSA_CONFIG_PATH = "${pkgs.writeText "strider-no-sound-card.conf" ""}";
            # A display of its own for the MiniBrowser, which a test starts on a free display number
            STRIDER_XVFB = lib.getExe' pkgs.xvfb "Xvfb";
            # A self-signed certificate for the TLS fixture, made as a test starts
            STRIDER_OPENSSL = lib.getExe pkgs.openssl;
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
              # No core dumps: a renderer that crashes, as a test crashes one, would otherwise hang while the host
              # writes its core, about 35 s on two cores, and only then would the browser say the page crashed
              ulimit -c 0
            '';
          };
        }
      );
    };
}
