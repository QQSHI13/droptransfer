# DropTransfer 📦

Peer-to-peer file sharing in your browser. No servers, no accounts, no file size limits.

![DropTransfer Demo](demo.gif)

## ✨ Features

- **🔒 P2P Transfer** — Files go directly from sender to receiver, no middleman
- **📁 Any File Size** — Limited only by your browser's memory
- **🔐 Encrypted** — All transfers use WebRTC's built-in encryption
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
- **Encryption:** DTLS (built into WebRTC)

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

## 🔮 Future Plans

- [ ] Folder transfer support
- [ ] Resume interrupted transfers
- [ ] End-to-end encryption with custom keys
- [ ] Self-hosted signaling server option

## ⚠️ Security Note

While WebRTC provides encryption in transit, the initial signaling goes through our server. For maximum privacy, you can self-host the signaling server (see `docs/self-host.md`).

## 📄 License

This project is licensed under the [GPL-3.0 License](LICENSE).

## 🙏 Credits

Built with ❤️ by [QQ](https://github.com/QQSHI13) & [Nova ☄️](https://openclaw.ai)

Powered by [OpenClaw](https://openclaw.ai)

---

**⭐ Star this repo if you find it useful!**
