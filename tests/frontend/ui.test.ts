import { describe, expect, it } from 'vitest';
import { esc, fmtNum, fmtDateId } from '../../static/js/ui.js';

describe('esc', () => {
  it('meng-escape tag HTML', () => {
    expect(esc('<script>alert(1)</script>')).toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('meng-escape kutip untuk atribut', () => {
    expect(esc('a"b\'c')).toBe('a&quot;b&#39;c');
  });

  it('mengubah null dan undefined menjadi string kosong', () => {
    expect(esc(null)).toBe('');
    expect(esc(undefined)).toBe('');
  });

  it('mengubah angka menjadi string tanpa escape tambahan', () => {
    expect(esc(1500000)).toBe('1500000');
  });
});

describe('fmtNum', () => {
  it('memakai pemisah ribuan titik', () => {
    expect(fmtNum(1500000)).toBe('1.500.000');
  });

  it('memakai koma untuk desimal', () => {
    expect(fmtNum(1234.5)).toBe('1.234,5');
  });

  it('mengembalikan nol untuk input tidak valid', () => {
    expect(fmtNum(null)).toBe('0');
  });
});

describe('fmtDateId', () => {
  it('memformat tanggal Indonesia menjadi d-M-yyyy', () => {
    expect(fmtDateId('2026-09-21')).toBe('21-9-2026');
  });

  it('mengembalikan input apa adanya bila tidak berbentuk tanggal', () => {
    expect(fmtDateId('bukan tanggal')).toBe('bukan tanggal');
  });
});

describe('labelDari / petaMaster', () => {
  it('kode supir/kendaraan diterjemahkan, nama dibiarkan', async () => {
    const { labelDari, petaMaster } = await import('../../static/js/ui.js');
    const p = petaMaster({ drivers: [{ id: 'DRV-1', nama: 'Agus' }], vehicles: [{ vehicle_id: 'V-1', plat_nomor: ' D 1 A ' }] });
    expect(labelDari('DRV-1', p.supir)).toBe('Agus');
    expect(labelDari('Aria Hendrata', p.supir)).toBe('Aria Hendrata');
    expect(labelDari('V-1', p.kendaraan)).toBe('D 1 A');
    expect(labelDari('', p.supir)).toBe('');
    expect(labelDari('X', petaMaster(null).supir)).toBe('X');
  });
});

describe('tombolIkon', () => {
  it('ikon & kelas per jenis aksi', async () => {
    const { IKON_AKSI } = await import('../../static/js/ui.js');
    expect(IKON_AKSI.edit).toEqual(['bi-pencil', 'btn-outline-primary']);
    expect(IKON_AKSI.hapus![0]).toBe('bi-trash');
    expect(IKON_AKSI.nonaktif![0]).toBe('bi-slash-circle');
  });
});

describe('tampilkanGalat', () => {
  const kotakTiruan = () => {
    const kelas = new Set(['alert', 'd-none']);
    const attr: Record<string, string> = {};
    const panggilan: string[] = [];
    const box: any = {
      textContent: '',
      classList: { remove: (k: string) => kelas.delete(k) },
      setAttribute: (k: string, v: string) => { attr[k] = v; },
      scrollIntoView: (o: any) => panggilan.push(`scroll:${o?.behavior}`),
      focus: (o: any) => panggilan.push(`focus:${o?.preventScroll}`),
    };
    return { box, kelas, attr, panggilan };
  };

  it('mengisi pesan, menampilkan kotak, dan memfokuskan tanpa role alert (fokus sudah dibacakan)', async () => {
    const { tampilkanGalat } = await import('../../static/js/ui.js');
    const { box, kelas, attr, panggilan } = kotakTiruan();
    tampilkanGalat(box, 'KM wajib diisi.');
    expect(box.textContent).toBe('KM wajib diisi.');
    expect(kelas.has('d-none')).toBe(false);
    expect(attr.role).toBeUndefined();
    expect(attr.tabindex).toBe('-1');
    expect(panggilan).toEqual(['scroll:smooth', 'focus:true']);
  });

  it('prefers-reduced-motion: gulir tanpa animasi', async () => {
    const { tampilkanGalat } = await import('../../static/js/ui.js');
    const g = globalThis as any;
    const asli = g.matchMedia;
    g.matchMedia = (q: string) => ({ matches: q === '(prefers-reduced-motion: reduce)' });
    try {
      const { box, panggilan } = kotakTiruan();
      tampilkanGalat(box, 'x');
      expect(panggilan[0]).toBe('scroll:auto');
    } finally {
      g.matchMedia = asli;
    }
  });

  it('tanpa pesan: isi kotak yang sudah dibangun tidak ditimpa', async () => {
    const { tampilkanGalat } = await import('../../static/js/ui.js');
    const box: any = { textContent: 'isi lama', classList: { remove() {} }, setAttribute() {} };
    tampilkanGalat(box);
    expect(box.textContent).toBe('isi lama');
  });
});

describe('idUntukLabel', () => {
  it('idUntukLabel memakai id yang ada atau membuat id unik', async () => {
    const { idUntukLabel } = await import('../../static/js/ui.js');
    expect(idUntukLabel({ id: 'f-km' } as any)).toBe('f-km');
    const a = { id: '', setAttribute(k: string, v: string) { (this as any)[k] = v; } } as any;
    const id1 = idUntukLabel(a);
    expect(id1).toMatch(/^fld-\d+$/);
    expect(a.id).toBe(id1);
    const b = { id: '', setAttribute(k: string, v: string) { (this as any)[k] = v; } } as any;
    expect(idUntukLabel(b)).not.toBe(id1);
  });
});

describe('jenisToast', () => {
  it('memetakan jenis Bootstrap ke gaya toast; tak dikenal jadi info', async () => {
    const { jenisToast } = await import('../../static/js/ui.js');
    expect(jenisToast('danger')).toBe('error');
    expect(jenisToast('error')).toBe('error');
    expect(jenisToast('warning')).toBe('warning');
    expect(jenisToast('success')).toBe('success');
    expect(jenisToast('aneh')).toBe('info');
    expect(jenisToast(undefined)).toBe('info');
  });
});

describe('teksRupiah', () => {
  it('teksRupiah memformat nominal id-ID', async () => {
    const { teksRupiah } = await import('../../static/js/ui.js');
    expect(teksRupiah('150000')).toBe('= Rp 150.000');
    expect(teksRupiah('1500000')).toBe('= Rp 1.500.000');
    expect(teksRupiah('')).toBe('');
    expect(teksRupiah('abc')).toBe('');
    expect(teksRupiah(null)).toBe('');
    expect(teksRupiah(undefined)).toBe('');
  });
});

describe('tambahKeterangan', () => {
  it('menambah id ke aria-describedby tanpa menimpa nilai lama atau menggandakan', async () => {
    const { tambahKeterangan } = await import('../../static/js/ui.js');
    const attr: Record<string, string> = {};
    const k: any = { getAttribute: (n: string) => attr[n] ?? null, setAttribute: (n: string, v: string) => { attr[n] = v; } };
    tambahKeterangan(k, 'ket-1');
    expect(attr['aria-describedby']).toBe('ket-1');
    tambahKeterangan(k, 'ket-2');
    expect(attr['aria-describedby']).toBe('ket-1 ket-2');
    tambahKeterangan(k, 'ket-1');
    expect(attr['aria-describedby']).toBe('ket-1 ket-2');
  });
});
