# Hyprland dispatch changed in 0.55

Relay drives windows through `hyprctl dispatch`. On Hyprland 0.55.4 (this
machine) that interface is **Lua**, and the documented-everywhere flat form
silently stopped working:

```console
$ hyprctl dispatch workspace 2
error: [string "return hl.dispatch(workspace 2)"]:1: ')' expected near '2'
 → Note: dispatch in lua is a shorthand for hl.dispatch(...), your syntax might need to be updated.
```

Every tutorial, config example, and older script uses the flat form. It now
fails as a Lua syntax error rather than anything that looks like a version
problem, so it's worth knowing about.

## The mapping

| Operation | Legacy (≤0.54) | Lua (0.55+) |
|---|---|---|
| Switch workspace | `workspace 2` | `hl.dsp.focus({workspace = 2})` |
| Focus a window | `focuswindow address:0x…` | `hl.dsp.focus({window = "address:0x…"})` |
| Move window | `movetoworkspace 2` | `hl.dsp.window.move({workspace = 2})` |
| Launch | `exec kitty` | `hl.dsp.exec_cmd("kitty")` |
| Close | `killactive` | `hl.dsp.window.close()` |
| Float / fullscreen | `togglefloating` | `hl.dsp.window.float()` |

Two behavioural differences worth noting:

- **The Lua move dispatcher acts on the focused window**, with no address
  argument. A targeted move is therefore focus-then-move, which shifts focus
  as a side effect. For "put Discord on workspace 2" that matches intent, so
  Relay accepts it.
- **`hyprctl` reports failures on stdout with exit code 0**, so the output
  text has to be inspected. Trusting the return code makes every failure look
  like a success.

## How Relay handles it

`relay/tools/hypr.py` **detects the dialect once at startup** rather than
hardcoding either, since this API has already changed once:

```python
code, out, err = await run("hyprctl", "dispatch", "hl.dsp.no_op()")
dialect = LUA if code == 0 and "error" not in (out + err).lower() else LEGACY
```

`no_op` exists in both worlds and changes nothing, so it's a safe probe. Every
operation then has a branch for each dialect, and the rest of the codebase
calls `hypr.switch_workspace(2)` without caring.

## Discovering the API

There's no `hyprctl lua` subcommand and the namespace isn't listed anywhere,
but the Lua evaluator can be made to enumerate itself through an error:

```console
$ hyprctl dispatch 'error(table.concat((function() local t={}
    for k in pairs(hl.dsp) do t[#t+1]=k end table.sort(t) return t end)(), " "))'
error: … cursor dpms event exec_cmd exec_raw exit focus force_idle … window workspace
```

Passing a deliberately wrong argument also prints the accepted ones:

```console
$ hyprctl dispatch 'hl.dsp.window.move({bogus = 1})'
hl.window.move: unrecognized arguments. Expected one of:
    direction, x+y(+relative), workspace, into_group, out_of_group
```

Useful if a future version moves things again.
