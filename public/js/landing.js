const nameInput = document.getElementById('nameInput');
const codeInput = document.getElementById('codeInput');
const errorMsg = document.getElementById('errorMsg');
const createSection = document.getElementById('createSection');
const createdSection = document.getElementById('createdSection');
const generatedCodeEl = document.getElementById('generatedCode');
const createBtn = document.getElementById('createBtn');
const startMeetingBtn = document.getElementById('startMeetingBtn');
const createAnotherBtn = document.getElementById('createAnotherBtn');
const copyGeneratedCodeBtn = document.getElementById('copyGeneratedCodeBtn');
const joinBtn = document.getElementById('joinBtn');
const serverSection = document.getElementById('serverSection');
const serverUrlInput = document.getElementById('serverUrlInput');
const saveServerBtn = document.getElementById('saveServerBtn');
const serverStatus = document.getElementById('serverStatus');

let pendingRoomId = null;

nameInput.value = localStorage.getItem('meet-name') || '';

const urlCode = new URLSearchParams(window.location.search).get('code');
if (urlCode) codeInput.value = normalizeCode(urlCode);

function normalizeCode(raw) {
  return String(raw || '').trim().toLowerCase().replace(/[^a-f0-9]/g, '');
}

function showError(msg) {
  errorMsg.textContent = msg;
  errorMsg.classList.remove('hidden');
}

function clearError() {
  errorMsg.textContent = '';
  errorMsg.classList.add('hidden');
}

function saveName() {
  localStorage.setItem('meet-name', nameInput.value.trim());
}

function getNameOrError() {
  const name = nameInput.value.trim();
  if (!name) {
    showError('Enter your name first.');
    return null;
  }
  return name;
}

function goToRoom(roomId, name) {
  window.location.href = `/room.html?room=${encodeURIComponent(roomId)}&name=${encodeURIComponent(name)}`;
}

function showCreatedCode(roomId) {
  pendingRoomId = roomId;
  generatedCodeEl.textContent = roomId;
  createSection.classList.add('hidden');
  createdSection.classList.remove('hidden');
  codeInput.value = roomId;
  clearError();
}

function resetCreateView() {
  pendingRoomId = null;
  generatedCodeEl.textContent = '';
  createSection.classList.remove('hidden');
  createdSection.classList.add('hidden');
}

async function copyText(text, btn, doneLabel) {
  try {
    await navigator.clipboard.writeText(text);
    const original = btn.textContent;
    btn.textContent = doneLabel;
    setTimeout(() => { btn.textContent = original; }, 1500);
  } catch {
    showError('Could not copy — please copy the code manually.');
  }
}

function apiBase() {
  return window.HuddlaceEnv?.apiBase?.() || (window.HUDDLACE_CONFIG?.serverUrl || '').replace(/\/$/, '');
}

function generateRoomId() {
  const bytes = crypto.getRandomValues(new Uint8Array(4));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function setServerStatus(message, ok) {
  if (!serverStatus) return;
  serverStatus.textContent = message;
  serverStatus.classList.remove('hidden', 'ok', 'bad');
  serverStatus.classList.add(ok ? 'ok' : 'bad');
}

async function saveAndTestServer() {
  clearError();
  const url = serverUrlInput?.value?.trim();
  if (!url) {
    setServerStatus('Enter your Render API URL first.', false);
    return false;
  }

  window.HuddlaceEnv.saveBackend(url);
  saveServerBtn.disabled = true;
  saveServerBtn.textContent = 'Testing…';

  const ok = await window.HuddlaceEnv.probeRemoteApi(url);
  saveServerBtn.disabled = false;
  saveServerBtn.textContent = 'Save & test server';

  if (ok) {
    setServerStatus('Server connected. You can create or join meetings now.', true);
    return true;
  }

  setServerStatus(
    'Could not reach that server. Check the URL and make sure Render is running (free tier may sleep — open the URL once to wake it).',
    false,
  );
  return false;
}

async function initServerSection() {
  if (!serverSection) return;

  const configured = apiBase();
  if (configured && serverUrlInput) serverUrlInput.value = configured;

  const sameOrigin = await window.HuddlaceEnv.probeSameOriginApi();
  const needsInput = !window.HuddlaceEnv.isLocalDev() && !sameOrigin;

  if (needsInput || configured) {
    serverSection.classList.remove('hidden');
  }

  if (configured) {
    const ok = await window.HuddlaceEnv.probeRemoteApi(configured);
    setServerStatus(
      ok ? 'Meeting server connected.' : 'Saved server URL is not responding. Check Render or update the URL.',
      ok,
    );
  } else if (needsInput) {
    setServerStatus('Paste your Render API URL and click Save & test server.', false);
  }
}

async function createRoomId() {
  let base = await window.HuddlaceEnv.resolveApiBase();

  if (!base && serverUrlInput?.value?.trim()) {
    const saved = await saveAndTestServer();
    if (!saved) {
      throw new Error('Save a working Render API URL before creating a meeting.');
    }
    base = apiBase();
  }

  const configError = await window.HuddlaceEnv.ensureBackendConfigured();
  if (configError) throw new Error(configError);

  base = await window.HuddlaceEnv.resolveApiBase();
  const created = await window.HuddlaceEnv.createRoomOnServer(base);
  if (created.roomId) return created.roomId;

  if (window.HuddlaceEnv.isLocalDev()) {
    return generateRoomId();
  }

  if (serverSection) serverSection.classList.remove('hidden');

  throw new Error(
    created.error ||
      'Could not create a meeting. Paste your Render API URL above, click Save & test server, then try again.',
  );
}

createBtn.addEventListener('click', async () => {
  if (!getNameOrError()) return;
  clearError();
  createBtn.disabled = true;
  createBtn.textContent = 'Generating…';

  try {
    const roomId = await createRoomId();
    saveName();
    showCreatedCode(roomId);
  } catch (err) {
    showError(err.message || 'Could not create meeting. Try again.');
  } finally {
    createBtn.disabled = false;
    createBtn.textContent = 'Create new meeting';
  }
});

startMeetingBtn.addEventListener('click', () => {
  const name = getNameOrError();
  if (!name || !pendingRoomId) return;
  saveName();
  goToRoom(pendingRoomId, name);
});

createAnotherBtn.addEventListener('click', () => {
  resetCreateView();
  codeInput.value = '';
});

copyGeneratedCodeBtn.addEventListener('click', () => {
  if (!pendingRoomId) return;
  copyText(pendingRoomId, copyGeneratedCodeBtn, 'Copied!');
});

joinBtn.addEventListener('click', async () => {
  const name = getNameOrError();
  if (!name) return;

  if (serverUrlInput?.value?.trim() && !apiBase()) {
    const saved = await saveAndTestServer();
    if (!saved) return;
  }

  const configError = await window.HuddlaceEnv.ensureBackendConfigured();
  if (configError) return showError(configError);

  const code = normalizeCode(codeInput.value);
  if (!code) return showError('Enter a meeting code.');
  if (code.length < 4) return showError('Meeting code looks too short. Check and try again.');

  saveName();
  clearError();
  goToRoom(code, name);
});

saveServerBtn?.addEventListener('click', async () => {
  await saveAndTestServer();
});

codeInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') joinBtn.click();
});

nameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !createdSection.classList.contains('hidden')) {
    startMeetingBtn.click();
  } else if (e.key === 'Enter') {
    createBtn.click();
  }
});

initServerSection();
