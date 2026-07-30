"""`relay voice` — pick a voice by ear.

curses, like `relay settings`, for the same reasons: standard library, works
over SSH, and this screen is a list.

The whole design point is the preview. Fifty-four voices called things like
`am_fenrir` are not choosable from a list of names -- you have to hear them.
So moving the selection and stopping plays a line in that voice, and the
model is loaded once and kept, because reloading it per preview would make
arrowing through the list unbearable.
"""

from __future__ import annotations

import curses
import threading

from relay import config as config_mod
from relay import settings as settings_mod
from relay import voices as voices_mod
from relay.paths import PATHS

HELP = "up/down  choose    space  replay    enter  save    q  cancel"
# Long enough that holding an arrow key doesn't queue fifty previews, short
# enough that stopping on a voice feels like it answered you.
PREVIEW_DELAY_MS = 320


class Speaker:
    """Synthesises and plays previews, one at a time, off the UI thread."""

    def __init__(self, models_dir) -> None:
        self.models_dir = models_dir
        self._kokoro = None
        self._thread: threading.Thread | None = None
        self.error: str | None = None

    def _load(self):
        if self._kokoro is None:
            from kokoro_onnx import Kokoro

            model, voices = voices_mod.model_paths(self.models_dir)
            self._kokoro = Kokoro(str(model), str(voices))
        return self._kokoro

    def play(self, voice_id: str) -> None:
        self.stop()
        self._thread = threading.Thread(target=self._run, args=(voice_id,),
                                        daemon=True)
        self._thread.start()

    def stop(self) -> None:
        try:
            import sounddevice as sd

            sd.stop()
        except Exception:  # noqa: BLE001
            pass

    def _run(self, voice_id: str) -> None:
        try:
            import sounddevice as sd

            kokoro = self._load()
            audio, rate = kokoro.create(voices_mod.SAMPLE, voice_id, 1.0, "en-us")
            sd.play(audio, samplerate=rate)
        except Exception as exc:  # noqa: BLE001 - a failed preview is a
            # message on the screen, not a crashed picker.
            self.error = str(exc)[:60]


class VoiceScreen:
    def __init__(self) -> None:
        self.cfg = config_mod.load()
        self.voices = voices_mod.available(PATHS.models)
        self.current = self.cfg.audio.tts_voice
        self.index = next((i for i, v in enumerate(self.voices)
                           if v.id == self.current), 0)
        self.speaker = Speaker(PATHS.models)
        self.message = ""
        self.pending = True          # preview whatever we open on
        self.saved = False

    # ------------------------------------------------------------- drawing
    def draw(self, screen) -> None:
        screen.erase()
        height, width = screen.getmaxyx()

        screen.attron(curses.A_REVERSE)
        screen.addstr(0, 0, " Relay voice ".ljust(width - 1)[: width - 1])
        screen.attroff(curses.A_REVERSE)

        # Said plainly, because it is the difference between this working and
        # appearing not to: on this machine the GPU voice is usually the one
        # you hear, and it is not in this list.
        note = ("This is the CPU voice. The GPU voice is Chatterbox, which "
                "clones a reference clip.")
        screen.addstr(1, 0, note[: width - 1], curses.A_DIM)

        rows = max(1, height - 5)
        top = max(0, min(self.index - rows // 2, len(self.voices) - rows))
        for row, voice in enumerate(self.voices[top: top + rows]):
            i = top + row
            marker = "*" if voice.id == self.current else " "
            line = f" {marker} {voice.name:<14} {voice.label}"
            if i == self.index:
                screen.attron(curses.A_REVERSE)
                screen.addstr(3 + row, 0, line.ljust(width - 1)[: width - 1])
                screen.attroff(curses.A_REVERSE)
            else:
                screen.addstr(3 + row, 0, line[: width - 1])

        status = self.message or (f"{len(self.voices)} voices"
                                  f"   * = current")
        screen.addstr(height - 2, 0, status[: width - 1], curses.A_DIM)
        screen.addstr(height - 1, 0, HELP[: width - 1], curses.A_DIM)
        screen.refresh()

    # --------------------------------------------------------------- input
    def run(self, screen) -> None:
        curses.curs_set(0)
        screen.timeout(PREVIEW_DELAY_MS)

        if not self.voices:
            self._nothing_installed(screen)
            return

        while True:
            self.draw(screen)
            key = screen.getch()

            if key == -1:                       # timed out: nothing pressed
                if self.pending:
                    self.pending = False
                    self._preview()
                continue

            if key in (curses.KEY_UP, ord("k")):
                self.index = max(0, self.index - 1)
                self.pending = True
            elif key in (curses.KEY_DOWN, ord("j")):
                self.index = min(len(self.voices) - 1, self.index + 1)
                self.pending = True
            elif key == curses.KEY_PPAGE:
                self.index = max(0, self.index - 10)
                self.pending = True
            elif key == curses.KEY_NPAGE:
                self.index = min(len(self.voices) - 1, self.index + 10)
                self.pending = True
            elif key == ord(" "):
                self._preview()
            elif key in (curses.KEY_ENTER, 10, 13):
                self._save()
                return
            elif key in (ord("q"), 27):
                self.speaker.stop()
                return

    def _preview(self) -> None:
        voice = self.voices[self.index]
        self.message = f"playing {voice.name}"
        self.speaker.play(voice.id)
        if self.speaker.error:
            self.message = f"preview failed: {self.speaker.error}"

    def _save(self) -> None:
        voice = self.voices[self.index]
        self.speaker.stop()
        self.cfg.audio.tts_voice = voice.id
        settings_mod.save(self.cfg, PATHS.config_file)
        self.current = voice.id
        self.saved = True

    def _nothing_installed(self, screen) -> None:
        screen.timeout(-1)
        screen.erase()
        screen.addstr(0, 0, "No voices are installed.")
        screen.addstr(2, 0, "The Kokoro model is missing from "
                            f"{PATHS.models}.")
        screen.addstr(3, 0, "Run install.sh to download it.")
        screen.addstr(5, 0, "Press any key.")
        screen.refresh()
        screen.getch()


def main() -> int:
    screen = VoiceScreen()
    if not screen.voices:
        print("No voices are installed — the Kokoro model is missing from "
              f"{PATHS.models}.\nRun install.sh to download it.")
        return 1
    curses.wrapper(screen.run)
    if screen.saved:
        chosen = voices_mod.describe(screen.current)
        print(f"Voice set to {chosen.name} ({chosen.label}).")
        _apply_live()
    return 0


def _apply_live() -> None:
    """Tell a running daemon, so the change is audible now rather than after
    the next restart -- having just chosen a voice by ear, being told to
    restart to hear it would be a strange way to end.

    Done by hand rather than through `send()`, because this is a courtesy and
    `send()` reports failures to stderr. A daemon started before this command
    existed answers "Unknown command", which is true, unhelpful, and alarming
    right after something appeared to work.
    """
    import asyncio
    import contextlib

    from relay.ipc import protocol

    if not PATHS.socket.exists():
        print("Relay isn't running; it will use the new voice next time it starts.")
        return

    async def tell() -> bool:
        reader, writer = await asyncio.open_unix_connection(str(PATHS.socket))
        try:
            # Underscore, not a hyphen: the daemon dispatches by building
            # `_cmd_<command>` and looking it up as an attribute.
            writer.write(protocol.encode(protocol.message(
                protocol.COMMAND, command="reload_voice", args={})))
            await writer.drain()
            while True:
                line = await asyncio.wait_for(reader.readline(), timeout=5.0)
                if not line:
                    return False
                message = protocol.decode(line)
                if message.get("type") == protocol.ERROR:
                    return False
                if message.get("type") == protocol.DONE:
                    return True
        finally:
            writer.close()

    applied = False
    with contextlib.suppress(Exception):
        applied = asyncio.run(tell())
    if not applied:
        print("Restart Relay to hear it:  systemctl --user restart relay")
