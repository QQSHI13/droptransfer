# 📦 DropTransfer

Simple P2P file sharing. No upload limits, no server storage—files transfer directly between browsers.

**Live:** https://qqshi13.github.io/droptransfer/

## How It Works

DropTransfer uses **WebRTC** (Web Real-Time Communication) to establish a direct peer-to-peer connection between sender and receiver. Files are chunked and streamed directly—never touching a server.

## Features

- 🔗 **True P2P** - Direct browser-to-browser transfer
- 📱 **Simple codes** - Auto-generated PeerJS IDs
- 📁 **Any file size** - Chunked transfer handles large files
- 📊 **Progress tracking** - See transfer percentage
- 🔄 **Retry logic** - Auto-reconnect on failures
- 🌙 **Dark theme** - Easy on the eyes

## Tech Stack

- **PeerJS** - WebRTC abstraction with cloud signaling
- **Vanilla JS** - No frameworks, pure browser APIs
- **GitHub Pages** - Free static hosting

## Limitations

WebRTC P2P can fail behind strict NATs or firewalls. If connection fails, both peers may need to be on less restrictive networks (or wait for TURN relay support).

## Usage

1. **Sender**: Drop/select a file → get a code
2. **Receiver**: Enter the code → download

Both need to keep the page open during transfer.

---

Built with ❤️ by QQ & Nova ☄️
