import { el } from './ui.js';

// Meteran bensin untuk indikator jarum (port buildFuelGauge/buildFuelGaugeMotor/levelSlider GAS):
// busur E-F + jarum yang mengikuti slider 0-100%. Nilai disimpan ke input bar_* (persen).
// Beda dengan GAS: slider mulai "belum diisi" (input kosong) agar lupa menggeser tidak
// tersimpan sebagai 0% (tangki kosong).

export function jenisMeteran(jenisKendaraan) {
  return String(jenisKendaraan || '').toLowerCase() === 'motor' ? 'motor' : 'mobil';
}

export function persenJarum(v) {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : null;
}

// Warna level mengikuti GAS: < 25% merah, < 50% oranye, selebihnya hijau.
export function warnaLevel(v) {
  return v < 25 ? '#dc3545' : v < 50 ? '#fd7e14' : '#198754';
}

function svgMobil() {
  const cx = 60, cy = 60, r = 46;
  const pt = (pct, rad) => {
    const a = Math.PI * (1 - pct / 100);
    return [(cx + rad * Math.cos(a)).toFixed(1), (cy - rad * Math.sin(a)).toFixed(1)];
  };
  const arc = `M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`;
  const merah = pt(12.5, r);
  const ticks = [0, 25, 50, 75, 100].map((p) => {
    const a = pt(p, r - 8), b = pt(p, r + 1);
    return `<line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" stroke="#6c757d" stroke-width="${p % 50 === 0 ? 2 : 1.2}"/>`;
  }).join('');
  return `<svg viewBox="0 0 120 72" width="100%" style="max-width:190px;display:block;margin:0 auto">` +
    `<path d="${arc}" fill="none" stroke="#e9ecef" stroke-width="8" stroke-linecap="round"/>` +
    `<path d="M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${merah[0]} ${merah[1]}" fill="none" stroke="#f5c2c7" stroke-width="8"/>` +
    `<path class="fg-level" d="${arc}" pathLength="100" fill="none" stroke="#198754" stroke-width="8" stroke-linecap="round" stroke-dasharray="0 100" style="transition:stroke-dasharray .2s,stroke .2s"/>` +
    ticks +
    `<text x="${cx - r}" y="${cy + 11}" text-anchor="middle" font-size="9" font-weight="700" fill="#dc3545">E</text>` +
    `<text x="${cx}" y="${cy - r + 18}" text-anchor="middle" font-size="8" fill="#6c757d">½</text>` +
    `<text x="${cx + r}" y="${cy + 11}" text-anchor="middle" font-size="9" font-weight="700" fill="#198754">F</text>` +
    `<line class="fg-needle" x1="${cx}" y1="${cy}" x2="${cx - r + 10}" y2="${cy}" stroke="#dc3545" stroke-width="2.5" stroke-linecap="round" style="transform-origin:${cx}px ${cy}px;transform-box:view-box;transition:transform .2s"/>` +
    `<circle cx="${cx}" cy="${cy}" r="4.5" fill="#343a40"/></svg>`;
}

function svgMotor() {
  const cx = 60, cy = 80, r = 44;
  const pt = (pct, rad) => {
    const a = Math.PI * (135 - pct * 0.9) / 180;
    return [(cx + rad * Math.cos(a)).toFixed(1), (cy - rad * Math.sin(a)).toFixed(1)];
  };
  const p0 = pt(0, r), p100 = pt(100, r);
  const arc = `M ${p0[0]} ${p0[1]} A ${r} ${r} 0 0 1 ${p100[0]} ${p100[1]}`;
  const ticks = [0, 12.5, 25, 37.5, 50, 62.5, 75, 87.5, 100].map((p) => {
    const besar = p % 50 === 0;
    const a = pt(p, r - (besar ? 11 : 7)), b = pt(p, r);
    return `<line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" stroke="${p <= 25 ? '#ff4d4d' : '#f8f9fa'}" stroke-width="${besar ? 2.2 : 1.4}"/>`;
  }).join('');
  const eTxt = pt(-9, r - 4), fTxt = pt(109, r - 4), ujung = pt(0, r - 3);
  const pompa = '<g transform="translate(55 57)" fill="none" stroke="#f8f9fa" stroke-width="1.2">' +
    '<rect x="0" y="0" width="7" height="10" rx="1"/><line x1="1.5" y1="3" x2="5.5" y2="3"/>' +
    '<path d="M7 3 h2 v5 a1 1 0 0 0 2 0 v-6 l-2 -2"/></g>';
  return `<svg viewBox="8 22 104 68" width="100%" style="max-width:190px;display:block;margin:0 auto">` +
    `<rect x="8" y="22" width="104" height="68" rx="10" fill="#212529"/>` +
    `<path d="${arc}" fill="none" stroke="#495057" stroke-width="3"/>` +
    `<path class="fg-level" d="${arc}" pathLength="100" fill="none" stroke="#198754" stroke-width="3" stroke-dasharray="0 100" style="transition:stroke-dasharray .2s,stroke .2s"/>` +
    ticks + pompa +
    `<text x="${eTxt[0]}" y="${Number(eTxt[1]) + 3}" text-anchor="middle" font-size="9" font-weight="700" fill="#ff4d4d">E</text>` +
    `<text x="${fTxt[0]}" y="${Number(fTxt[1]) + 3}" text-anchor="middle" font-size="9" font-weight="700" fill="#f8f9fa">F</text>` +
    `<line class="fg-needle" x1="${cx}" y1="${cy}" x2="${ujung[0]}" y2="${ujung[1]}" stroke="#ff6a00" stroke-width="3" stroke-linecap="round" style="transform-origin:${cx}px ${cy}px;transform-box:view-box;transition:transform .2s"/>` +
    `<circle cx="${cx}" cy="${cy}" r="5" fill="#343a40" stroke="#6c757d" stroke-width="1"/></svg>`;
}

// input = field bar_* (type number) yang dikirim ke server; komponen menulis persen ke sana.
export function meteranBensin(input, label) {
  const gambar = el('div', { class: 'meteran-gambar', 'aria-hidden': 'true' });
  const nilai = el('span', { class: 'meteran-nilai', text: 'Belum diisi' });
  const slider = el('input', {
    class: 'form-range', type: 'range', min: '0', max: '100', step: '1', value: '50',
    'aria-label': label, 'aria-valuetext': 'Belum diisi',
  });
  const wadah = el('div', { class: 'meteran belum' }, [
    gambar,
    el('div', { class: 'd-flex justify-content-between align-items-center small fw-bold' }, [
      el('span', { class: 'text-danger', text: 'E' }), nilai, el('span', { class: 'text-success', text: 'F' }),
    ]),
    slider,
    el('div', { class: 'form-text', text: 'Geser sesuai posisi jarum: 0% = E (kosong), 100% = F (penuh).' }),
  ]);
  let jenis = '';

  function gambarUlang(v) {
    const jarum = gambar.querySelector('.fg-needle');
    const level = gambar.querySelector('.fg-level');
    const p = v ?? 0;
    if (jarum) {
      jarum.style.transform = `rotate(${p * (jenis === 'motor' ? 0.9 : 1.8)}deg)`;
      jarum.style.opacity = v === null ? '0' : '1';
    }
    if (level) {
      level.setAttribute('stroke-dasharray', `${p} 100`);
      level.setAttribute('stroke-opacity', v && v > 0 ? '1' : '0');
      level.setAttribute('stroke', warnaLevel(p));
    }
  }

  function set(v) {
    const p = persenJarum(v);
    input.value = p === null ? '' : String(p);
    wadah.classList.toggle('belum', p === null);
    nilai.textContent = p === null ? 'Belum diisi' : `${p}%`;
    slider.setAttribute('aria-valuetext', nilai.textContent);
    if (p !== null) slider.value = String(p);
    gambarUlang(p);
  }

  slider.addEventListener('input', () => {
    set(slider.value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });

  return {
    elemen: wadah,
    set,
    setJenis(jenisKendaraan) {
      const baru = jenisMeteran(jenisKendaraan);
      if (baru !== jenis) {
        jenis = baru;
        gambar.innerHTML = baru === 'motor' ? svgMotor() : svgMobil();
      }
      set(input.value);
    },
  };
}
