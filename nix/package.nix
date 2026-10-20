{ lib, stdenvNoCC, makeWrapper, jq, coreutils }:

# Claude Code reads the TypeScript itself, so the mod is its folder as is. The
# statusline renderer gets jq on its PATH.
stdenvNoCC.mkDerivation {
  pname = "claude-mod-status-light";
  version = (builtins.fromJSON (builtins.readFile ../.claude-plugin/plugin.json)).version;

  src = lib.fileset.toSource {
    root = ../.;
    fileset = lib.fileset.unions [
      ../.claude-plugin/plugin.json
      ../hooks
      ../bin
      ../README.md
      ../LICENSE
    ];
  };

  nativeBuildInputs = [ makeWrapper ];

  installPhase = ''
    runHook preInstall
    cp -r . $out
    wrapProgram $out/bin/claude-status-light --prefix PATH : ${lib.makeBinPath [ jq coreutils ]}
    runHook postInstall
  '';

  meta = {
    description = "Claude Code mod that shows, in color, whether Claude is working or waiting on you, and on what";
    homepage = "https://github.com/someonewithpc/claude-mod-status-light";
    license = lib.licenses.mit;
    platforms = lib.platforms.all;
    mainProgram = "claude-status-light";
  };
}
