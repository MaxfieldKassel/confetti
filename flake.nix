{
  description = "Confetti celebration website";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    let
      # NixOS module (system-independent)
      nixosModule = { config, lib, pkgs, ... }:
        let
          cfg = config.services.confetti;
          privilegedPort = cfg.port < 1024;
        in
        {
          options.services.confetti = {
            enable = lib.mkEnableOption "Confetti celebration website";

            package = lib.mkOption {
              type = lib.types.package;
              default = self.packages.${pkgs.stdenv.hostPlatform.system}.default;
              defaultText = lib.literalExpression "confetti.packages.\${system}.default";
              description = "The confetti package to run.";
            };

            port = lib.mkOption {
              type = lib.types.port;
              default = 80;
              description = "Port to listen on.";
            };

            secretKeyFile = lib.mkOption {
              type = lib.types.path;
              description = "Path to a file containing the 32-character SECRET_KEY for message encryption.";
            };

            logLevel = lib.mkOption {
              type = lib.types.enum [ "debug" "info" "warn" "error" "silent" ];
              default = "info";
              description = "Minimum log level written to the journal.";
            };

            trustProxy = lib.mkOption {
              type = lib.types.nullOr lib.types.str;
              default = null;
              example = "loopback";
              description = ''
                Express "trust proxy" setting (true, a hop count, or addresses/subnets).
                Set this when running behind a reverse proxy so client IPs are logged correctly.
              '';
            };

            openFirewall = lib.mkOption {
              type = lib.types.bool;
              default = false;
              description = "Whether to open the firewall for the confetti port.";
            };
          };

          config = lib.mkIf cfg.enable {
            systemd.services.confetti = {
              description = "Confetti celebration website";
              wantedBy = [ "multi-user.target" ];
              after = [ "network.target" ];

              environment = {
                PORT = toString cfg.port;
                LOG_LEVEL = cfg.logLevel;
                LOG_FORMAT = "json";
              } // lib.optionalAttrs (cfg.trustProxy != null) {
                TRUST_PROXY = cfg.trustProxy;
              };

              serviceConfig = {
                Type = "simple";
                DynamicUser = true;
                WorkingDirectory = cfg.package;
                Restart = "on-failure";
                RestartSec = 5;
                LoadCredential = "secret-key:${cfg.secretKeyFile}";
                # DynamicUser services cannot bind ports < 1024 without this.
                AmbientCapabilities = lib.optionalString privilegedPort "CAP_NET_BIND_SERVICE";
                CapabilityBoundingSet = lib.optionalString privilegedPort "CAP_NET_BIND_SERVICE";
                NoNewPrivileges = true;
              };

              script = ''
                export SECRET_KEY_FILE="$CREDENTIALS_DIRECTORY/secret-key"
                exec ${lib.getExe cfg.package}
              '';
            };

            networking.firewall.allowedTCPPorts = lib.mkIf cfg.openFirewall [ cfg.port ];
          };
        };
    in
    (flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = nixpkgs.legacyPackages.${system};
        lib = pkgs.lib;
        nodejs = pkgs.nodejs_26;
        # Runtime only needs node itself (no npm), which keeps images small.
        nodejsRuntime = pkgs.nodejs-slim_26;

        confetti = pkgs.buildNpmPackage {
          pname = "confetti";
          version = (lib.importJSON ./package.json).version;

          # Only the files the build needs, so README/GIF edits don't trigger rebuilds.
          src = lib.fileset.toSource {
            root = ./.;
            fileset = lib.fileset.unions [
              ./package.json
              ./package-lock.json
              ./build.js
              ./src
              ./private
              ./test
              ./dist/confetti.png
            ];
          };

          npmDepsHash = "sha256-VAL9r6vnMv+IOGWG51N94MtvDJCCLj17aJk+3y0pQAc=";

          inherit nodejs;
          nativeBuildInputs = [ pkgs.makeBinaryWrapper pkgs.removeReferencesTo ];
          # The runtime uses nodejs-slim; fail the build if full node/npm sneaks in.
          disallowedReferences = [ nodejs ];

          # `npm run build` runs as the default build phase; then the test suite.
          doCheck = true;
          checkPhase = ''
            runHook preCheck
            npm test
            runHook postCheck
          '';

          # Layout: $out/{dist,private,node_modules,package.json} as before, plus bin/confetti.
          installPhase = ''
            runHook preInstall
            npm prune --omit=dev --no-save
            mkdir -p $out/bin
            cp -r dist private node_modules package.json $out/
            # Unused CLI scripts in node_modules get shebangs pointing at the build-time node.
            rm -rf $out/node_modules/.bin
            find $out/node_modules -type f -exec remove-references-to -t ${nodejs} {} +
            makeWrapper ${nodejsRuntime}/bin/node $out/bin/confetti \
              --add-flags $out/private/server.js \
              --set-default NODE_ENV production
            runHook postInstall
          '';

          meta = {
            description = "Confetti celebration website";
            license = lib.licenses.mit;
            mainProgram = "confetti";
          };
        };
      in
      {
        packages = {
          default = confetti;
          inherit confetti;

          # docker load < $(nix build .#dockerImage --print-out-paths)
          dockerImage = pkgs.dockerTools.buildLayeredImage {
            name = "confetti";
            tag = confetti.version;
            config = {
              Entrypoint = [ (lib.getExe confetti) ];
              Env = [ "PORT=80" "LOG_FORMAT=json" ];
              ExposedPorts."80/tcp" = { };
              User = "65534:65534"; # nobody
            };
          };
        };

        devShells.default = pkgs.mkShell {
          packages = [ nodejs ];

          shellHook = ''
            echo "Confetti dev shell"
            echo "  npm install && npm run build && npm test"
            echo "  npm start   (needs SECRET_KEY in env or .env)"
          '';
        };
      }
    )) // {
      nixosModules.default = nixosModule;
    };
}
