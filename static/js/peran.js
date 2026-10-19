// Helper role frontend (murni, bisa dites tanpa DOM). Server tetap penentu akses sebenarnya.
const norm = (role) => String(role ?? '').trim().toUpperCase();

export const isSuper = (role) => norm(role) === 'SUPERADMIN';
export const isManagement = (role) => norm(role) === 'MANAGEMENT';
export const lihatSemuaCabang = (role) => isSuper(role) || isManagement(role);
export const bolehTulis = (role) => !isManagement(role);

// Rute yang tidak relevan/terlarang untuk MANAGEMENT (read-only, bukan SUPERADMIN).
const RUTE_TERLARANG_MANAGEMENT = [
  /^\/input$/, /^\/edit\/.+$/, /^\/jalur\/buat$/, /^\/jalur\/edit\/.+$/,
  /^\/flazz\/topup$/, /^\/flazz\/rekon$/, /^\/pengaturan$/, /^\/audit$/,
];

export function ruteDilarang(role, hash) {
  if (!isManagement(role)) return false;
  const path = String(hash || '').replace(/^#/, '').split('?')[0];
  return RUTE_TERLARANG_MANAGEMENT.some((re) => re.test(path));
}

// Item tanpa `peran` terlihat semua role; grup tanpa item tersisa dibuang.
export function saringMenu(nav, role) {
  const r = norm(role);
  const boleh = (it) => !it.peran || it.peran.includes(r);
  return nav
    .map((item) => (item.items ? { ...item, items: item.items.filter(boleh) } : item))
    .filter((item) => (item.items ? item.items.length > 0 : boleh(item)));
}
