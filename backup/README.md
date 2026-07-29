# Backup

Written by `relay backup`. These are the only parts of Relay that
cannot be rebuilt from source:

- `memory.db` — everything Relay knows and remembers
- `relay.onnx` — the wake word, trained on Andrew's voice
- `voice-samples/` — the recordings it was trained from

Last updated: 2026-07-29 08:46

`install.sh` restores all three, and will not overwrite an existing
memory.db.
