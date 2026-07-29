from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import Optional
from datetime import datetime
import uuid

app = FastAPI(
    title="Cider API",
    description="Backend playback and library service for the Cider music app.",
    version="1.0.0"
)

# ---------------------------------------------------------------------------
# In-memory "database" — swap for Postgres/SQLite in production
# ---------------------------------------------------------------------------

LIBRARY = {
    "1": {"id": "1", "title": "Midnight Drive", "artist": "Nova Sable", "album": "After Hours", "duration_sec": 214},
    "2": {"id": "2", "title": "Glass Horizon", "artist": "Kaito Reyes", "album": "Static Bloom", "duration_sec": 198},
    "3": {"id": "3", "title": "Paper Moons", "artist": "Wren & Co.", "album": "Low Tide", "duration_sec": 231},
    "4": {"id": "4", "title": "Halflight", "artist": "Nova Sable", "album": "After Hours", "duration_sec": 189},
}

player_state = {
    "is_playing": False,
    "current_song_id": None,
    "position_sec": 0,
    "volume": 80,
    "queue": [],
    "updated_at": datetime.utcnow().isoformat()
}


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class PlaySongRequest(BaseModel):
    song_id: str


class VolumeRequest(BaseModel):
    volume: int  # 0-100


class SeekRequest(BaseModel):
    position_sec: int


class QueueAddRequest(BaseModel):
    song_id: str


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def touch():
    player_state["updated_at"] = datetime.utcnow().isoformat()


def get_song_or_404(song_id: str):
    song = LIBRARY.get(song_id)
    if not song:
        raise HTTPException(status_code=404, detail=f"Song '{song_id}' not found")
    return song


# ---------------------------------------------------------------------------
# Playback endpoints
# ---------------------------------------------------------------------------

@app.get("/status")
def get_status():
    """Return the current player state."""
    current = LIBRARY.get(player_state["current_song_id"]) if player_state["current_song_id"] else None
    return {**player_state, "current_song": current}


@app.post("/play")
def play(body: Optional[PlaySongRequest] = None):
    """
    Start/resume playback.
    If a song_id is provided, load and play that song.
    Otherwise resume the currently loaded song.
    """
    if body and body.song_id:
        get_song_or_404(body.song_id)
        player_state["current_song_id"] = body.song_id
        player_state["position_sec"] = 0

    if not player_state["current_song_id"]:
        raise HTTPException(status_code=400, detail="No song loaded. Provide a song_id.")

    player_state["is_playing"] = True
    touch()
    return get_status()


@app.post("/pause")
def pause():
    """Pause playback, keeping position and current song intact."""
    player_state["is_playing"] = False
    touch()
    return get_status()


@app.post("/toggle")
def toggle_playback():
    """Convenience endpoint: flips play/pause state."""
    player_state["is_playing"] = not player_state["is_playing"]
    touch()
    return get_status()


@app.post("/next")
def next_song():
    """Advance to the next song in the queue."""
    if not player_state["queue"]:
        raise HTTPException(status_code=400, detail="Queue is empty")
    next_id = player_state["queue"].pop(0)
    player_state["current_song_id"] = next_id
    player_state["position_sec"] = 0
    player_state["is_playing"] = True
    touch()
    return get_status()


@app.post("/seek")
def seek(body: SeekRequest):
    """Jump to a specific position in the current song."""
    if not player_state["current_song_id"]:
        raise HTTPException(status_code=400, detail="No song loaded")
    song = LIBRARY[player_state["current_song_id"]]
    if body.position_sec < 0 or body.position_sec > song["duration_sec"]:
        raise HTTPException(status_code=400, detail="Position out of range")
    player_state["position_sec"] = body.position_sec
    touch()
    return get_status()


@app.post("/volume")
def set_volume(body: VolumeRequest):
    """Set playback volume (0-100)."""
    if not 0 <= body.volume <= 100:
        raise HTTPException(status_code=400, detail="Volume must be 0-100")
    player_state["volume"] = body.volume
    touch()
    return get_status()


# ---------------------------------------------------------------------------
# Queue endpoints
# ---------------------------------------------------------------------------

@app.get("/queue")
def get_queue():
    return {"queue": [LIBRARY[sid] for sid in player_state["queue"] if sid in LIBRARY]}


@app.post("/queue/add")
def add_to_queue(body: QueueAddRequest):
    get_song_or_404(body.song_id)
    player_state["queue"].append(body.song_id)
    touch()
    return get_queue()


@app.delete("/queue/{index}")
def remove_from_queue(index: int):
    if index < 0 or index >= len(player_state["queue"]):
        raise HTTPException(status_code=404, detail="Queue index out of range")
    removed = player_state["queue"].pop(index)
    touch()
    return {"removed": LIBRARY.get(removed), "queue": get_queue()}


# ---------------------------------------------------------------------------
# Library endpoints
# ---------------------------------------------------------------------------

@app.get("/songs")
def list_songs(artist: Optional[str] = None):
    songs = list(LIBRARY.values())
    if artist:
        songs = [s for s in songs if s["artist"].lower() == artist.lower()]
    return {"count": len(songs), "songs": songs}


@app.get("/songs/{song_id}")
def get_song(song_id: str):
    return get_song_or_404(song_id)


@app.get("/search")
def search(q: str):
    """Fuzzy-ish search across title, artist, and album."""
    q_lower = q.lower()
    results = [
        s for s in LIBRARY.values()
        if q_lower in s["title"].lower()
        or q_lower in s["artist"].lower()
        or q_lower in s["album"].lower()
    ]
    return {"query": q, "count": len(results), "results": results}


@app.get("/")
def root():
    return {"service": "Cider API", "status": "running", "version": app.version}
