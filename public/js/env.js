/**
 * Shared deployment helpers for local dev, Render (full stack), and Vercel + Render (split).
 */
window.HuddlaceEnv = (function () {
  const LOCAL_HOSTS = ['localhost', '127.0.0.1', '[::1]'];
  const STORAGE_KEY = 'huddlace-backend-url';
  const STATIC_FRONTEND_HOSTS = ['huddlance.com', 'www.huddlance.com'];

  let sameOriginApiAvailable = null;

  function isLocalDev() {
    return LOCAL_HOSTS.includes(window.location.hostname);
  }

  function isSplitFrontend() {
    const host = window.location.hostname.toLowerCase();
    if (STATIC_FRONTEND_HOSTS.includes(host)) return true;
    return host.endsWith('.vercel.app') || host.endsWith('.vercel.sh');
  }

  function normalizeUrl(raw) {
    return String(raw || '').trim().replace(/\/$/, '');
  }

  function readConfigBackend() {
    return normalizeUrl(window.HUDDLACE_CONFIG?.serverUrl);
  }

  function readMetaBackend() {
    const meta = document.querySelector('meta[name="huddlace-backend"]');
    return normalizeUrl(meta?.content);
  }

  function readStoredBackend() {
    try {
      return normalizeUrl(localStorage.getItem(STORAGE_KEY));
    } catch {
      return '';
    }
  }

  function readQueryBackend() {
    return normalizeUrl(new URLSearchParams(window.location.search).get('api'));
  }

  function apiBase() {
    return readConfigBackend() || readMetaBackend() || readStoredBackend() || readQueryBackend() || '';
  }

  function saveBackend(url) {
    const clean = normalizeUrl(url);
    try {
      if (clean) localStorage.setItem(STORAGE_KEY, clean);
      else localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore private browsing storage errors
    }
    return clean;
  }

  function usesSameOriginBackend() {
    return !apiBase();
  }

  function requiresRemoteBackend() {
    if (isLocalDev()) return false;
    if (apiBase()) return true;
    return isSplitFrontend();
  }

  async function fetchJson(url) {
    try {
      const res = await fetch(url, { mode: 'cors', cache: 'no-store' });
      const contentType = res.headers.get('content-type') || '';
      if (!res.ok) {
        return { ok: false, status: res.status, error: `HTTP ${res.status}` };
      }
      if (!contentType.includes('application/json')) {
        return { ok: false, status: res.status, error: 'Server returned HTML instead of JSON (wrong URL or CORS?)' };
      }
      const data = await res.json();
      return { ok: true, data };
    } catch (err) {
      return { ok: false, error: err?.message || 'Network error — check BACKEND_URL and wake Render' };
    }
  }

  async function probeSameOriginApi() {
    if (sameOriginApiAvailable !== null) return sameOriginApiAvailable;
    const result = await fetchJson('/health');
    sameOriginApiAvailable = Boolean(result.ok && result.data?.ok);
    return sameOriginApiAvailable;
  }

  async function probeRemoteApi(base) {
    const url = normalizeUrl(base);
    if (!url) return false;
    const result = await fetchJson(`${url}/health`);
    return Boolean(result.ok && result.data?.ok);
  }

  async function resolveApiBase() {
    const configured = apiBase();
    if (configured) return configured;
    if (await probeSameOriginApi()) return '';
    return '';
  }

  async function ensureBackendConfigured() {
    const configured = apiBase();
    if (configured) {
      const ok = await probeRemoteApi(configured);
      if (!ok) {
        return (
          `Cannot reach ${configured}. Check the URL, or open your Render dashboard and wake the service.`
        );
      }
      return null;
    }

    if (await probeSameOriginApi()) return null;

    if (isSplitFrontend()) {
      return (
        'Meeting server URL required. Paste your Render API URL below, or set BACKEND_URL on Vercel for huddlance.com and redeploy.'
      );
    }

    return (
      'Meeting server URL required. Paste your Render API URL below, or open the app from your Render URL.'
    );
  }

  async function createRoomOnServer(base) {
    const newUrl = base ? `${base}/new` : '/new';
    const attempts = base ? 3 : 1;

    for (let i = 0; i < attempts; i += 1) {
      const result = await fetchJson(newUrl);
      if (result.ok && result.data?.roomId) {
        return { roomId: result.data.roomId, error: null };
      }
      if (i < attempts - 1) {
        await new Promise((r) => setTimeout(r, 2500));
      } else {
        const detail = result.error || 'Unknown error';
        const wakeHint = base
          ? ` Open ${base} in a new tab to wake Render, then try again.`
          : '';
        return {
          roomId: null,
          error: `Could not create meeting (${detail}).${wakeHint}`,
        };
      }
    }

    return { roomId: null, error: 'Could not create meeting.' };
  }

  function socketOptions(serverUrl) {
    return {
      transports: ['polling', 'websocket'],
      path: '/socket.io/',
      withCredentials: Boolean(serverUrl),
      reconnectionAttempts: 10,
      timeout: 20000,
    };
  }

  function iceServers() {
    return [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      {
        urls: [
          'turn:openrelay.metered.ca:80',
          'turn:openrelay.metered.ca:443',
          'turn:openrelay.metered.ca:443?transport=tcp',
        ],
        username: 'openrelayproject',
        credential: 'openrelayproject',
      },
    ];
  }

  return {
    isLocalDev,
    isSplitFrontend,
    apiBase,
    saveBackend,
    usesSameOriginBackend,
    requiresRemoteBackend,
    probeSameOriginApi,
    probeRemoteApi,
    resolveApiBase,
    ensureBackendConfigured,
    createRoomOnServer,
    socketOptions,
    iceServers,
  };
})();
