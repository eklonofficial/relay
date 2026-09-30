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
  // Free public MQTT brokers, used at the same time as the PeerJS server to find rooms, and to
  // carry the game when no direct connection is possible. Any one of them being up is enough.
  brokers: [
    'wss://broker.emqx.io:8084/mqtt',
    'wss://broker.hivemq.com:8884/mqtt',
    'wss://test.mosquitto.org:8081/mqtt',
  ],
};
