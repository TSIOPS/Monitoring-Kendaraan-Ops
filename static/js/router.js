import { isLoggedIn, setUser, clearSession } from './store.js';
import { get } from './api.js';

const routes = [];
let params = {};

export function registerRoute(pattern, loader, options = {}) {
  const names = [];
  const regexSrc = pattern
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/:(\w+)/g, (_, name) => {
      names.push(name);
      return '([^/]+)';
    });
  routes.push({ regex: new RegExp(`^${regexSrc}$`), loader, names, guard: options.guard !== false });
}

export function getRouteParam(name) {
  return params[name] ?? '';
}

function matchRoute(hash) {
  const path = (hash || '#/login').replace(/^#/, '');
  return routes.find((r) => r.regex.test(path)) || null;
}

async function run(hash) {
  const view = document.getElementById('view');
  if (!view) return;

  const found = matchRoute(hash);
  if (!found) {
    window.location.hash = '#/transaksi';
    return;
  }

  if (found.guard && !isLoggedIn()) {
    window.location.hash = '#/login';
    return;
  }

  const path = (hash || '#/login').replace(/^#/, '');
  const m = found.regex.exec(path);
  params = {};
  found.names.forEach((name, i) => {
    params[name] = decodeURIComponent(m[i + 1] || '');
  });

  view.replaceChildren();
  try {
    const page = await found.loader();
    await page.render(view);
  } catch (err) {
    const box = document.createElement('div');
    box.className = 'alert alert-danger';
    box.textContent = err.message || 'Halaman gagal dimuat.';
    view.replaceChildren(box);
  }
}

export function navigate(hash) {
  if (window.location.hash === hash) {
    run(hash);
  } else {
    window.location.hash = hash;
  }
}

export function startRouter() {
  window.addEventListener('hashchange', () => run(window.location.hash));
  run(window.location.hash);
}

export async function ensureSession() {
  if (!isLoggedIn()) {
    window.location.hash = '#/login';
    return null;
  }
  try {
    const data = await get('/api/session');
    const user = data.user || null;
    if (user) setUser(user);
    return user;
  } catch (err) {
    if (err.status === 401) clearSession();
    window.location.hash = '#/login';
    return null;
  }
}
