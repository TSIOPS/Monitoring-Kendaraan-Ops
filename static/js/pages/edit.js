import { get, put } from '../api.js';
import { getRouteParam } from '../router.js';
import { el, fmtNum, toast } from '../ui.js';

function opsiKartu(cards) {
  return cards.map((c) => ({
    value: c.id || c.card_id,
    label: `${c.card_name || c.card_number || c.id} (saldo ${fmtNum(c.last_balance || 0)})`,
  }));
}

function isiOpsi(select, items, placeholder) {
  select.replaceChildren(el('option', { value: '', text: placeholder }));
  for (const it of items) {
    select.appendChild(el('option', { value: String(it.value), text: String(it.label) }));
  }
}

// Kartu lama bisa hilang dari master (nonaktif atau pindah cabang); tetap tampilkan agar nilai tidak kosong diam-diam.
function pilihKartu(select, cardId) {
  const id = String(cardId || '');
  if (id && !Array.from(select.options).some((o) => o.value === id)) {
    select.appendChild(el('option', { value: id, text: `${id} (tidak ada di daftar kartu)` }));
  }
  select.value = id;
}

function cariTransaksi(transactions, id) {
  return transactions.find((t) => String(t.transaction_id) === String(id)) || null;
}

export async function renderEdit(view) {
  const id = getRouteParam('id');
  if (!id) {
    window.location.hash = '#/transaksi';
    return { ok: false };
  }

  view.replaceChildren(el('div', { class: 'text-muted', text: 'Memuat transaksi' }));

  let data;
  let master;
  try {
    [data, master] = await Promise.all([get('/api/dashboard'), get('/api/master')]);
  } catch (err) {
    view.replaceChildren(el('div', { class: 'alert alert-danger', text: err.message }));
    return { ok: false };
  }

  const rows = Array.isArray(data.transactions) ? data.transactions : [];
  const trx = cariTransaksi(rows, id);
  if (!trx) {
    view.replaceChildren(el('div', { class: 'alert alert-warning', text: 'Transaksi tidak ditemukan. Mungkin sudah dihapus.' }));
    return { ok: false };
  }

  const cards = Array.isArray(master.flazzCards) ? master.flazzCards : [];

  const metode = el('select', { class: 'form-select' }, [
    el('option', { value: 'TUNAI', text: 'Tunai' }),
    el('option', { value: 'FLAZZ', text: 'Flazz' }),
  ]);
  metode.value = trx.metode_pembayaran || 'TUNAI';

  const kartu = el('select', { class: 'form-select' });
  isiOpsi(kartu, opsiKartu(cards), '— tidak ada —');
  pilihKartu(kartu, trx.flazz_card_id);

  const biayaBbm = el('input', { class: 'form-control', type: 'number', value: String(trx.biaya_bbm ?? 0) });
  const biayaTol = el('input', { class: 'form-control', type: 'number', value: String(trx.toll ?? 0) });
  const metodeTol = el('select', { class: 'form-select' }, [
    el('option', { value: '', text: 'Sama seperti pembayaran BBM' }),
    el('option', { value: 'TUNAI', text: 'Tunai' }),
    el('option', { value: 'FLAZZ', text: 'Flazz' }),
  ]);
  metodeTol.value = trx.metode_toll || '';
  const kartuTol = el('select', { class: 'form-select' });
  isiOpsi(kartuTol, opsiKartu(cards), '— tidak ada —');
  pilihKartu(kartuTol, trx.flazz_card_id_toll);

  const alertBox = el('div', { class: 'alert alert-danger d-none' });
  const submit = el('button', { class: 'btn btn-primary', type: 'submit', text: 'Simpan Perubahan' });

  const baris = (label, kontrol, catatan = '') =>
    el('div', { class: 'mb-3' }, [
      el('label', { class: 'form-label', text: label }),
      kontrol,
      catatan ? el('div', { class: 'form-text', text: catatan }) : null,
    ]);

  const terkunci = (value) => el('input', { class: 'form-control', value: String(value || '-'), disabled: 'disabled' });

  const form = el('form', { novalidate: 'novalidate' }, [
    alertBox,
    el('div', { class: 'row' }, [
      el('div', { class: 'col-md-4' }, [baris('Kendaraan (tidak dapat diubah)', terkunci(trx.vehicle))]),
      el('div', { class: 'col-md-4' }, [baris('Tanggal (tidak dapat diubah)', terkunci(trx.tanggal))]),
      el('div', { class: 'col-md-4' }, [baris('Supir (tidak dapat diubah)', terkunci(trx.supir))]),
    ]),
    el('div', { class: 'row' }, [
      el('div', { class: 'col-md-4' }, [baris('Biaya BBM', biayaBbm)]),
      el('div', { class: 'col-md-4' }, [baris('Biaya tol', biayaTol)]),
      el('div', { class: 'col-md-4' }, [baris('Metode pembayaran', metode)]),
    ]),
    el('div', { class: 'row' }, [
      el('div', { class: 'col-md-6' }, [baris('Kartu Flazz (BBM)', kartu)]),
      el('div', { class: 'col-md-6' }, [baris('Metode tol', metodeTol)]),
    ]),
    el('div', { class: 'row' }, [el('div', { class: 'col-md-6' }, [baris('Kartu Flazz (tol)', kartuTol)])]),
    el('div', { class: 'd-flex gap-2' }, [
      submit,
      el('a', { class: 'btn btn-outline-secondary', href: '#/transaksi', text: 'Batal' }),
    ]),
  ]);

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    alertBox.classList.add('d-none');

    const values = {
      metode_pembayaran: metode.value,
      biaya_bbm: biayaBbm.value,
      biaya_toll: biayaTol.value,
      flazz_card_id: kartu.value,
      metode_toll: metodeTol.value,
      flazz_card_id_toll: kartuTol.value,
    };

    if (values.metode_pembayaran === 'FLAZZ' && !values.flazz_card_id) {
      alertBox.textContent = 'Pilih kartu Flazz untuk pembayaran.';
      alertBox.classList.remove('d-none');
      return;
    }

    submit.disabled = true;
    submit.textContent = 'Menyimpan';
    try {
      const res = await put(`/api/laporan/${encodeURIComponent(id)}`, values);
      toast(res.msg || 'Transaksi diperbarui.', 'success');
      window.location.hash = '#/transaksi';
    } catch (err) {
      alertBox.textContent = err.message || 'Gagal memperbarui transaksi.';
      alertBox.classList.remove('d-none');
      submit.disabled = false;
      submit.textContent = 'Simpan Perubahan';
    }
  });

  view.replaceChildren(
    el('div', { class: 'panel' }, [
      el('h2', { class: 'h6 mb-3', text: 'Edit Transaksi' }),
      el('div', {
        class: 'alert alert-info small',
        text: 'Hanya nilai pembayaran yang dapat diubah. KM, bar, liter, tanggal, dan supir terkunci pada mode edit.',
      }),
      form,
    ]),
  );

  return { ok: true };
}
