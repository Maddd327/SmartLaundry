// Ubah nomor tujuan WhatsApp hanya di sini. Gunakan format internasional tanpa tanda +.
export const WHATSAPP_NUMBER = "628213194417";

export function normalizeWhatsappNumber(value) {
  if (typeof value !== 'string') return null;
  const compact = value.replace(/[\s().-]/g, '');
  const normalized = compact.startsWith('+62') ? compact.slice(1)
    : compact.startsWith('08') ? `62${compact.slice(1)}` : compact;
  return /^628\d{8,12}$/.test(normalized) ? normalized : null;
}

export const whatsappLink = (message = "") =>
  `https://wa.me/${WHATSAPP_NUMBER}${message ? `?text=${encodeURIComponent(message)}` : ""}`;
