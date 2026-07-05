const express = require('express');
const http = require('http');
const https = require('https');
const fs = require('fs');
const { execSync } = require('child_process');
const { Server } = require('socket.io');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = Number(process.env.PORT || process.env.HTTP_PORT || 3000);
const HTTPS_PORT = Number(process.env.HTTPS_PORT || 3443);
const IS_VERCEL = Boolean(process.env.VERCEL);
const ENABLE_LOCAL_HTTPS = process.env.USE_HTTPS === 'true';
const CORS_ORIGIN = process.env.CORS_ORIGIN || '';
const CERT_DIR = path.join(__dirname, 'certs');

function buildSocketCors() {
  const allowed = CORS_ORIGIN.split(',').map((v) => v.trim()).filter(Boolean);
  if (allowed.includes('*') || allowed.length === 0) {
    return { origin: true, credentials: true };
  }
  return {
    origin: (origin, cb) => {
      if (!origin || allowed.includes(origin)) cb(null, true);
      else cb(null, false);
    },
    credentials: true,
  };
}

function buildExpressCors(req, res, next) {
  const allowed = CORS_ORIGIN.split(',').map((v) => v.trim()).filter(Boolean);
  const origin = req.headers.origin;
  if (allowed.includes('*') || allowed.length === 0) {
    if (origin) res.setHeader('Access-Control-Allow-Origin', origin);
  } else if (origin && allowed.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
}

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=*, microphone=*, display-capture=*');
  next();
});

app.use(buildExpressCors);

app.use(express.static(path.join(__dirname, 'public')));

function normalizeRoomId(raw) {
  return String(raw || '').trim().toLowerCase().replace(/[^a-f0-9]/g, '');
}

function ensureDevCertificates() {
  const keyPath = process.env.SSL_KEY || path.join(CERT_DIR, 'key.pem');
  const certPath = process.env.SSL_CERT || path.join(CERT_DIR, 'cert.pem');

  if (!fs.existsSync(keyPath) || !fs.existsSync(certPath)) {
    fs.mkdirSync(CERT_DIR, { recursive: true });
    execSync(
      `openssl req -x509 -newkey rsa:2048 -nodes -days 825 -keyout "${keyPath}" -out "${certPath}" -subj "/CN=localhost"`,
      { stdio: 'ignore' },
    );
    console.log('Generated development TLS certificate in ./certs/');
  }

  return {
    key: fs.readFileSync(keyPath),
    cert: fs.readFileSync(certPath),
  };
}

app.get('/new', (_req, res) => {
  const roomId = crypto.randomBytes(4).toString('hex');
  getRoom(roomId);
  res.json({ roomId });
});

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

const rooms = new Map();
const socketRooms = new Map();

function getRoom(roomId) {
  if (!rooms.has(roomId)) rooms.set(roomId, new Map());
  return rooms.get(roomId);
}

function roomPeerList(roomId) {
  const room = getRoom(roomId);
  return Array.from(room.entries()).map(([id, info]) => ({ id, name: info.name }));
}

function isSameRoom(senderId, targetId) {
  const senderRoom = socketRooms.get(senderId);
  const targetRoom = socketRooms.get(targetId);
  return Boolean(senderRoom && senderRoom === targetRoom);
}

const httpServer = http.createServer(app);
const io = new Server(httpServer, {
  maxHttpBufferSize: 1e6,
  cors: buildSocketCors(),
});

let httpsServer = null;
if (ENABLE_LOCAL_HTTPS && !IS_VERCEL && !process.env.RENDER) {
  try {
    const tls = ensureDevCertificates();
    httpsServer = https.createServer(tls, app);
    io.attach(httpsServer);
  } catch (err) {
    console.warn('Local HTTPS disabled:', err.message);
  }
}

io.on('connection', (socket) => {
  let currentRoom = null;

  socket.on('join-room', ({ roomId, name }, ack) => {
    roomId = normalizeRoomId(roomId);
    if (!roomId || roomId.length < 4 || !name) {
      if (typeof ack === 'function') ack({ error: 'Invalid meeting code or name.' });
      return;
    }

    if (currentRoom) leaveCurrentRoom();

    currentRoom = roomId;
    socket.join(roomId);
    socketRooms.set(socket.id, roomId);

    const existingPeers = roomPeerList(roomId).filter((p) => p.id !== socket.id);
    getRoom(roomId).set(socket.id, { name });

    if (typeof ack === 'function') {
      ack({ peers: existingPeers, selfId: socket.id });
    }

    socket.to(roomId).emit('peer-joined', { id: socket.id, name });
  });

  socket.on('signal', ({ to, data }) => {
    if (!currentRoom || !to || !data) return;
    if (!isSameRoom(socket.id, to)) return;
    io.to(to).emit('signal', { from: socket.id, data });
  });

  socket.on('chat-message', ({ payload, text }) => {
    if (!currentRoom) return;
    const info = getRoom(currentRoom).get(socket.id);
    const name = info ? info.name : 'Unknown';
    const messagePayload = payload || (text ? { legacy: text } : null);
    if (!messagePayload) return;
    io.to(currentRoom).emit('chat-message', {
      from: socket.id,
      name,
      payload: messagePayload,
      ts: Date.now(),
    });
  });

  socket.on('media-state', ({ audio, video, screenSharing }) => {
    if (!currentRoom) return;
    socket.to(currentRoom).emit('peer-media-state', {
      id: socket.id,
      audio,
      video,
      screenSharing,
    });
  });

  socket.on('leave-room', () => leaveCurrentRoom());
  socket.on('disconnect', () => leaveCurrentRoom());

  function leaveCurrentRoom() {
    if (!currentRoom) return;
    const room = rooms.get(currentRoom);
    if (room) {
      room.delete(socket.id);
      if (room.size === 0) rooms.delete(currentRoom);
    }
    socket.to(currentRoom).emit('peer-left', { id: socket.id });
    socket.leave(currentRoom);
    socketRooms.delete(socket.id);
    currentRoom = null;
  }
});

if (!IS_VERCEL) {
  httpServer.listen(PORT, () => {
    console.log(`Huddlace API running at http://localhost:${PORT}`);
    console.log('Video/audio: WebRTC encrypted (DTLS-SRTP). Chat: AES-256 in browser.');
    if (CORS_ORIGIN) console.log('CORS origin:', CORS_ORIGIN);
  });

  if (httpsServer) {
    httpsServer.listen(HTTPS_PORT, () => {
      console.log(`Local HTTPS also running at https://localhost:${HTTPS_PORT}`);
    });
  }
}

module.exports = { app, httpServer, io };
