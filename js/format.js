export const rupiah = (value) => new Intl.NumberFormat('id-ID', {
  style: 'currency', currency: 'IDR', maximumFractionDigits: 0,
}).format(Number(value) || 0);

export function durasi(minutes) {
  if (minutes % 1440 === 0) return `${minutes / 1440} hari`;
  if (minutes % 60 === 0) return `${minutes / 60} jam`;
  return `${minutes} menit`;
}

export function tanggal(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('id-ID', {
    day:'numeric', month:'short', year:'numeric', timeZone:'Asia/Jakarta',
  }).format(new Date(value));
}

export function tanggalWaktu(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('id-ID', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
    timeZone: 'Asia/Jakarta',
  }).format(new Date(value));
}

export function tanggalInput(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('id-ID', {
    day:'numeric', month:'long', year:'numeric', timeZone:'UTC',
  }).format(new Date(`${value}T12:00:00Z`));
}

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;',
  })[character]);
}
