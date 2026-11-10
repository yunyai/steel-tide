{
  description = "Steel Tide: a 3D naval battle game (Vite + three.js)";

  # nixos-unstable ships playwright-driver at the same version as the npm `playwright`
  # in package.json; keep the two in step so the Nix browsers match the npm client.
  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs =
    { self, nixpkgs }:
    let
      inherit (nixpkgs) lib;
      systems = [
        "x86_64-linux"
        "aarch64-linux"
        "x86_64-darwin"
        "aarch64-darwin"
      ];
      forAllSystems = f: lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});

      # Bump this whenever package-lock.json changes (nix build prints the new value).
      npmDepsHash = "sha256-l6k8LhDolUEJxq1xP9Id3CFv0iqaa9xHB7NqK9vh3Bc=";

      src = lib.fileset.toSource {
        root = ./.;
        fileset = lib.fileset.unions [
          ./package.json
          ./package-lock.json
          ./tsconfig.json
          ./tsconfig.node.json
          ./vite.config.ts
          ./index.html
          ./src
          ./server
          ./scripts
          ./public
        ];
      };

      mkSteelTide =
        pkgs: args:
        pkgs.buildNpmPackage (
          {
            pname = "steel-tide";
            version = (lib.importJSON ./package.json).version;
            inherit src npmDepsHash;
            nodejs = pkgs.nodejs_22;
            env.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD = "1";
          }
          // args
        );
    in
    {
      packages = forAllSystems (
        pkgs:
        let
          mkSite =
            script:
            mkSteelTide pkgs {
              npmBuildScript = script;
              installPhase = ''
                runHook preInstall
                cp -r dist $out
                runHook postInstall
              '';
            };
        in
        rec {
          default = mkSite "build";
          site = default;
          pages = mkSite "build:pages";

          # The built game plus the Vite preview server that hosts the LAN lobby (`npm run lan`).
          lan = mkSteelTide pkgs {
            pname = "steel-tide-lan";
            dontNpmPrune = true;
            nativeBuildInputs = [ pkgs.makeWrapper ];
            installPhase = ''
              runHook preInstall
              share=$out/share/steel-tide
              mkdir -p $share $out/bin
              # server/lan.ts imports the shared net and sim code from src/.
              cp -r dist node_modules server src package.json tsconfig.json tsconfig.node.json vite.config.ts $share/
              makeWrapper ${lib.getExe pkgs.nodejs_22} $out/bin/steel-tide-lan \
                --chdir $share \
                --add-flags "$share/node_modules/vite/bin/vite.js preview --configLoader runner --host 0.0.0.0 --port 4173"
              runHook postInstall
            '';
            meta.mainProgram = "steel-tide-lan";
          };
        }
      );

      apps = forAllSystems (pkgs: rec {
        lan = {
          type = "app";
          program = lib.getExe self.packages.${pkgs.stdenv.hostPlatform.system}.lan;
          meta.description = "Serve the built game and LAN lobby on port 4173";
        };
        default = lan;
      });

      checks = forAllSystems (
        pkgs:
        let
          packages = self.packages.${pkgs.stdenv.hostPlatform.system};
        in
        {
          build = packages.default;
          pages = packages.pages;
          typecheck = mkSteelTide pkgs {
            pname = "steel-tide-typecheck";
            npmBuildScript = "typecheck";
            installPhase = "touch $out";
          };
        }
      );

      devShells = forAllSystems (
        pkgs:
        let
          playwright = pkgs.playwright-driver;
          linux = pkgs.stdenv.hostPlatform.isLinux;
        in
        {
          default = pkgs.mkShell {
            packages = [
              pkgs.nodejs_22
              pkgs.python3 # scripts/package*Audio.py
              pkgs.ffmpeg-headless
            ];

            env = lib.optionalAttrs linux {
              PLAYWRIGHT_BROWSERS_PATH = "${playwright.browsers.override {
                withFirefox = false;
                withWebkit = false;
              }}";
              PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD = "1";
              PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS = "true";
              # Scripts that read PLAYWRIGHT_CHANNEL use the Nix Chromium instead of Google Chrome.
              PLAYWRIGHT_CHANNEL = "chromium";
            };

            shellHook = ''
              if [ ! -d node_modules ]; then
                echo "steel-tide: node_modules is missing, run 'npm ci'" >&2
              fi
            ''
            + lib.optionalString linux ''
              if [ -f node_modules/playwright/package.json ]; then
                npm_playwright=$(node -p 'require("./node_modules/playwright/package.json").version')
                if [ "$npm_playwright" != "${playwright.version}" ]; then
                  echo "steel-tide: npm playwright $npm_playwright differs from Nix browsers ${playwright.version}" >&2
                fi
                unset npm_playwright
              fi
            '';
          };
        }
      );

      formatter = forAllSystems (pkgs: pkgs.nixfmt-tree);
    };
}
