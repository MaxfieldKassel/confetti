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
          confettiPackage = self.packages.${pkgs.system}.default;
        in
        {
          options.services.confetti = {
            enable = lib.mkEnableOption "Confetti celebration website";

            port = lib.mkOption {
              type = lib.types.port;
              default = 80;
              description = "Port to listen on.";
            };

            secretKeyFile = lib.mkOption {
              type = lib.types.path;
              description = "Path to a file containing the 32-character SECRET_KEY for message encryption.";
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

              serviceConfig = {
                Type = "simple";
                DynamicUser = true;
                WorkingDirectory = confettiPackage;
                Restart = "on-failure";
                RestartSec = 5;
                LoadCredential = "secret-key:${cfg.secretKeyFile}";
              };

              script = ''
                export SECRET_KEY=$(cat "$CREDENTIALS_DIRECTORY/secret-key")
                export PORT=${toString cfg.port}
                exec ${pkgs.nodejs_24}/bin/node ${confettiPackage}/private/server.js
              '';
            };

            networking.firewall.allowedTCPPorts = lib.mkIf cfg.openFirewall [ cfg.port ];
          };
        };
    in
    (flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = nixpkgs.legacyPackages.${system};
      in
      {
        packages.default = pkgs.buildNpmPackage {
          pname = "confetti";
          version = "1.0.0";

          src = ./.;

          npmDepsHash = "sha256-n6uda1H/ANIX67dbLbczunP2LUL9+goUpzed/hhtOLs=";

          nodejs = pkgs.nodejs_24;

          buildPhase = ''
            npm run build
          '';

          installPhase = ''
            mkdir -p $out
            cp -r dist $out/dist
            cp -r private $out/private
            cp -r node_modules $out/node_modules
            cp package.json $out/

            # canvas-confetti browser bundle must be in dist/ for the static server
            cp node_modules/canvas-confetti/dist/confetti.browser.js $out/dist/
          '';
        };

        devShells.default = pkgs.mkShell {
          buildInputs = with pkgs; [
            nodejs_24
          ];

          shellHook = ''
            echo "Confetti dev shell"
            echo "Run 'npm install' then 'npm run build' to build."
            echo "Run 'node private/server.js' to start the server."
          '';
        };
      }
    )) // {
      nixosModules.default = nixosModule;
    };
}
