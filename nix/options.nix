self: { lib, pkgs }:
{
  enable = lib.mkEnableOption "status-light, the Claude Code mod that shows whose move it is";

  package = lib.mkOption {
    type = lib.types.package;
    default = self.packages.${pkgs.stdenv.hostPlatform.system}.default;
    defaultText = lib.literalExpression "claude-mod-status-light.packages.\${system}.default";
    description = "The mod's folder, loaded through CLAUDE_CODE_PLUGIN_DIRS. Its bin/claude-status-light renders the light for a statusLine script.";
  };

  inline = lib.mkOption {
    type = lib.types.bool;
    default = true;
    description = ''
      Show the light as a line under the prompt. Turn it off when a statusLine
      script runs claude-status-light instead.
    '';
  };
}
