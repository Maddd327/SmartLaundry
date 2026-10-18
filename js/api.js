// Kedua halaman memanggil path relatif. Port publik hanya membuka GET katalog
// aktif dan status order via kode; port admin mem-proxy seluruh API pengelola.
export const CATALOG_API = '';
export const ORDER_API = '';

export async function apiRequest(base, path, options = {}) {
  let response;
  try {
    response = await fetch(`${base}${path}`, {
      ...options,
      headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers },
      signal: options.signal || AbortSignal.timeout(15000),
    });
  } catch (error) {
    throw new Error(error.name === 'TimeoutError'
      ? 'API tidak merespons. Periksa server lalu coba lagi.'
      : 'Tidak dapat terhubung ke API. Periksa server lalu coba lagi.');
  }
  let data;
  try { data = await response.json(); }
  catch { throw new Error('Respons API bukan JSON yang valid.'); }
  if (!response.ok) throw new Error(data.error || `Permintaan gagal (HTTP ${response.status}).`);
  return data;
}

export const catalogRequest = (path, options) => apiRequest(CATALOG_API, path, options);
export const orderRequest = (path, options) => apiRequest(ORDER_API, path, options);
