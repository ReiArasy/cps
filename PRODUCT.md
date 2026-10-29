# Cuanki POS & Shift Reconciliation

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Frontend Next.js App Router, TypeScript, Tailwind CSS, dan Lucide Icons. Backend Google Apps Script terikat ke satu file Google Sheets. Route Handler Next.js `/api/gas` meneruskan request ke Web App GAS agar browser membaca respons dari origin aplikasi sendiri.

## Users

- **Kasir outlet:** bekerja dari ponsel di booth take-away, sering pada malam hari dan dengan sinyal seluler yang tidak stabil. Pekerjaan utamanya menerima pembayaran cepat dan menutup shift dengan hitungan cup, kas, QRIS, serta pengeluaran.
- **Admin/owner:** mengelola katalog, HPP, PIN dan parameter biaya per cabang di Sheets; meninjau laporan laba dan selisih audit per tanggal/cabang.

## Product Purpose

POS multi-cabang dengan antrean transaksi lokal saat offline dan rekonsiliasi harian otomatis. Satu Google Sheets menjadi sumber data terpusat dengan skema ternormalisasi (`Master_Cabang`, `Master_Menu`, dan `Master_Kasir`) sehingga penambahan cabang, menu, maupun kasir dilakukan cukup 1 baris per entitas tanpa duplikasi data.

## Operating Context

1. Kasir masuk ke aplikasi melalui halaman **Login** menggunakan `username` dan `pin_code` 4–8 digit yang terdaftar di tab `Master_Kasir` pada Google Sheets (pembuatan akun hanya dilakukan di Sheets, bukan di aplikasi). Sesi bertanda tangan disimpan di perangkat sampai kedaluwarsa atau logout.
2. Sebelum berjualan, kasir membuka **Modal Buka Shift**, memilih cabang operasional (dari `Master_Cabang`), dan mengisi Modal Awal Kas serta Cup Bawa minimal 1 cup. Tidak ada restock selama shift.
3. Kasir menambah kuantitas menu aktif dari `Master_Menu`, memilih Tunai/QRIS, dan menekan **Bayar**. Untuk Tunai, sistem otomatis mengasumsikan **Uang Pas** (input uang diterima bersifat opsional untuk bantu hitung kembalian). Untuk QRIS, pembayaran wajib terkonfirmasi di aplikasi merchant.
4. Saat shift berjalan, layar **Shift** menampilkan **Total Pendapatan Tunai** dan **QRIS Sistem** beserta tombol **Tutup Shift**. Di dalam **Modal Tutup Shift**, kasir mencatat audit cup (`Cup Sisa`, `Cup Reject`), biaya operasional harian, dan `Total uang fisik di laci` (cash opname laci), memeriksa rincian rekonsiliasi sebelum tutup, mencentang validasi kebenaran data, lalu menekan **Kirim laporan tutup shift**.
5. Admin memfilter `Laporan_Admin` dan `Laporan_Menu` berdasarkan tanggal/cabang dan memeriksa `status_audit`.

## Capabilities and Constraints

- Tab database: `Master_Cabang`, `Master_Menu`, `Master_Kasir`, `Log_Transaksi`, `Rekap_Shift`, `Laporan_Admin`, dan `Laporan_Menu`.
- Fungsi `setupDatabase()` otomatis memigrasikan tab lama (`Master_Config`) ke `Master_Cabang` dan `Master_Menu`, serta membersihkan skema header yang berubah. Fungsi `resetDatabase()` tersedia untuk mengosongkan seluruh transaksi, shift, dan laporan kembali ke 0 data saat pengujian tanpa menghapus data master.
- SKU awal: `MN-AYM` Ayam Bawang Rp18.000/HPP Rp11.500; `MN-KRE` Kare Pedas Rp18.000/HPP Rp11.500; `MN-CKJ` Creamy Keju Rp20.000/HPP Rp18.500.
- Default cabang awal: gaji Rp50.000/hari dan sewa Rp26.000/hari. `daily_rent` disimpan sebagai alokasi harian; bila tarif sumbernya bulanan, admin mengisi hasil tarif bulanan / 30.
- Untuk cabang baru, tambahkan satu baris per SKU di `Master_Config`, ulangi `branch_id`, nama cabang, PIN, gaji dan sewa yang sama pada setiap baris, serta isi `is_active` dengan `TRUE`.
- `GET ?action=getConfig` memberi cabang aktif dan menu tanpa membuka PIN/HPP. `POST VALIDATE_PIN` memberi token sesi bertanda tangan; `OPEN_SHIFT`, `GET_SHIFT`, `CREATE_TRANSACTION`, dan `CLOSE_SHIFT` memerlukan token. Semua POST dikunci dengan `LockService.getScriptLock()`.
- Kirim POST browser sebagai `text/plain;charset=utf-8` berisi JSON. Ini menghindari preflight OPTIONS untuk request sederhana, tetapi Apps Script ContentService melakukan redirect dan tidak memberi kendali header CORS; akses respons lintas origin harus diuji pada deployment. Jika browser tidak dapat membaca respons, gunakan proxy same-origin di Vercel sebelum meluncurkan frontend.
- `trx_id` dan `shift_id` wajib stabil saat retry. Backend mengabaikan duplikat transaksi dan menolak tutup shift kedua untuk cabang/tanggal yang sama pada v1.
- Harga dan HPP dihitung ulang di server dari `Master_Config`; setiap item, harga, HPP, dan total disimpan sebagai snapshot di `Log_Transaksi`. Omset dan HPP seluruh SKU masuk ke laporan admin, dan rincian SKU masuk ke `Laporan_Menu`. Gaji/sewa harian disimpan sebagai snapshot di `Rekap_Shift`.
- PIN default `0000` hanya nilai awal setup dan wajib diganti. Pakai 6–8 digit bila memungkinkan; percobaan gagal dibatasi lima kali per 15 menit per cabang. PIN bersama tetap merupakan kontrol operasional ringan. Jangan bagikan akses edit Sheets ke kasir.
- Formula laporan: `QRIS = total transaksi QRIS`; `kas_sistem_tanpa_modal = penjualan tunai - operasional`; `total_penerimaan = kas_sistem_tanpa_modal + QRIS`; `laba_bersih = total_penerimaan - gaji - sewa - HPP`.
- Audit kas: `selisih_kas_laci = tunai_fisik_laci - (modal_awal + tunai_penerimaan)`. Audit cup: `cup_fisik - cup_sistem`. Status `SESUAI` hanya bila keduanya nol.

## Product Principles

1. **Bayar secepat mungkin:** harga, total, metode bayar dan kembalian harus terlihat sebelum konfirmasi.
2. **Gangguan sinyal tidak menghilangkan penjualan:** simpan ID dan payload transaksi lokal, kirim ulang sampai respons sukses, tampilkan status antrean.
3. **Angka dapat ditelusuri:** laporan berasal dari baris transaksi/shift dan snapshot harga/biaya pada waktunya.
4. **Cabang selalu eksplisit:** setiap transaksi, shift dan laporan memiliki `branch_id`.
5. **Selisih terlihat jelas:** kasir dan admin melihat beda cup serta kas, termasuk nilai nol yang memang nol.

## Evidence on Hand

- PRD: `PRD Sistem POS Multi-Cabang Cuanki.pdf` (3 halaman).
- Backend: `backend/Code.gs`. Frontend: `app/page.tsx`, `app/globals.css`, `app/api/gas/route.ts`. Aset merek dan foto produk belum tersedia; antarmuka memakai mark vektor sederhana tanpa foto rekaan. Deployment frontend belum dilakukan.

## Accessibility & Inclusion

Kasir memakai ponsel dengan satu tangan dalam cahaya redup. Kontrol utama perlu area sentuh minimal 48×48 px, label jelas, kontras teks cukup, fokus keyboard terlihat, serta status tidak hanya dibedakan oleh warna.
