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

## How it works (no server of our own needed)

GitHub Pages can only serve files, so the browsers talk to each other directly over WebRTC. To
find each other they use two independent kinds of free public servers at the same time, and a
join uses whichever works first:

1. **PeerJS** (`0.peerjs.com`): the host registers its room code there; a friend asks for the code
   and the two browsers open a direct, encrypted connection.
2. **MQTT brokers** (EMQX, HiveMQ and Mosquitto public brokers, all at once): the room is a topic.
   The friend "knocks", the host answers, and the browsers swap WebRTC connection details through
   the topic to open a direct connection.
3. If no direct connection is possible between the two networks (common on strict school,
   office or mobile networks), the game traffic itself is passed through the MQTT brokers
   instead. It is a little slower, but the join still works without any setup.

Then:

- The host relays traffic between guests (a star), so each guest needs only one connection.
- Each mob, dropped item, XP orb or projectile is simulated by the player whose game spawned it.
  That player streams it to the others, who draw a copy. Hits, pickups and right-clicks on a copy
  are sent to the owner. When the owner moves far away or leaves, the entity is handed to a
  player who is still nearby.
- A keep-alive runs even while a tab is in the background, so switching tabs doesn't drop anyone.

The networking code is in `js/net/` (`transport.js` is the MQTT path). Connection settings are in
`net-config.js`.

## If joining still fails

- Make sure the host has pressed **Open to Friends** and that the code matches (letters and
  digits only, no O/0 or I/1 mix-ups: codes never use O, 0, I or 1).
- Both players should refresh the page (Ctrl+Shift+R) so they run the same version.
- For faster play between very strict networks, you can add a TURN relay to `iceServers` in
  `net-config.js`. The free plan at <https://www.metered.ca/stun-turn> works: create TURN
  credentials in their dashboard and paste the `urls`, `username` and `credential` entries.
