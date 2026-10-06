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

// Potong daftar per halaman; nomor dibatasi ke rentang yang ada.
export function halaman(list, nomor, per = 10) {
  const total = Math.max(1, Math.ceil(list.length / per));
  const aktif = Math.min(Math.max(1, nomor), total);
  return { total, aktif, isi: list.slice((aktif - 1) * per, aktif * per) };
}

// Tombol « 1 2 3 » seperti renderDashPagination GAS; kosong bila hanya satu halaman.
export function navHalaman(total, aktif, keHalaman) {
  const wrap = el('div', { class: 'd-flex justify-content-center gap-1 flex-wrap mt-3' });
  if (total <= 1) return wrap;
  const tombol = (label, ke, sekarang = false, mati = false) => {
    const b = el('button', { type: 'button', class: `btn btn-sm ${sekarang ? 'btn-primary' : 'btn-outline-primary'}`, text: label });
    b.disabled = mati;
    b.addEventListener('click', () => keHalaman(ke));
    return b;
  };
  wrap.append(
    tombol('«', aktif - 1, false, aktif === 1),
    ...Array.from({ length: total }, (_, i) => tombol(String(i + 1), i + 1, i + 1 === aktif)),
    tombol('»', aktif + 1, false, aktif === total),
  );
  return wrap;
}
