const TOKEN_KEY = 'm6.token';
const USER_KEY = 'm6.user';

export function getToken() {
  return localStorage.getItem(TOKEN_KEY) || '';
}

export function setToken(token) {
  localStorage.setItem(TOKEN_KEY, String(token || ''));
}

export function getUser() {
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    localStorage.removeItem(USER_KEY);
    return null;
  }
}

export function setUser(user) {
  localStorage.setItem(USER_KEY, JSON.stringify(user || null));
}

export function isLoggedIn() {
  return Boolean(getToken());
}

export function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  // Reset tanpa notifikasi: listener tidak boleh menggambar topbar untuk session yang baru dihapus.
  jumlahPeringatan = 0;
}

export function logout() {
  clearSession();
  if (window.location.hash !== '#/login') {
    window.location.hash = '#/login';
  }
}

let jumlahPeringatan = 0;
const peringatanListeners = new Set();

export function setJumlahPeringatan(n) {
  jumlahPeringatan = Math.max(0, Number(n || 0));
  peringatanListeners.forEach((fn) => fn(jumlahPeringatan));
}

export function getJumlahPeringatan() {
  return jumlahPeringatan;
}

export function onPeringatanChange(fn) {
  peringatanListeners.add(fn);
  return () => peringatanListeners.delete(fn);
}
