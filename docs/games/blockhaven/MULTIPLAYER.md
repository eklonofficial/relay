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

## How it works (no server needed)

GitHub Pages can only serve files, so the browsers talk to each other directly over WebRTC:

1. The host's browser registers its room code with the free public PeerJS signalling server
   (`0.peerjs.com`). Its only job is to introduce the players to each other.
2. A friend's browser asks that server for the code, and the two browsers set up a direct,
   encrypted connection. After that, all game data flows between the players.
3. The host relays traffic between guests (a star), so each guest needs only one connection.
4. Each mob, dropped item, XP orb or projectile is simulated by the player whose game spawned it.
   That player streams it to the others, who draw a copy. Hits, pickups and right-clicks on a copy
   are sent to the owner. When the owner moves far away or leaves, the entity is handed to a
   player who is still nearby.

The networking code is in `js/net/`. Connection settings are in `net-config.js`.

## If joining fails on different networks

Most home networks connect directly. Some strict networks (certain school, office or mobile
networks) block direct connections. For those, a TURN relay passes the traffic along. Here's how
to add a free one:

1. Sign up for the free plan at <https://www.metered.ca/stun-turn>. It includes 20 GB a month,
   which is plenty for a block game.
2. In their dashboard, create TURN credentials and copy the list of `urls`, `username` and
   `credential` entries.
3. Paste those entries into the `iceServers` list in `docs/games/blockhaven/net-config.js`, then
   commit.

If the multiplayer server itself is unreachable, the network may block `0.peerjs.com`. The fix is
to run your own PeerJS server (for example on a free Render web service using the `peer` npm
package) and point `peer.host` in `net-config.js` at it.
