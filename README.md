# DropTransfer 📦

Simple P2P file sharing. No upload limits, no server storage—files transfer directly between browsers using WebRTC.

**Live**: https://qqshi13.github.io/droptransfer/

---

## ✨ Features

### Core Features
- **🔗 True P2P** — Direct browser-to-browser transfer via WebRTC
- **📁 Any File Size** — Chunked transfer handles large files without memory issues
- **📱 Simple Codes** — Auto-generated PeerJS IDs for easy sharing
- **📊 Progress Tracking** — Real-time transfer percentage and speed
- **🔄 Retry Logic** — Auto-reconnect on connection failures

### Security & Privacy
- **🔒 End-to-End Encrypted** — WebRTC's built-in DTLS encryption
- **🚫 No Server Storage** — Files never touch a server
- **📋 CSP Protected** — Content Security Policy for added safety

### UX Features
- **🌙 Dark Theme** — Easy on the eyes
- **📦 ZIP Support** — Automatically packages multiple files
- **💬 Chat** — Send messages while transferring
- **📱 Mobile Friendly** — Works on phones and tablets

---

## 🚀 How It Works

DropTransfer uses **WebRTC** (Web Real-Time Communication) to establish a direct peer-to-peer connection between sender and receiver:

1. **Sender** opens the app and gets a unique code
2. **Receiver** enters the code to establish connection
3. **WebRTC** creates a direct encrypted connection
4. **Files** are chunked and streamed directly between browsers
5. **No server** ever sees your file contents

---

## 📥 Usage

### Sending Files
1. Open [DropTransfer](https://qqshi13.github.io/droptransfer/)
2. Select files or drag & drop onto the page
3. Share the generated code with the recipient
4. Wait for them to connect and download

### Receiving Files
1. Open [DropTransfer](https://qqshi13.github.io/droptransfer/)
2. Click "Receive" and enter the sender's code
3. Accept the connection
4. Files download automatically

---

## 🛠️ Technologies

- **P2P**: WebRTC DataChannels via [PeerJS](https://peerjs.com/)
- **Torrent**: WebTorrent for alternative transfer method
- **Compression**: JSZip for multi-file packaging
- **Security**: Content Security Policy (CSP)
- **Frontend**: Vanilla HTML5, CSS3, JavaScript

---

## 📦 Installation (Self-Host)

```bash
# Clone the repository
git clone https://github.com/QQSHI13/droptransfer.git

# Open in browser
cd droptransfer
# Open index.html in your browser
```

---

## ⚠️ Limitations

- Both sender and receiver must have the app open
- Large files may take time depending on connection speed
- Some corporate firewalls may block WebRTC
- Files are transferred in memory—very large files may require chunked mode

---

## 🔒 Privacy

- No account required
- No file metadata stored
- Direct peer-to-peer connection
- Files are encrypted in transit via DTLS

---

## 📝 License

This project is licensed under the **GNU General Public License v3.0 (GPL-3.0)**.

See [LICENSE](./LICENSE) for details.

---

## 🙏 Credits

Built with ❤️ by **QQ** and **Nova** ☄️

Powered by [OpenClaw](https://openclaw.ai)

Uses [PeerJS](https://peerjs.com/) for WebRTC signaling.
