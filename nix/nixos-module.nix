self: { config, lib, pkgs, ... }:
let
  cfg = config.programs.claude-mod-status-light;
in
{
  options.programs.claude-mod-status-light = import ./options.nix self { inherit lib pkgs; };

  config = lib.mkIf cfg.enable {
    environment.systemPackages = [ cfg.package ];
    # A list, so other mods' folders join it instead of conflicting.
    environment.sessionVariables.CLAUDE_CODE_PLUGIN_DIRS = [ "${cfg.package}" ];
    environment.sessionVariables.CLAUDE_STATUS_LIGHT_INLINE = if cfg.inline then "on" else "off";
  };
}
