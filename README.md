# DropTransfer 📦

Peer-to-peer file sharing in your browser. No servers, no accounts, no file size limits.

## ✨ Features

- **🔒 P2P Transfer** — Files go directly from sender to receiver, no middleman
- **📁 Any File Size** — Limited only by your browser's memory
- **🔐 Encrypted** — WebRTC's built-in DTLS plus mandatory AES-GCM chunk encryption, keyed by a secret that never reaches the signaling server
- **✅ Integrity Verified** — SHA-256 hash verification ensures files arrive intact
- **💓 Connection Health** — Automatic heartbeat monitoring detects dead connections
- **📊 Connection Metrics** — Real-time RTT and connection type (direct/relay) display
- **📱 Cross-Platform** — Works on desktop and mobile browsers
- **🎯 Simple UI** — Drag, drop, share. That's it.
- **⚡ Fast** — Direct connection means maximum speed

## 🚀 Quick Start

### Try it now
**Live Demo:** https://qqshi13.github.io/droptransfer/

### How it works
1. **Sender:** Drag files into the drop zone
2. **Share:** Copy the generated link or QR code
3. **Receiver:** Open the link on another device
4. **Transfer:** Files download automatically

## 🛠️ Tech Stack

- **Frontend:** HTML5, CSS3, JavaScript
- **P2P:** WebRTC DataChannels
- **Signaling:** Custom lightweight server (for connection setup only)
- **Encryption:** DTLS (built into WebRTC) + AES-GCM per chunk, keyed via HKDF-SHA256

## 📖 How It Works

DropTransfer uses WebRTC to establish a direct peer-to-peer connection between the sender and receiver. Files are chunked and streamed directly from one browser to another, never touching our servers.

### The Process
1. Sender generates a unique session ID
2. Signaling server helps peers find each other
3. WebRTC establishes direct connection
4. Files are chunked (1MB each) and transferred
5. Receiver's browser reassembles the file

## 📝 Why I Built This

I needed to send a large video file to a friend, but:
- Email had a 25MB limit
- WeTransfer required an account
- Google Drive was too slow

So I built DropTransfer — no accounts, no limits, just works.

## 🐛 Known Issues

- Requires modern browsers (Chrome, Firefox, Edge)
- Both peers must keep the tab open during transfer
- Mobile browsers may have stricter background tab policies
- Very large files (>2GB) may hit browser memory limits

## 🔮 Future Plans

- [x] Connection health monitoring (heartbeat)
- [x] File integrity verification (SHA-256)
- [x] Connection quality metrics (RTT, connection type)
- [ ] Folder transfer support
- [ ] Resume interrupted transfers
- [ ] Self-hosted signaling server option
- [ ] Multi-file batch transfer with individual progress

## ⚠️ Security Note

Signaling goes through our server, so it learns that two peers connected and
when. It does **not** learn the encryption key: the share link carries a random
secret in its URL fragment, which browsers never transmit, and the AES-GCM key is
derived from that secret via HKDF. Chunk encryption is mandatory — if the key
cannot be established the transfer aborts rather than falling back to plaintext.

Treat the share link as the credential it is. Anyone who obtains it can receive
the files, so send it over a channel you trust, and bear in mind the secret is
visible in the sender's address bar and browser history. For maximum privacy you
can also self-host the signaling server (see `docs/self-host.md`).

## 📄 License

This project is licensed under the [GPL-3.0 License](LICENSE).

## 🙏 Credits

Built with ❤️ by [QQ](https://github.com/QQSHI13) & [Nova ☄️](https://openclaw.ai)

Powered by [OpenClaw](https://openclaw.ai)

---

**⭐ Star this repo if you find it useful!**

---

## Star History

<a href="https://www.star-history.com/?repos=QQSHI13%2Fdroptransfer&type=date&legend=top-left">
 <picture>
 <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=QQSHI13/droptransfer&type=date&theme=dark&legend=top-left" />
 <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=QQSHI13/droptransfer&type=date&legend=top-left" />
 <img alt="Star History Chart" src="https://api.star-history.com/chart?repos=QQSHI13/droptransfer&type=date&legend=top-left" />
 </picture>
</a>
