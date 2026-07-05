// ===================== Setup =====================
const params = new URLSearchParams(window.location.search);
const roomId = normalizeRoomId(params.get('room'));
let myName = params.get('name') || localStorage.getItem('meet-name') || '';

function normalizeRoomId(raw) {
  return String(raw || '').trim().toLowerCase().replace(/[^a-f0-9]/g, '');
}

function apiBase() {
  return window.HuddlaceEnv?.apiBase?.() || (window.HUDDLACE_CONFIG?.serverUrl || '').replace(/\/$/, '');
}

function getIceServers() {
  return window.HuddlaceEnv?.iceServers?.() || [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ];
}

if (!roomId || roomId.length < 4) {
  window.location.href = '/';
}

const ICE_SERVERS = getIceServers();

const videoGrid = document.getElementById('videoGrid');
const roomCodeVal = document.getElementById('roomCodeVal');
const participantCountEl = document.getElementById('participantCount');
const userNameDisplay = document.getElementById('userNameDisplay');
const nameOverlay = document.getElementById('nameOverlay');
const overlayNameInput = document.getElementById('overlayNameInput');
const overlayJoinBtn = document.getElementById('overlayJoinBtn');
const previewWrap = document.getElementById('previewWrap');
const previewVideo = document.getElementById('previewVideo');
const mediaStatus = document.getElementById('mediaStatus');
const permissionHelp = document.getElementById('permissionHelp');
const overlayJoinNoMediaBtn = document.getElementById('overlayJoinNoMediaBtn');
const micBtn = document.getElementById('micBtn');
const camBtn = document.getElementById('camBtn');
const screenBtn = document.getElementById('screenBtn');
const chatBtn = document.getElementById('chatBtn');
const leaveBtn = document.getElementById('leaveBtn');
const hdBtn = document.getElementById('hdBtn');

roomCodeVal.textContent = roomId;
const overlayRoomCode = document.getElementById('overlayRoomCode');
if (overlayRoomCode) overlayRoomCode.textContent = roomId;

MeetCrypto.initRoomKey(roomId).catch(() => {
  console.warn('Chat encryption unavailable in this browser.');
});

let socket = null;
let localStream = null;
let cameraTrack = null;
let rawCameraTrack = null;
let outboundVideoTrack = null;
let videoEnhancer = null;
let screenStream = null;
let selfId = null;
let localTileRefs = null;
const peers = new Map();
const pendingIceCandidates = new Map();

let micOn = true;
let camOn = true;
let screenSharing = false;

const AVATAR_COLORS = ['#5c6bc0', '#00897b', '#8e24aa', '#ef6c00', '#3949ab', '#c62828'];

function isLocalDevHost() {
  return ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname);
}

function showSecureContextWarning() {
  if (window.isSecureContext || isLocalDevHost()) return;

  const warning = document.createElement('div');
  warning.className = 'secure-warning';
  warning.innerHTML =
    '<strong>Connection issue:</strong> Open <code>http://localhost:3000</code> or ' +
    '<code>https://localhost:3443</code> in Chrome or Safari (not an IP address or embedded preview).';
  overlayNameInput.insertAdjacentElement('afterend', warning);
}

function formatMediaError(err) {
  const name = err?.name || '';
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
    return {
      message: 'Permission denied — camera or microphone access was blocked.',
      help: permissionDeniedHelp(),
    };
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
    return {
      message: 'No camera or microphone was found on this device.',
      help: '<strong>No device found.</strong> Connect a camera/mic, or use Join without camera below.',
    };
  }
  if (name === 'NotReadableError' || name === 'TrackStartError') {
    return {
      message: 'Camera is in use by another app (FaceTime, Zoom, etc.).',
      help: '<strong>Camera busy.</strong> Close other apps using the camera, then try again.',
    };
  }
  if (name === 'SecurityError') {
    return {
      message: 'Browser blocked media on this URL.',
      help:
        '<strong>Unsafe URL.</strong> Use <code>http://localhost:3000</code> or <code>https://localhost:3443</code> in Chrome or Safari.',
    };
  }
  return {
    message: err?.message || 'Could not access camera or microphone.',
    help: permissionDeniedHelp(),
  };
}

function permissionDeniedHelp() {
  const browser = detectBrowserName();
  return (
    '<strong>How to fix permission denied</strong>' +
    '<ol>' +
    `<li>Open <code>http://localhost:3000</code> in <strong>Chrome</strong> or <strong>Safari</strong> (not Cursor\'s built-in preview).</li>` +
    '<li>macOS: <strong>System Settings → Privacy &amp; Security → Camera</strong> — enable <strong>' + browser + '</strong>.</li>' +
    '<li>macOS: <strong>System Settings → Privacy &amp; Security → Microphone</strong> — enable <strong>' + browser + '</strong>.</li>' +
    '<li>In the browser address bar, click the <strong>lock / tune icon → Site settings</strong> and set Camera &amp; Microphone to <strong>Allow</strong>.</li>' +
    '<li>Reload the page and click <strong>Allow camera &amp; join</strong> again.</li>' +
    '</ol>'
  );
}

function detectBrowserName() {
  const ua = navigator.userAgent;
  if (ua.includes('Edg/')) return 'Microsoft Edge';
  if (ua.includes('Chrome/')) return 'Google Chrome';
  if (ua.includes('Safari/') && !ua.includes('Chrome/')) return 'Safari';
  if (ua.includes('Firefox/')) return 'Firefox';
  return 'your browser';
}

function showMediaError(err) {
  const { message, help } = formatMediaError(err);
  mediaStatus.textContent = message;
  mediaStatus.classList.add('error');
  permissionHelp.innerHTML = help;
  permissionHelp.classList.remove('hidden');
}

function clearMediaError() {
  mediaStatus.classList.remove('error');
  permissionHelp.classList.add('hidden');
  permissionHelp.innerHTML = '';
}

// ===================== Media helpers =====================
async function stopEnhancer() {
  if (videoEnhancer) {
    videoEnhancer.stop();
    videoEnhancer = null;
  }
}

async function buildOutboundVideoTrack(rawTrack, useEnhancement = true) {
  await stopEnhancer();
  if (!rawTrack) {
    outboundVideoTrack = null;
    return null;
  }
  await MeetVideoQuality.tuneVideoTrack(rawTrack);
  const canEnhance = useEnhancement
    && MeetVideoQuality.isEnhancementEnabled()
    && MeetVideoQuality.Enhancer.supported();
  if (canEnhance) {
    videoEnhancer = new MeetVideoQuality.Enhancer();
    outboundVideoTrack = await videoEnhancer.start(rawTrack);
  } else {
    outboundVideoTrack = rawTrack;
  }
  return outboundVideoTrack;
}

function removeLocalVideoTracks() {
  localStream.getVideoTracks().forEach((track) => {
    localStream.removeTrack(track);
  });
}

async function setLocalVideoTrack(rawTrack, { enhance = true, screenShare = false } = {}) {
  removeLocalVideoTracks();
  if (!rawTrack) {
    rawCameraTrack = null;
    outboundVideoTrack = null;
    cameraTrack = null;
    await stopEnhancer();
    return;
  }

  rawCameraTrack = rawTrack;
  cameraTrack = rawTrack;
  if (screenShare) {
    await stopEnhancer();
    outboundVideoTrack = rawTrack;
  } else {
    outboundVideoTrack = await buildOutboundVideoTrack(rawTrack, enhance);
  }
  localStream.addTrack(outboundVideoTrack);
  replaceOutgoingVideoTrack(outboundVideoTrack, screenShare);
  if (localTileRefs) await attachStreamToVideo(localTileRefs.video, localStream);
}

async function acquireLocalMedia() {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw Object.assign(new Error('Camera and microphone are not supported in this browser.'), {
      name: 'NotSupportedError',
    });
  }

  localStream = new MediaStream();
  let lastErr;

  try {
    const audioTrack = await MeetVideoQuality.acquireAudioTrack();
    localStream.addTrack(audioTrack);
  } catch (err) {
    lastErr = err;
    micOn = false;
  }

  try {
    const rawVideo = await MeetVideoQuality.acquireVideoTrack();
    await setLocalVideoTrack(rawVideo);
  } catch (err) {
    lastErr = err;
    camOn = false;
  }

  if (!localStream.getVideoTracks().length) camOn = false;
  if (localStream.getTracks().length === 0) {
    throw lastErr || new Error('Could not access camera or microphone.');
  }
  return localStream;
}

async function attachStreamToVideo(videoEl, stream) {
  if (!videoEl || !stream) return;

  videoEl.srcObject = stream;
  await new Promise((resolve) => {
    if (videoEl.readyState >= HTMLMediaElement.HAVE_METADATA) resolve();
    else videoEl.onloadedmetadata = () => resolve();
  });

  try {
    await videoEl.play();
  } catch (err) {
    console.warn('Video playback failed:', err);
  }
}

function syncControlButtons() {
  micBtn.classList.toggle('off', !micOn);
  micBtn.querySelector('.ctrl-label').textContent = micOn ? 'Mute' : 'Unmute';

  camBtn.classList.toggle('off', !camOn);
  camBtn.querySelector('.ctrl-label').textContent = camOn ? 'Stop Video' : 'Start Video';

  screenBtn.classList.toggle('active', screenSharing);
  screenBtn.querySelector('.ctrl-label').textContent = screenSharing ? 'Stop Share' : 'Share Screen';

  if (hdBtn) {
    hdBtn.classList.toggle('active', MeetVideoQuality.isEnhancementEnabled());
    hdBtn.querySelector('.ctrl-label').textContent = MeetVideoQuality.isEnhancementEnabled() ? 'HD+ On' : 'HD+ Off';
  }
}

function updateLocalVideoDisplay() {
  if (!localTileRefs) return;
  const showVideo = screenSharing || Boolean(cameraTrack && camOn && cameraTrack.enabled);
  localTileRefs.video.classList.toggle('hidden', !showVideo);
  localTileRefs.avatarWrap.classList.toggle('hidden', showVideo);
  syncControlButtons();
}

function updateGridLayout() {
  const n = peers.size + 1;
  videoGrid.dataset.count = String(n);
  videoGrid.className = 'video-grid';
  if (n === 1) videoGrid.classList.add('solo');
  else if (n === 2) videoGrid.classList.add('duo');
  else if (n === 3) videoGrid.classList.add('trio');
  else if (n === 4) videoGrid.classList.add('quad');
  else videoGrid.classList.add('many');
}

function updateParticipantCount() {
  const n = peers.size + 1;
  participantCountEl.textContent = n === 1 ? '1 participant' : `${n} participants`;
  updateGridLayout();
}

// ===================== Join flow =====================
if (myName) {
  overlayNameInput.value = myName;
  if (userNameDisplay) userNameDisplay.textContent = myName;
}
nameOverlay.classList.remove('hidden');
showSecureContextWarning();

async function enterMeeting(skipMedia) {
  const name = overlayNameInput.value.trim();
  if (!name) {
    mediaStatus.textContent = 'Please enter your name.';
    mediaStatus.classList.add('error');
    return;
  }

  myName = name;
  localStorage.setItem('meet-name', myName);
  if (userNameDisplay) userNameDisplay.textContent = myName;
  overlayJoinBtn.disabled = true;
  overlayJoinNoMediaBtn.disabled = true;
  clearMediaError();

  const configError = await window.HuddlaceEnv?.ensureBackendConfigured?.();
  if (configError) {
    mediaStatus.textContent = configError;
    mediaStatus.classList.add('error');
    overlayJoinBtn.disabled = false;
    overlayJoinNoMediaBtn.disabled = false;
    return;
  }

  if (skipMedia) {
    localStream = new MediaStream();
    cameraTrack = null;
    camOn = false;
    micOn = false;
  } else {
    mediaStatus.textContent = 'Requesting camera and microphone…';
    try {
      localStream = await acquireLocalMedia();
      cameraTrack = rawCameraTrack;
      if (cameraTrack) {
        previewWrap.classList.remove('hidden');
        await attachStreamToVideo(previewVideo, localStream);
        mediaStatus.textContent = 'Camera ready. Joining meeting…';
      } else if (localStream.getAudioTracks().length) {
        mediaStatus.textContent = 'Microphone only — joining without camera.';
      } else {
        mediaStatus.textContent = 'Joining without camera or microphone.';
      }
    } catch (err) {
      showMediaError(err);
      overlayJoinBtn.disabled = false;
      overlayJoinNoMediaBtn.disabled = false;
      return;
    }
  }

  nameOverlay.classList.add('hidden');
  await createLocalTile();
  connectSocket();
  syncControlButtons();
}

async function joinMeeting() {
  await enterMeeting(false);
}

async function joinWithoutMedia() {
  await enterMeeting(true);
}

overlayJoinBtn.addEventListener('click', joinMeeting);
overlayJoinNoMediaBtn.addEventListener('click', joinWithoutMedia);
overlayNameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') joinMeeting();
});

// ===================== Tiles =====================
function initials(name) {
  return name.trim().split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();
}

function avatarColor(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function createTile(peerId, name, isLocal) {
  const tile = document.createElement('div');
  tile.className = 'tile' + (isLocal ? ' local-tile' : ' remote-tile');
  tile.id = 'tile-' + peerId;

  const video = document.createElement('video');
  video.autoplay = true;
  video.playsInline = true;
  video.setAttribute('playsinline', '');
  video.setAttribute('autoplay', '');
  if (isLocal) {
    video.muted = true;
    video.setAttribute('muted', '');
  }
  tile.appendChild(video);

  const avatarWrap = document.createElement('div');
  avatarWrap.className = 'avatar-wrap hidden';
  const avatar = document.createElement('div');
  avatar.className = 'avatar';
  avatar.textContent = initials(name);
  avatar.style.background = avatarColor(name);
  avatarWrap.appendChild(avatar);
  tile.appendChild(avatarWrap);

  const label = document.createElement('div');
  label.className = 'label';
  const nameSpan = document.createElement('span');
  nameSpan.className = 'name';
  nameSpan.textContent = isLocal ? `${name} (You)` : name;
  const mutedIcon = document.createElement('span');
  mutedIcon.className = 'muted-icon hidden';
  mutedIcon.textContent = '🔇';
  label.appendChild(nameSpan);
  label.appendChild(mutedIcon);
  tile.appendChild(label);

  videoGrid.appendChild(tile);
  return { tile, video, avatarWrap, avatar, nameSpan, mutedIcon };
}

async function createLocalTile() {
  localTileRefs = createTile('local', myName, true);
  if (cameraTrack || screenSharing) {
    await attachStreamToVideo(localTileRefs.video, screenSharing ? screenStream : localStream);
  }
  updateLocalVideoDisplay();
  updateParticipantCount();
}

function addVideoTrackToPeers(track, screenShare = false) {
  peers.forEach((entry) => {
    if (!entry.pc) return;
    const sender = entry.pc.getSenders().find((s) => s.track?.kind === 'video');
    if (sender) {
      sender.replaceTrack(track).then(() => {
        MeetVideoQuality.configureSender(sender, { screenShare });
      });
    } else {
      entry.pc.addTrack(track, localStream);
      MeetVideoQuality.configurePeerConnection(entry.pc, { screenShare });
    }
  });
}

// ===================== Socket / signaling =====================
function queueIceCandidate(peerId, candidate) {
  if (!pendingIceCandidates.has(peerId)) pendingIceCandidates.set(peerId, []);
  pendingIceCandidates.get(peerId).push(candidate);
}

async function flushIceCandidates(peerId, pc) {
  const queued = pendingIceCandidates.get(peerId) || [];
  pendingIceCandidates.delete(peerId);
  for (const candidate of queued) {
    try {
      await pc.addIceCandidate(candidate);
    } catch (e) {
      console.warn('ICE candidate failed:', e);
    }
  }
}

async function addRemoteIceCandidate(peerId, entry, candidate) {
  if (!entry?.pc || !candidate) return;
  if (entry.pc.remoteDescription) {
    try {
      await entry.pc.addIceCandidate(candidate);
    } catch (e) {
      console.warn('ICE candidate failed:', e);
    }
  } else {
    queueIceCandidate(peerId, candidate);
  }
}

function connectSocket() {
  const serverUrl = apiBase() || undefined;
  const socketOpts = window.HuddlaceEnv?.socketOptions?.(serverUrl) || {
    transports: ['polling', 'websocket'],
    path: '/socket.io/',
  };

  socket = serverUrl ? io(serverUrl, socketOpts) : io(socketOpts);

  socket.on('connect_error', (err) => {
    nameOverlay.classList.remove('hidden');
    overlayJoinBtn.disabled = false;
    overlayJoinNoMediaBtn.disabled = false;
    if (mediaStatus) {
      const hint = serverUrl
        ? `Cannot reach meeting server at ${serverUrl}. On the home page, save your Render URL under "Meeting server URL", or wake Render from its dashboard.`
        : 'Cannot connect to the meeting server. Go back and save your Render API URL on the home page.';
      mediaStatus.textContent = hint;
      mediaStatus.classList.add('error');
    }
    console.warn('Socket connect_error:', err?.message || err);
  });

  socket.on('connect', () => {
    socket.emit('join-room', { roomId, name: myName }, (response) => {
      if (!response || response.error) {
        nameOverlay.classList.remove('hidden');
        overlayJoinBtn.disabled = false;
        overlayJoinNoMediaBtn.disabled = false;
        if (mediaStatus) {
          mediaStatus.textContent = response?.error || 'Could not join the meeting room.';
          mediaStatus.classList.add('error');
        }
        return;
      }
      const { peers: existingPeers, selfId: id } = response;
      selfId = id;
      existingPeers.forEach((p) => ensurePeerEntry(p.id, p.name));
      broadcastMediaState();
    });
  });

  socket.on('peer-joined', ({ id, name }) => {
    if (id === selfId) return;
    connectToPeer(id, name, true);
  });

  socket.on('signal', async ({ from, data }) => {
    if (data.type === 'offer') {
      const name = data.name || 'Guest';
      const entry = connectToPeer(from, name, false);
      await entry.pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
      await flushIceCandidates(from, entry.pc);
      const answer = await entry.pc.createAnswer();
      await entry.pc.setLocalDescription(answer);
      await MeetVideoQuality.configurePeerConnection(entry.pc, { screenShare: screenSharing });
      socket.emit('signal', { to: from, data: { type: 'answer', sdp: answer } });
    } else if (data.type === 'answer') {
      const entry = peers.get(from);
      if (entry) {
        await entry.pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
        await flushIceCandidates(from, entry.pc);
        await MeetVideoQuality.configurePeerConnection(entry.pc, { screenShare: screenSharing });
      }
    } else if (data.type === 'candidate') {
      const entry = peers.get(from);
      if (entry && data.candidate) {
        await addRemoteIceCandidate(from, entry, data.candidate);
      }
    }
  });

  socket.on('peer-left', ({ id }) => {
    const entry = peers.get(id);
    if (entry) {
      entry.pc.close();
      entry.tile.remove();
      peers.delete(id);
      pendingIceCandidates.delete(id);
      updateParticipantCount();
    }
  });

  socket.on('peer-media-state', ({ id, audio, video }) => {
    const entry = peers.get(id);
    if (!entry) return;
    entry.mutedIcon.classList.toggle('hidden', audio !== false);
    entry.avatarWrap.classList.toggle('hidden', video !== false);
    entry.video.classList.toggle('hidden', video === false);
  });

  socket.on('chat-message', async ({ from, name, payload }) => {
    const text = await MeetCrypto.decryptPayload(payload);
    appendChatMessage(name, text, from === selfId);
  });
}

function ensurePeerEntry(id, name) {
  if (peers.has(id)) return peers.get(id);
  const refs = createTile(id, name, false);
  const entry = { pc: null, name, ...refs };
  peers.set(id, entry);
  updateParticipantCount();
  return entry;
}

function connectToPeer(id, name, isInitiator) {
  let entry = peers.get(id);
  if (!entry) entry = ensurePeerEntry(id, name);
  if (entry.pc) return entry;

  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  entry.pc = pc;

  localStream.getTracks().forEach((track) => pc.addTrack(track, localStream));
  MeetVideoQuality.configurePeerConnection(pc, { screenShare: screenSharing });

  pc.onicecandidate = (e) => {
    if (e.candidate) socket.emit('signal', { to: id, data: { type: 'candidate', candidate: e.candidate } });
  };

  pc.ontrack = (e) => {
    if (e.streams[0]) attachStreamToVideo(entry.video, e.streams[0]);
  };

  if (isInitiator) {
    (async () => {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await MeetVideoQuality.configurePeerConnection(pc, { screenShare: screenSharing });
      socket.emit('signal', { to: id, data: { type: 'offer', sdp: offer, name: myName } });
    })();
  }

  return entry;
}

// ===================== Controls =====================
function broadcastMediaState() {
  if (socket) socket.emit('media-state', { audio: micOn, video: camOn, screenSharing });
}

micBtn.addEventListener('click', () => {
  micOn = !micOn;
  localStream.getAudioTracks().forEach((t) => { t.enabled = micOn; });
  syncControlButtons();
  broadcastMediaState();
});

camBtn.addEventListener('click', async () => {
  if (!camOn && !cameraTrack) {
    try {
      const raw = await MeetVideoQuality.acquireVideoTrack();
      await setLocalVideoTrack(raw);
    } catch (err) {
      const { message } = formatMediaError(err);
      window.alert(message + '\n\nCheck macOS Privacy settings and allow Camera for your browser, then reload the page.');
      return;
    }
  }

  camOn = !camOn;
  if (rawCameraTrack) rawCameraTrack.enabled = camOn;
  updateLocalVideoDisplay();
  broadcastMediaState();
});

screenBtn.addEventListener('click', async () => {
  if (!screenSharing) {
    try {
      screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } },
        audio: false,
      });
    } catch (err) {
      return;
    }
    const screenTrack = screenStream.getVideoTracks()[0];
    if ('contentHint' in screenTrack) screenTrack.contentHint = 'motion';
    await setLocalVideoTrack(screenTrack, { enhance: false, screenShare: true });
    screenSharing = true;
    updateLocalVideoDisplay();
    screenTrack.onended = stopScreenShare;
  } else {
    stopScreenShare();
  }
  broadcastMediaState();
});

async function stopScreenShare() {
  if (!screenSharing) return;
  if (screenStream) screenStream.getTracks().forEach((t) => t.stop());
  screenStream = null;
  screenSharing = false;
  if (rawCameraTrack) await setLocalVideoTrack(rawCameraTrack);
  updateLocalVideoDisplay();
  broadcastMediaState();
}

function replaceOutgoingVideoTrack(newTrack, screenShare = false) {
  peers.forEach((entry) => {
    if (!entry.pc) return;
    const sender = entry.pc.getSenders().find((s) => s.track?.kind === 'video');
    if (sender) {
      sender.replaceTrack(newTrack).then(() => {
        MeetVideoQuality.configureSender(sender, { screenShare });
      });
    }
  });
}

if (hdBtn) {
  hdBtn.addEventListener('click', async () => {
    const next = !MeetVideoQuality.isEnhancementEnabled();
    MeetVideoQuality.setEnhancementEnabled(next);
    if (rawCameraTrack && !screenSharing) {
      await setLocalVideoTrack(rawCameraTrack, { enhance: next });
    }
    syncControlButtons();
  });
}

chatBtn.addEventListener('click', () => {
  document.getElementById('chatPanel').classList.toggle('hidden');
});

document.getElementById('closeChatBtn').addEventListener('click', () => {
  document.getElementById('chatPanel').classList.add('hidden');
});

leaveBtn.addEventListener('click', () => {
  if (socket) socket.emit('leave-room');
  peers.forEach((entry) => entry.pc && entry.pc.close());
  stopEnhancer();
  if (localStream) localStream.getTracks().forEach((t) => t.stop());
  if (screenStream) screenStream.getTracks().forEach((t) => t.stop());
  window.location.href = '/';
});

document.getElementById('copyLinkBtn').addEventListener('click', () => {
  navigator.clipboard.writeText(window.location.href).then(() => {
    const btn = document.getElementById('copyLinkBtn');
    const original = btn.textContent;
    btn.textContent = 'Copied!';
    setTimeout(() => { btn.textContent = original; }, 1500);
  });
});

document.getElementById('copyCodeBtn').addEventListener('click', () => {
  navigator.clipboard.writeText(roomId).then(() => {
    const btn = document.getElementById('copyCodeBtn');
    const original = btn.textContent;
    btn.textContent = 'Copied!';
    setTimeout(() => { btn.textContent = original; }, 1500);
  });
});

// ===================== Chat =====================
function appendChatMessage(name, text, isSelf) {
  const panel = document.getElementById('chatMessages');
  const el = document.createElement('div');
  el.className = 'chat-msg';
  const who = document.createElement('div');
  who.className = 'who';
  who.textContent = isSelf ? 'You' : name;
  const body = document.createElement('div');
  body.textContent = text;
  el.appendChild(who);
  el.appendChild(body);
  panel.appendChild(el);
  panel.scrollTop = panel.scrollHeight;
}

document.getElementById('chatSendBtn').addEventListener('click', sendChat);
document.getElementById('chatInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') sendChat();
});

async function sendChat() {
  const input = document.getElementById('chatInput');
  const text = input.value.trim();
  if (!text || !socket) return;
  if (!MeetCrypto.isReady()) {
    appendChatMessage('System', 'Chat encryption is not available in this browser.', false);
    return;
  }
  try {
    const payload = await MeetCrypto.encryptText(text);
    socket.emit('chat-message', { payload });
    input.value = '';
  } catch {
    appendChatMessage('System', 'Could not send encrypted message.', false);
  }
}

window.addEventListener('beforeunload', () => {
  if (socket) socket.emit('leave-room');
});
