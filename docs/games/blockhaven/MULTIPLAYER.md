# Blockhaven multiplayer

Up to 5 players share a world. It's free, needs no account, and works on the same Wi‑Fi or
across the internet.

## Playing

- **Host:** open one of your worlds, press `Esc`, then choose **Open to Friends**. The pause menu
  shows a 5-letter room code.
- **Join:** on the title screen, click **Multiplayer**. Pick a name and a skin, type the code, then
  press **Join World**.
- Hold `Tab` to see who's online. Press `T` to chat.

The host's world is the real one. It's saved on the host's computer, along with each guest's
inventory and position, so guests can leave and come back. When the host quits, the world closes
for everyone.

A guest's saved progress in a world belongs to the browser that first joined it under that name:
someone else joining with the same name from another browser is asked to pick a different one. (The
link is a random key kept in the browser's settings, so clearing site data means starting fresh.)
Chat and death messages carry only the words; each player's game adds the name of whoever the host
knows actually sent them, so nobody can post as someone else.

## How it works

GitHub Pages can only serve files, so the browsers talk to each other directly over WebRTC
whenever they can. To find each other they use several independent servers at the same time,
and a join uses whichever works first:

1. **PeerJS** (`0.peerjs.com`): the host registers its room code there; a friend asks for the code
   and the two browsers open a direct, encrypted connection.
2. **Relay servers** (MQTT over secure WebSockets, all at once): the room is a topic. The friend
   "knocks", the host answers, and the browsers swap WebRTC connection details through the topic
   to open a direct connection. The list (in `net-config.js`) is:
   - this project's own relay, `blockhaven-relay` (see below), on the standard HTTPS port 443;
   - two free public brokers on port 443 (shiftr.io and Eclipse), which strict school and office
     networks still allow;
   - three free public brokers on their own ports (EMQX, HiveMQ, Mosquitto).
3. If no direct connection is possible between the two networks (common on strict school,
   office or mobile networks), the game traffic itself is passed through the relay servers. It is
   a little slower, but the join still works without any setup.

Reliability:

- Relayed traffic is **reliable and in order**: every message is numbered and acknowledged
  (including which later ones arrived), and anything lost is sent again, soon and then with
  growing pauses. Nothing is ever skipped, so players never drift out of sync. Tested with 30% of
  messages lost, duplicated and reordered.
- Every relay server is used at once, and a dropped one reconnects on its own in the background,
  so one server going down mid-game changes nothing.
- A keep-alive runs from a background worker, so it keeps going even in a minimised tab; a
  connection that is silent for 20 seconds is treated as lost.
- **Guests reconnect automatically.** If the connection drops (Wi-Fi blip, sleeping laptop,
  switching networks), the guest's game retries for about two minutes and drops straight back
  into the world, with their inventory and position kept by the host.

Then:

- The host relays traffic between guests (a star), so each guest needs only one connection.
- Each mob, dropped item, XP orb or projectile is simulated by the player whose game spawned it.
  That player streams it to the others, who draw a copy. Hits, pickups and right-clicks on a copy
  are sent to the owner. When the owner moves far away or leaves, the entity is handed to a
  player who is still nearby.

The networking code is in `js/net/` (`transport.js` is the relay path). Connection settings are
in `net-config.js`.

## Test Connection

The **Multiplayer** screen has a **Test Connection** button. It checks every server from the
network you're on and whether direct connections are possible, then says plainly whether
multiplayer will work there (and whether directly or through a relay). If it says everything is
blocked, that network blocks all of it: try another network or a phone hotspot.

## The project's own relay (recommended, free)

The public servers are run by other people and some networks block them. Deploying the small
relay in `blockhaven-relay/` gives the game a server you control, on port 443, which gets through
networks that allow that endpoint. Render offers a free instance:

1. Sign in at <https://render.com> with GitHub (the free plan is enough).
2. **New → Web Service**, choose this repository (or its public Git URL). Use branch `main`,
   root directory `blockhaven-relay`, runtime **Node**, build command `npm ci`, start command
   `node server.js`, and instance type **Free**. Set the health check path to `/health`.
   This creates only the relay; the repository's Blueprint also contains a separate FPS server.
3. When it's live, its address is shown at the top of the service page, normally
   `https://blockhaven-relay.onrender.com`. If Render gave it a different name, put that address
   into `net-config.js` (both the `brokers` entry, as `wss://<name>.onrender.com/mqtt`, and the
   `wake` entry, as `https://<name>.onrender.com/health`).

Render's free plan puts the service to sleep after 15 minutes without visitors; opening the
Multiplayer screen wakes it, which can take about a minute. Initial relay connections keep
retrying for up to 65 seconds; the other servers keep working meanwhile. If it is still waking
after that, try joining again. Public Git deployments without a connected provider may require
**Manual Deploy → Deploy latest commit** after relay code changes.

The relay only passes messages between players in the same room (topics starting with
`blockhaven/`), limits message size and rate, and keeps nothing.

## If joining still fails

- Press **Test Connection** on both computers and compare.
- Make sure the host has pressed **Open to Friends** and that the code matches (letters and
  digits only, no O/0 or I/1 mix-ups: codes never use O, 0, I or 1).
- Both players should refresh the page (Ctrl+Shift+R) so they run the same version.
- For faster play between very strict networks, you can add a TURN relay to `iceServers` in
  `net-config.js`. The free plan at <https://www.metered.ca/stun-turn> works: create TURN
  credentials in their dashboard and paste the `urls`, `username` and `credential` entries.
