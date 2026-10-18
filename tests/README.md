# Pengujian alur lengkap

Skrip browser memakai Playwright sebagai **alat tes saja**; frontend produksi tetap HTML, CSS, dan JavaScript biasa. Jalankan skrip tulis hanya pada stack lokal yang memakai **database uji terpisah**. `E2E_ALLOW_WRITES=1` adalah pengaman untuk menghindari penulisan tanpa sengaja, bukan pengganti database uji. `browser_public.mjs` mengharapkan katalog berisi tiga layanan awal dan belum ada order; jalankan sebelum tes admin.

Jika Playwright belum terpasang, jalankan `npm install` dan `npx playwright install chromium firefox webkit`. Atur `PUBLIC_URL` dan `ADMIN_URL` jika port uji berbeda dari `8080`/`8081`.

Urutan perintah pada stack uji:

```bash
export PUBLIC_URL=http://127.0.0.1:8080
export ADMIN_URL=http://127.0.0.1:8081
python3 scripts/check_gateway.py --public "$PUBLIC_URL" --admin "$ADMIN_URL"
node tests/whatsapp.mjs
npm run test:browser:public
E2E_ALLOW_WRITES=1 npm run test:browser:admin
npm run test:browser:tracking
E2E_ALLOW_WRITES=1 npm run test:browser:request
npm run test:browser:quality
# Hentikan Order API A pada stack uji, misalnya: docker compose stop order-api-a
E2E_ALLOW_WRITES=1 npm run test:browser:failover
# Jalankan kembali A, lalu periksa order yang dibuat B tetap terbaca.
```

Tes PostgreSQL dengan URL tes serta migrasi dijelaskan di [backend/README.md](../backend/README.md). Skrip browser admin membuat dua order uji, satu pelanggan, satu layanan, dan satu pengeluaran. Skrip tracking membaca kode dari order uji itu. Skrip `browser_request` menyimpan permintaan pelanggan dari website dan memeriksa bahwa pelanggan/order terlihat di POS, status awal menunggu konfirmasi, kode lacak muncul, serta WhatsApp berisi pesan siap kirim. Skrip failover membuat satu order tambahan. File `tests/.e2e-state.json` berisi ID uji dan diabaikan Git.

## Hasil pemeriksaan 18 Oktober 2026 (tahap sebelum permintaan publik)

Lingkungan uji lokal: Nginx pada `127.0.0.1:18080` dan `127.0.0.1:18081`, dua Flask Order API, Catalog API, PostgreSQL database `laundry_test`, Playwright 1.64.1.

| Pemeriksaan | Hasil |
| --- | --- |
| `python -m pytest -q tests` dengan tiga URL database tes | Lulus, 12 tes; termasuk privasi dan pembaruan status pelacakan publik |
| `node tests/whatsapp.mjs` | Lulus: normalisasi nomor dan encoding pesan |
| `python3 scripts/check_gateway.py --public http://127.0.0.1:18080 --admin http://127.0.0.1:18081` | Lulus: port publik menolak POS dan API transaksi |
| `npm run test:browser:public` | Lulus pada versi sebelumnya: tiga layanan/harga API; kg dan item; URL WhatsApp; nol order dibuat |
| `npm run test:browser:admin` | Lulus: katalog, pelanggan, dua item/order, DP/lunas, status, struk, pengeluaran/laporan, idempotensi |
| `npm run test:browser:tracking` | Lulus: kode dari POS/struk menampilkan status database di Chromium, Firefox, WebKit pada 320/768/1440 px |
| `npm run test:browser:quality` | Lulus: Chromium, Firefox, WebKit pada 320/375/768/1440 px; tidak ada overflow atau galat JS; label, keyboard, fokus, loading, kosong, error/retry |
| `npm run test:browser:failover` setelah A dihentikan | Lulus: POS membuat/membaca order dan endpoint lacak publik menjawab melalui B; header `X-Instance-ID: order-api-b` |
| `docker compose config --quiet` | Lulus |
| `docker compose up --build -d` pada clone demo | Lulus: `db`, `catalog-api`, `order-api-a`, `order-api-b`, dan `web` berstatus healthy |
| Failover container Compose | Lulus: `stop order-api-a` memberi admin `200` dan lacak publik `422` dari B; setelah `start order-api-a`, admin `200` dari A |

PDF struk juga dibuat dengan cetak browser Chromium; teks layanan, total Rp58.000, dan status Lunas terbaca dari PDF. Setelah A dijalankan lagi, A membaca tiga order uji yang sama dari PostgreSQL.
Setelah proses PostgreSQL lokal dihentikan dan dijalankan lagi dengan direktori data yang sama, A dan B masing-masing tetap membaca ketiga order tersebut.

**Batas pengujian:** alur dengan order nyata dan kode lacak valid diuji pada database tes terpisah melalui Nginx/Flask/PostgreSQL lokal. Failover container Compose diuji pada clone demo dengan permintaan baca dan validasi; database demo tidak diisi transaksi uji. Dialog cetak fisik dan pengiriman pesan WhatsApp tidak diuji: aplikasi hanya menyiapkan URL chat, dan pelanggan sendiri yang menekan kirim.
