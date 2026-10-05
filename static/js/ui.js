export function esc(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function fmtNum(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '0';
  return n.toLocaleString('id-ID', { maximumFractionDigits: 2 });
}

export function fmtDateId(value) {
  const raw = String(value ?? '');
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return raw;
  return `${Number(m[3])}-${Number(m[2])}-${m[1]}`;
}

export function fmtDate(value) {
  const raw = String(value ?? '');
  const ms = Date.parse(raw);
  if (Number.isNaN(ms)) return fmtDateId(raw);
  return new Date(ms).toLocaleDateString('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === 'class') node.className = String(value);
    else if (key === 'text') node.textContent = String(value);
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value);
    else if (value !== null && value !== undefined) node.setAttribute(key, String(value));
  }
  for (const child of Array.isArray(children) ? children : [children]) {
    if (child === null || child === undefined) continue;
    node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

export function toast(message, kind = 'info') {
  let host = document.getElementById('toast-host');
  if (!host) {
    host = el('div', { id: 'toast-host', class: 'toast-host' });
    document.body.appendChild(host);
  }
  const node = el('div', { class: `toast-item toast-${kind}`, text: message });
  host.appendChild(node);
  setTimeout(() => node.remove(), kind === 'error' ? 8000 : 4000);
}

export function confirmDialog(message) {
  return window.confirm(message);
}

export function spinner(view, text = 'Memuat data') {
  view.replaceChildren(el('div', { class: 'loading text-muted', text }));
}
