# WebRTC Signaling Server Options

## What is Signaling?
WebRTC needs a way to exchange connection info (SDP offers/answers and ICE candidates) between peers. This is called "signaling." It happens **before** the direct P2P connection is established.

## Option 1: Simple WebSocket Server (Recommended)

### Server (Node.js)
```javascript
// server.js
const WebSocket = require('ws');
const http = require('http');

const server = http.createServer();
const wss = new WebSocket.Server({ server });

const rooms = new Map();

wss.on('connection', (ws) => {
    let currentRoom = null;
    
    ws.on('message', (message) => {
        const data = JSON.parse(message);
        
        switch(data.type) {
            case 'join':
                currentRoom = data.room;
                if (!rooms.has(currentRoom)) {
                    rooms.set(currentRoom, new Set());
                }
                rooms.get(currentRoom).add(ws);
                ws.send(JSON.stringify({ type: 'joined', room: currentRoom }));
                break;
                
            case 'offer':
            case 'answer':
            case 'candidate':
                // Broadcast to all other peers in the room
                if (currentRoom && rooms.has(currentRoom)) {
                    rooms.get(currentRoom).forEach(client => {
                        if (client !== ws && client.readyState === WebSocket.OPEN) {
                            client.send(JSON.stringify(data));
                        }
                    });
                }
                break;
        }
    });
    
    ws.on('close', () => {
        if (currentRoom && rooms.has(currentRoom)) {
            rooms.get(currentRoom).delete(ws);
            if (rooms.get(currentRoom).size === 0) {
                rooms.delete(currentRoom);
            }
        }
    });
});

server.listen(3000, () => {
    console.log('Signaling server running on ws://localhost:3000');
});
```

### Client Code
```javascript
const ws = new WebSocket('wss://your-server.com');
const roomCode = 'ABC123';

ws.onopen = () => {
    ws.send(JSON.stringify({ type: 'join', room: roomCode }));
};

ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    
    switch(data.type) {
        case 'offer':
            handleOffer(data.offer);
            break;
        case 'answer':
            handleAnswer(data.answer);
            break;
        case 'candidate':
            handleCandidate(data.candidate);
            break;
    }
};

// Send offer
function sendOffer(offer) {
    ws.send(JSON.stringify({ type: 'offer', room: roomCode, offer }));
}

// Send ICE candidate
function sendCandidate(candidate) {
    ws.send(JSON.stringify({ type: 'candidate', room: roomCode, candidate }));
}
```

## Option 2: Firebase (Serverless)
```javascript
// Using Firebase Realtime Database as signaling
import { initializeApp } from 'firebase/app';
import { getDatabase, ref, set, onValue } from 'firebase/database';

const firebaseConfig = { /* your config */ };
const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

const roomRef = ref(db, 'rooms/' + roomCode);

// Send signaling data
function sendSignal(data) {
    set(roomRef, {
        timestamp: Date.now(),
        ...data
    });
}

// Listen for signaling data
onValue(roomRef, (snapshot) => {
    const data = snapshot.val();
    if (data) handleSignal(data);
});
```

## Option 3: Simple HTTP Polling (No WebSocket)
```javascript
// Backend (Express)
const express = require('express');
const app = express();
const rooms = {};

app.use(express.json());

// Post signaling data
app.post('/signal/:room', (req, res) => {
    const { room } = req.params;
    if (!rooms[room]) rooms[room] = [];
    rooms[room].push({ ...req.body, timestamp: Date.now() });
    res.json({ success: true });
});

// Get signaling data
app.get('/signal/:room', (req, res) => {
    const { room } = req.params;
    const since = req.query.since || 0;
    const messages = (rooms[room] || []).filter(m => m.timestamp > since);
    res.json(messages);
});

// Client polling
async function pollForSignals(roomCode) {
    let lastPoll = 0;
    setInterval(async () => {
        const res = await fetch(`/signal/${roomCode}?since=${lastPoll}`);
        const messages = await res.json();
        messages.forEach(handleSignal);
        if (messages.length) {
            lastPoll = Math.max(...messages.map(m => m.timestamp));
        }
    }, 1000);
}
```

## Option 4: Use Existing Services (Easiest)

### PeerJS (Free public servers)
```javascript
import Peer from 'peerjs';

const peer = new Peer(); // Uses PeerJS cloud servers
peer.on('open', id => console.log('My ID:', id));

// Connect to another peer
const conn = peer.connect('other-peer-id');
conn.on('open', () => conn.send('Hello!'));
```

### Simple-Peer + Socket.io
```javascript
// Already handles signaling through socket.io
const socket = io('https://signaling-server.com');
const peer = new SimplePeer({ initiator: true });

peer.on('signal', data => socket.emit('signal', roomCode, data));
socket.on('signal', data => peer.signal(data));
```

## Recommendation for QuickShare

**Go with Option 1 (WebSocket)** — it's:
- Simple to understand
- Real-time (no polling delay)
- Can host on free tiers (Render, Railway, Fly.io)

Want me to build a complete working signaling server for QuickShare?
