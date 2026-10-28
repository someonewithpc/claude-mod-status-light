# status-light

A Claude Code mod that tells you, in color, whose move it is.

With a few sessions open, it's hard to tell which ones need you. The spinner
looks the same whether Claude is busy or stuck behind a permission dialog in
another tab. A finished turn looks like one that's still waiting on a background
shell. status-light watches the session and keeps one colored label up to date:

| Label | Color | Meaning |
| --- | --- | --- |
| `WORKING` | blue | Claude is busy. Shows what it's doing: `Bash: Run the tests`, `editing light.ts`, `agent: Find the config`, `thinking`. |
| `NEEDS APPROVAL` | red | A permission dialog is open, and the label says for which call. Subagents' dialogs count too. |
| `QUESTION FOR YOU` | magenta | Claude asked you something with AskUserQuestion. Shows the question. |
| `PLAN TO REVIEW` | magenta | A plan is waiting for your approval. |
| `COMPACTING` | cyan | The conversation is being compacted. |
| `WAITING ON` | yellow | The turn ended, but background work will wake it again: `2 shells, 1 agent`, `wakeup at 14:30`. |
| `YOUR TURN` | green | Claude is done and waiting for you. |
| `INTERRUPTED` | grey | You stopped the turn. |
| `STOPPED` | red | The turn died on an API error or a refusal. |

Each label also shows how long the session has been in that state, so
`YOUR TURN 25m` tells you that one has been sitting there a while.

## Install

Needs Claude Code 2.1.296 or later. At the Claude Code prompt:

```
/plugin install status-light --marketplace someonewithpc/claude-mod-status-light
```

Answer `y` to add the marketplace, then pick a scope.

To try a checkout for one session: `claude --plugin-dir ./claude-mod-status-light`.

## Where it shows

Out of the box the mod pins a line under the prompt, with an emoji dot for the
color, since that line can't draw colors: `🔴 needs approval: Bash: rm -rf build`.

For the colored label in your status line, have your `statusLine` script call
`bin/claude-status-light` (it needs `jq`). It reads the same JSON your script
gets on stdin, or takes the session id as its argument, and prints one segment:

```bash
#!/usr/bin/env bash
input=$(cat)
dir=$(jq -r '.workspace.current_dir' <<<"$input")
light=$(claude-status-light <<<"$input")
printf '%s | %s\n' "$light" "$dir"
```

Claude Code reruns the status line when the conversation changes, but a
permission dialog opening isn't such a change. Set `refreshInterval` so the
label keeps up:

```json
{ "statusLine": { "type": "command", "command": "~/.claude/statusline.sh", "refreshInterval": 1 } }
```

Once the status line shows it, turn the line under the prompt off with the
mod's `inline` option in `/config`, or by setting `CLAUDE_STATUS_LIGHT_INLINE=off`.

The mod writes the state to `$XDG_RUNTIME_DIR/claude-status-light/<session id>.json`
(`/tmp` when that variable is unset) as `{ kind, label, detail, since }`. Anything
else that wants it, a tmux status bar or a desktop widget, can read that file.

## Nix

The flake has NixOS and home-manager modules:

```nix
inputs.claude-mod-status-light.url = "github:someonewithpc/claude-mod-status-light";
# with claude-mod-status-light.nixosModules.default (or .homeManagerModules.default) imported:
programs.claude-mod-status-light = {
  enable = true;
  inline = false; # when your statusLine script runs claude-status-light
};
```

Both put the mod's store path in `CLAUDE_CODE_PLUGIN_DIRS` and
`claude-status-light` on the PATH. The NixOS module sets session variables,
which reach shells started after the next login. The home-manager module merges
the same variables into the `env` block of `~/.claude/settings.json`, which
every session reads.

## How it knows

Most states come straight from mod events: a turn starting and ending, tool
calls, a `/compact`. The rest are read off the screen's own parts:

- Claude Code sends no compaction event to installed mods, and its own
  auto-compaction runs no command. While it compacts, the spinner reads
  "Compacting conversation", so that message shows as compacting.

- A permission check that answers `ask` means a dialog. No event fires when you
  answer it, so the mod takes the next spinner redraw or tool progress row, or
  the end of the call, as the dialog closing.
- In auto mode most asks go to the classifier, which answers within a second or
  two. The mod waits 4 seconds before it shows those as `NEEDS APPROVAL`.
- Background shells, agents and monitors come from the counts on the hint line
  under the prompt (`1 shell`), plus the session's agent list.
- A `ScheduleWakeup` call counts as background work until its time comes.

## Development

```
claude plugin validate .
claude plugin test .
```

## License

MIT
