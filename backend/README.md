# Backend Laundry Mr Andy

## Pemilik data

- Catalog API memiliki `catalog.services`. Endpoint publik `GET /api/services` hanya mengembalikan layanan aktif. Pengelola memakai `GET /api/services?include_inactive=true`, `POST /api/services`, dan `PATCH /api/services/{id}` lewat port admin.
- Order API memiliki seluruh tabel `ordering`: pelanggan, order, item, pembayaran, dan pengeluaran. Ketika order dibuat, layanan aktif dibaca **melalui HTTP** dari Catalog API. Nama dan harga pada item disimpan sebagai snapshot. ID UUID order juga berfungsi sebagai kode lacak; endpoint publik mengembalikan status tanpa data pelanggan atau pembayaran.
- Keduanya masih memakai **satu instance PostgreSQL sebagai infrastruktur bersama**. Role `catalog_app` hanya boleh membaca/menulis skema `catalog`; role `order_app` hanya boleh membaca/menulis skema `ordering`.

## Compose dan jaringan

Dari akar proyek, jalankan `python3 scripts/setup_env.py` sekali sebelum `docker compose up --build -d`. Tiga password acak disimpan di `.env` lokal dengan izin pemilik saja; Compose meneruskannya melalui environment server. Jangan masukkan `.env` ke Git, image, HTML, atau JavaScript. Lima service yang berjalan ialah `db`, `catalog-api`, `order-api-a`, `order-api-b`, dan `web`. Hanya `web` memiliki pemetaan port host: `8080` publik dan `127.0.0.1:8081` admin. API serta database tetap di jaringan internal Compose. Nginx mengarahkan Order API ke A utama dan B cadangan. `GET /healthz` pada tiap API memeriksa tabel miliknya di database; healthcheck web juga memeriksa katalog publik dan daftar order melalui proxy. Respons Order API berisi `instance_id` dan header `X-Instance-ID` yang diteruskan Nginx. Healthcheck container tidak menggantikan failover pasif Nginx.

Nginx memblokir halaman POS dan API pengelola di port publik. Port publik hanya membuka `GET /api/services` dan `GET /api/track?code=<UUID>`; yang kedua hanya menampilkan status pengerjaan dan perkiraan selesai. Untuk melihat instance yang melayani melalui port admin:

```bash
curl -si http://127.0.0.1:8081/api/orders
```

Migrasi `db/001_init.sql` dijalankan otomatis **hanya ketika volume PostgreSQL baru dibuat**. Pada volume yang sudah ada, jalankan ulang migrasi secara eksplisit bila SQL berubah:

```bash
docker compose exec -T db psql -U postgres -d laundry -v ON_ERROR_STOP=1 < db/001_init.sql
```

SQL memakai `CREATE IF NOT EXISTS` dan seed `ON CONFLICT DO NOTHING`, sehingga tidak menimpa layanan yang sudah diubah atau transaksi yang tersimpan. Volume `pgdata` mempertahankan data ketika container aplikasi dimulai ulang.

Jika memperbarui instalasi yang memiliki volume database dari versi lama dengan password contoh, jalankan migrasi ulang sebelum mengandalkan API. SQL ini juga menyamakan password role database dengan `.env` baru dan tidak menghapus transaksi. Gunakan `docker compose exec -T db psql -U postgres -d laundry -v ON_ERROR_STOP=1 < db/001_init.sql` setelah database hidup. Simpan password `.env` secara aman; menggantinya tanpa menjalankan migrasi role akan memutus koneksi API.

## Backup dan restore PostgreSQL

Backup online ke folder lokal yang diabaikan Git:

```bash
mkdir -p backups
docker compose exec -T db pg_dump -U postgres -d laundry -Fc --no-owner > backups/laundry.dump
```

Untuk memulihkan, hentikan aplikasi yang menulis data, lalu kembalikan dump ke database yang telah tersedia. **Restore mengganti data saat ini**; simpan backup terbaru terlebih dahulu dan kerjakan pada waktu layanan dihentikan:

```bash
docker compose stop web catalog-api order-api-a order-api-b
docker compose exec -T db pg_restore -U postgres -d laundry --clean --if-exists --no-owner --exit-on-error < backups/laundry.dump
docker compose start catalog-api order-api-a order-api-b web
```

Jaga file dump dan `.env` di tempat privat. Uji restore secara berkala pada database terpisah sebelum memerlukannya untuk pemulihan nyata.

## Kontrak API

Semua permintaan tulis memakai `Content-Type: application/json`; nominal adalah bilangan bulat rupiah. Galat memakai JSON `{"error":"..."}` dengan kode HTTP yang sesuai.

| API | Endpoint | Fungsi |
| --- | --- | --- |
| Catalog | `GET /healthz` | Kesehatan proses dan database |
| Catalog | `GET /api/services` | Layanan aktif; query `include_inactive=true` hanya melalui admin |
| Catalog | `POST /api/services`, `PATCH /api/services/{id}` | Kelola layanan dan harga |
| Order | `GET /healthz` | Kesehatan, `instance_id`, dan header `X-Instance-ID` |
| Order | `GET /api/track?code=<UUID>` | Lacak status publik tanpa data pribadi; kode diberikan pengelola setelah order dicatat |
| Order | `GET/POST /api/customers`, `PATCH /api/customers/{id}` | Pelanggan |
| Order | `GET/POST /api/orders`, `GET /api/orders/{id}` | Order dan detail |
| Order | `PATCH /api/orders/{id}/status` | Status pengerjaan |
| Order | `POST /api/orders/{id}/payments` | Pembayaran |
| Order | `GET /api/orders/{id}/receipt` | Data struk |
| Order | `GET/POST /api/expenses` | Pengeluaran |
| Order | `GET /api/reports/summary?from=YYYY-MM-DD&to=YYYY-MM-DD` | Ringkasan laporan |

`POST /api/orders` wajib memakai `client_order_id` unik per niat membuat order. Pengulangan isi yang sama mengembalikan order lama; isi berbeda dengan ID sama mendapat `409`. Browser tidak mengirim total sebagai sumber kebenaran. Kg boleh pecahan positif maksimal tiga desimal; item harus bilangan bulat positif. Order dan semua item disimpan dalam satu transaksi database. Pembayaran tidak boleh melebihi total. Status `belum_bayar`/`dp`/`lunas` dihitung dari jumlah pembayaran.

Label status pengerjaan di POS memakai istilah **Antre → Diproses → Siap diambil → Selesai**. Nilai API lama tetap `baru → diproses → selesai → diambil` agar data yang telah tersimpan tidak perlu diubah.

## Tes integrasi PostgreSQL

Buat database tes tersendiri satu kali, lalu jalankan migrasi:

```bash
docker compose exec -T db createdb -U postgres laundry_test
docker compose exec -T db psql -U postgres -d laundry_test -v ON_ERROR_STOP=1 < db/001_init.sql
```

Jalankan tes dari image API, tanpa membuka port database ke host. Variabel URL tes disiapkan di environment shell dan diteruskan ke container tanpa menuliskan password dalam argumen Docker:

```bash
set -a
. ./.env
TEST_ADMIN_DATABASE_URL="postgresql://postgres:${POSTGRES_PASSWORD}@db:5432/laundry_test"
TEST_CATALOG_DATABASE_URL="postgresql://catalog_app:${CATALOG_DB_PASSWORD}@db:5432/laundry_test"
TEST_ORDER_DATABASE_URL="postgresql://order_app:${ORDER_DB_PASSWORD}@db:5432/laundry_test"
set +a
docker compose run --rm -T --no-deps \
  -v "$PWD/tests:/app/tests:ro" \
  -e TEST_ADMIN_DATABASE_URL \
  -e TEST_CATALOG_DATABASE_URL \
  -e TEST_ORDER_DATABASE_URL \
  catalog-api python -m pytest -q tests
unset TEST_ADMIN_DATABASE_URL TEST_CATALOG_DATABASE_URL TEST_ORDER_DATABASE_URL
```

Tes integrasi hanya menerima database bernama akhir `_test` dan membersihkan transaksi tes di database tersebut. Tes memeriksa snapshot harga via HTTP, total server, DP/lunas, pembayaran bersamaan, rollback order/item/pembayaran saat gagal, idempotensi, dan batas akses role PostgreSQL. Jalankan `node tests/whatsapp.mjs` untuk memeriksa normalisasi nomor dan encoding pesan WhatsApp.
