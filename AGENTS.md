# Konvensi proyek SmartLoundry

- Buat halaman HTML langsung di akar proyek. Jangan membuat folder proyek bertingkat dan jangan mengubah `../smart-laundry-pos`.
- Simpan semua CSS di `css/style.css`; pisahkan aturan dasar, pelanggan, dan panel operasional dengan komentar bagian yang jelas.
- Kelompokkan JavaScript berdasarkan fungsi di `js/`: konfigurasi di `konfigurasi.js`, data contoh di `data-contoh.js`, dan interaksi halaman di file bernama sesuai halaman.
- Simpan gambar di `assets/images/`, ikon di `assets/icons/`, dan font di `assets/fonts/`. Gunakan nama file yang menjelaskan isinya.
- Gunakan HTML, CSS, dan JavaScript biasa untuk frontend. Jangan menambahkan framework frontend. Kerjakan backend atau database hanya jika pengguna memintanya pada tahap berikutnya.
- Simpan Python Flask dalam `backend/catalog_api/` dan `backend/order_api/` sesuai pemilik data. Simpan SQL inisialisasi di `db/` dan tes di `tests/`. Jangan membuat Order API membaca tabel katalog secara langsung.
- Tetap tandai data contoh dan aksi yang menunggu API dengan jelas. Jangan menyatakan simulasi browser sebagai transaksi yang tersimpan.
- Saat mengubah UI, periksa halaman pelanggan dan panel operasional pada ukuran ponsel, tablet, dan desktop serta browser yang tersedia.
