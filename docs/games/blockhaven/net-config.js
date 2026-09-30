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
  ],
};
