# Chit Chat — video/audio meeting platform

A multi-room video and audio meeting app: create a meeting, share the link,
and anyone who opens it joins the same room with live video, audio, screen
share, and text chat.

## How it works

- **Signaling server** (`server.js`) — Express + Socket.io. It doesn't touch
  any audio/video itself; it just introduces peers to each other so their
  browsers can set up direct WebRTC connections.
- **WebRTC mesh** — every participant in a room opens a direct peer-to-peer
  connection to every other participant. Good for meetings up to roughly
  8–10 people. Beyond that, see "Scaling to larger rooms" below.
- **Rooms** — identified by a short code in the URL (`/room.html?room=abc123`).
  Anyone with the link can join; there's no account system.

## Setup

```bash
npm install
npm start
```

Then open **http://localhost:3000** in your browser. Click "Create a new
meeting," then open the room link in another browser tab/window (or send it
to a teammate) to test a call with yourself.

## Features included

- Create a room / join a room by code or link
- Multi-person video grid (mesh WebRTC, no cap enforced but see scaling note)
- Mute mic / turn camera off (shows initials avatar when camera is off)
- Screen sharing (replaces your video feed for everyone; click again or use
  the browser's native "Stop sharing" control to revert to camera)
- Text chat panel, visible to everyone in the room
- Shareable meeting link with a one-click copy button

## Deploying so others outside your network can join

Right now this runs on `localhost`. To let teammates join from elsewhere:

1. **Host it somewhere reachable** — any Node host works (Render, Railway,
   Fly.io, a VPS, etc.). Run `npm install && npm start`, and make sure the
   `PORT` environment variable is respected (it already is).
2. **Use HTTPS** — browsers require a secure origin for camera/microphone
   access on any non-`localhost` domain. Put it behind a reverse proxy
   (Caddy or nginx with Let's Encrypt) or use your host's built-in HTTPS.
3. **Add a TURN server** — STUN (already configured, using Google's public
   servers) is enough when both sides have simple home routers. Once people
   are joining from behind corporate firewalls or symmetric NATs, some
   connections will fail without a TURN relay. Options:
   - Run your own with [coturn](https://github.com/coturn/coturn) (free,
     self-hosted)
   - Use a managed service (Twilio Network Traversal, Metered.ca, Cloudflare
     Calls) and drop the credentials into `ICE_SERVERS` in
     `public/js/room-client.js`

## Scaling to larger rooms (10+ participants)

Mesh WebRTC means each participant uploads their video/audio separately to
every other participant — with 10 people, that's 9 outgoing streams per
person, which most home connections can't sustain.

For larger rooms, the standard fix is an **SFU (Selective Forwarding Unit)**:
everyone sends one stream to a media server, which forwards it to everyone
else. That's a bigger infrastructure change — swap options:

- [**LiveKit**](https://livekit.io) — open source, has a hosted cloud tier
  and a well-documented self-host path; probably the fastest way to upgrade
  this app without rewriting the signaling logic from scratch
- [**mediasoup**](https://mediasoup.org) — a Node.js SFU library if you want
  to keep everything in your own server code
- Managed platforms (Daily.co, Twilio Video, Agora) if you'd rather not run
  media infrastructure at all

The room/chat/signaling logic here would stay mostly the same — only the
media transport (mesh → SFU) would change.

## Other things worth adding next

- **Recording** — the simplest version is client-side, using the
  `MediaRecorder` API to record the local tab/screen; true server-side
  recording of a whole room needs the SFU upgrade above (most SFUs have
  built-in recording).
- **Waiting rooms / host controls** (mute others, remove a participant,
  lock the room) — needs a lightweight concept of a "host" per room, tracked
  server-side.
- **Persistent accounts / scheduled meetings** — currently anyone with the
  link can join anytime; adding login + a meetings database would make this
  closer to a full Zoom replacement.
