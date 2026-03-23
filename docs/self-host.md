# Self-Hosting the Signaling Server

droptransfer uses PeerJS for WebRTC signaling by default. If you want full privacy, you can run your own signaling server.

## Option 1: PeerJS Server (easiest)

```bash
npm install -g peer
peerjs --port 9000
```

Then update `PEER_SERVERS` in `index.html`:
```js
{ host: 'your-server.com', port: 9000, secure: false }
```

## Option 2: WebSocket Signaling Server

A minimal custom server — see `SIGNALING.md` for the full Node.js implementation.

```bash
npm install ws
node server.js
```

Deploy for free on [Render](https://render.com), [Railway](https://railway.app), or [Fly.io](https://fly.io).

## Notes

- WebRTC data channels are end-to-end encrypted regardless of which signaling server you use.
- The signaling server only sees connection metadata (ICE candidates), not your file contents.
- Once the P2P connection is established, the signaling server is no longer involved.
