// Multiplayer connection settings (see MULTIPLAYER.md).
//
// Players find each other through a free public "signaling" server run by the PeerJS project;
// after that, game data flows directly between the players' browsers over WebRTC.
//
// iceServers: STUN servers let browsers on different networks find a direct route. On very strict
// networks a direct route can be impossible; adding a free TURN relay (for example from
// metered.ca's free "Open Relay" plan) fixes that. Paste its entries into the list, e.g.
//   { urls: 'turn:global.relay.metered.ca:80', username: 'xxxx', credential: 'yyyy' },
window.BLOCKHAVEN_NET = {
  peer: { host: '0.peerjs.com', port: 443, secure: true, path: '/' },
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' },
    { urls: 'stun:global.stun.twilio.com:3478' },
  ],
  // Relay servers (MQTT over secure WebSockets), used at the same time as the PeerJS server to
  // find rooms, and to carry the game when no direct connection is possible. They are all used at
  // once and any one of them being up is enough. The first is this project's own relay
  // (blockhaven-relay/, deployed on Render; see MULTIPLAYER.md); the next two are free public
  // brokers on the standard HTTPS port 443, which strict school and office networks still allow;
  // the last three are free public brokers on their own ports.
  brokers: [
    'wss://blockhaven-relay.onrender.com/mqtt',
    'wss://public:public@public.cloud.shiftr.io',
    'wss://mqtt.eclipseprojects.io/mqtt',
    'wss://broker.emqx.io:8084/mqtt',
    'wss://broker.hivemq.com:8884/mqtt',
    'wss://test.mosquitto.org:8081/mqtt',
  ],
  // Render's free plan sleeps the relay when idle; opening the multiplayer screen wakes it.
  wake: ['https://blockhaven-relay.onrender.com/health'],
};
