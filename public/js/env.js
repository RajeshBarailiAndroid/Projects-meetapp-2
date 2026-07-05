/**
 * Shared deployment helpers for local dev, Render (full stack), and Vercel + Render (split).
 */
window.HuddlaceEnv = (function () {
  const LOCAL_HOSTS = ['localhost', '127.0.0.1', '[::1]'];

  function isLocalDev() {
    return LOCAL_HOSTS.includes(window.location.hostname);
  }

  function isSplitFrontend() {
    return window.location.hostname.endsWith('.vercel.app');
  }

  function readConfigBackend() {
    return (window.HUDDLACE_CONFIG?.serverUrl || '').trim().replace(/\/$/, '');
  }

  function readMetaBackend() {
    const meta = document.querySelector('meta[name="huddlace-backend"]');
    return (meta?.content || '').trim().replace(/\/$/, '');
  }

  function readQueryBackend() {
    const q = new URLSearchParams(window.location.search).get('api');
    return (q || '').trim().replace(/\/$/, '');
  }

  function apiBase() {
    return readConfigBackend() || readMetaBackend() || readQueryBackend() || '';
  }

  function requiresRemoteBackend() {
    return isSplitFrontend() && !isLocalDev();
  }

  function ensureBackendConfigured() {
    if (!requiresRemoteBackend()) return null;
    if (apiBase()) return null;
    return (
      'Meeting server is not linked. In Vercel → Settings → Environment Variables, set ' +
      'BACKEND_URL to your Render API URL (e.g. https://your-app.onrender.com), then redeploy.'
    );
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
    requiresRemoteBackend,
    ensureBackendConfigured,
    socketOptions,
    iceServers,
  };
})();
