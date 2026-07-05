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

createBtn.addEventListener('click', async () => {
  if (!getNameOrError()) return;
  clearError();
  createBtn.disabled = true;
  createBtn.textContent = 'Generating…';

  try {
    const res = await fetch('/new');
    if (!res.ok) throw new Error('Could not create meeting.');
    const { roomId } = await res.json();
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

joinBtn.addEventListener('click', () => {
  const name = getNameOrError();
  if (!name) return;

  const code = normalizeCode(codeInput.value);
  if (!code) return showError('Enter a meeting code.');
  if (code.length < 4) return showError('Meeting code looks too short. Check and try again.');

  saveName();
  clearError();
  goToRoom(code, name);
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
