{
  description = "lazyhub - a keyboard-driven GitHub TUI";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs = { self, nixpkgs }:
    let
      forAllSystems = fn: nixpkgs.lib.genAttrs [ "x86_64-linux" "aarch64-linux" "x86_64-darwin" "aarch64-darwin" ] (system:
        fn import nixpkgs { inherit system; });
    in {
      packages = forAllSystems (pkgs:
        let pkg = pkgs.buildNpmPackage {
          pname = "lazyhub";
          version = "26.6.2";
          src = self;
          npmDeps = pkgs.importNpmLock { npmRoot = self; };
          nativeBuildInputs = [ pkgs.importNpmLock.npmConfigHook pkgs.makeWrapper ];
          postInstall = ''
            wrapProgram $out/bin/lazyhub --prefix PATH : ${pkgs.lib.makeBinPath [ pkgs.gh ]}
          '';
        };
        in {
          default = pkg;
          lazyhub = pkg;
        });

      apps = forAllSystems (pkgs: {
        default = {
          type = "app";
          program = "${self.packages.${pkgs.system}.default}/bin/lazyhub";
        };
      });
    };
}
