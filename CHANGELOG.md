# Changelog

## Unreleased — Encryption rework (breaking)

Application-layer encryption is now keyed by a real secret and is mandatory.

- **Key material is no longer public.** The AES-GCM key was derived with PBKDF2
  from the two peer IDs plus a hardcoded salt. The sender's peer ID *is* the
  share code and both IDs are assigned and relayed by the signaling server, so
  anyone who could see the signaling traffic could derive the key — which is
  precisely the adversary this layer exists to stop (WebRTC's DTLS already covers
  a passive network observer). The key now comes from a locally generated
  128-bit random secret via HKDF-SHA256, with the sorted peer IDs as the salt to
  bind the key to the peer pair and a domain-separation label as `info`.
- **The secret travels out of band.** It rides in the fragment of the share link
  (`…/#<code>:<secret>`), which browsers never transmit, so the signaling server
  still sees the peer ID but never the key material. Receivers may paste either
  the full link or the `code:secret` pair; a share link opened directly
  pre-fills the field.
- **No more silent plaintext downgrade.** Previously, if `deriveKey` failed both
  peers continued unencrypted: the receiver still signalled `ready`, the sender
  sent chunks with `iv: null`, and the receiver's `if (encryptionKey && data.iv)`
  guard quietly treated them as plaintext — so a peer could force cleartext just
  by omitting the IV. Key-derivation failure now aborts the connection with a
  visible error, both send paths refuse to run without a key, and the receiver
  rejects any chunk that arrives without an IV.
- Each resend derives a fresh IV rather than potentially reusing one.

**Breaking:** a bare transfer code from an older build no longer works, because
it carries no key. Both ends must run this version.

## 2026-03 — Stability pass and modular rewrite

The single-file `index.html` prototype was split into ES modules under `js/`
(`app.js`, `state.js`, `crypto.js`, `utils.js`, `ui/`, `transfers/`), and a round
of correctness fixes landed along the way:

- **Service worker reload loop** — multiple overlapping reload mechanisms could
  retrigger each other; consolidated behind a single guarded path.
- **Chunk send race** — `chunkIndex` was captured from an outer scope and mutated
  across async backpressure waits, so chunks could be sent twice or skipped.
- **ArrayBuffer serialization** — chunks are converted to `Uint8Array` before
  send, working around PeerJS binary-serialization issues.
- **Data channel buffer check** — `conn.dataChannel` can be undefined while a
  connection is opening or closing; the `bufferedAmount` read is now optional
  (`js/transfers/peerjs.js`).
- **Connection timeout leak** — `connectionTimeout` is cleared on every error and
  close path, not just the success path.
- **Variable shadowing in chunk retry** — a shadowed `fileIndex` caused the retry
  to look up the wrong file.
- **Directory reader errors** — `dirReader.readEntries` now passes a rejection
  handler, so permission failures surface instead of hanging
  (`js/ui/dragdrop.js`).
- **WebTorrent fallback and progress UI** — missing DOM guards and progress
  accounting fixes.

### Known gap

If `deriveKey` fails, the transfer currently continues without AES chunk
encryption rather than aborting. WebRTC's own DTLS still encrypts data in
transit, but the optional application-layer encryption is skipped silently. See
`js/transfers/peerjs.js`. *(Fixed in the unreleased entry above.)*

---

*This file replaces the earlier `bug-analysis.md`, `FIXES.md` and
`BUGFIX_REPORT.md`, which described the pre-rewrite single-file layout and cited
`index.html` line numbers that no longer exist.*
