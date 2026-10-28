# Design Direction — Cuanki POS

## Mode and sources

**Operate.** Kasir harus menyelesaikan transaksi dan tutup shift dengan sedikit langkah; admin harus membaca angka yang saling cocok. Sistem ini merujuk ke Impeccable `mode-operate`, `design-taste-frontend` bagian *App screens*, dan aturan tipografi, kontras tombol serta variasi komposisi dari `gpt-taste`. Aturan hero AIDA, bento, serta GSAP dari `gpt-taste` berlaku untuk halaman pemasaran dan tidak dipakai pada layar kerja POS.

Taste Skill menghasilkan gaya `true-black-flat` (seed `1180494385`) untuk layar kerja. Struktur permukaan datar dan penekanan data dipakai; palet arang hangat serta tombol aksi amber mengikuti arahan visual yang sudah ditetapkan dalam dokumen ini.

## Visual idea

Warna berangkat dari booth Cuanki Cep Bewok Express: dasar arang cabai panggang hangat, putih kuah kaldu, dan aksen merah sambal khas logo Cuanki. Identitas hadir melalui logo bundar resmi, palet merah-arang, huruf, ritme angka dan satu gerak khas: **strip rekonsiliasi** yang menyandingkan cup fisik dengan cup POS dan kas laci dengan kas sistem. Layar tetap memakai tab, tombol, input, daftar dan tabel web yang lazim.

## Tokens

| Role | Token | Value | Usage |
| --- | --- | --- | --- |
| Ground | `--bg` | `#161010` | Latar malam arang cabai hangat. |
| Raised surface | `--surface` | `#231919` | Panel kerja satu tingkat lebih terang. |
| Dividers | `--line` | `#4D3737` | Batas tipis dan fokus struktur. |
| Main text | `--ink` | `#FBF5F3` | Judul, angka, aksi. |
| Secondary text | `--muted` | `#D4C2BE` | Label dan bantuan yang tetap terbaca. |
| Primary action | `--action` | `#D91824` | Bayar dan aksi utama merah Cuanki; teks `#FFFFFF`. |
| Accent text / focus | `--action-text` | `#FF7D78` | Tautan aksi sekunder, tanda wajib, fokus, dan indikator aktif. |
| Positive | `--ok` | `#8FD0A2` | Sinkron/sesuai, selalu dengan teks status. |
| Warning | `--warn` | `#F5C469` | Antrean atau peringatan. |
| Error | `--error` | `#FF948A` | Selisih/gagal, selalu dengan teks dan angka. |

Tidak memakai gradasi ungu atau biru neon, glow, kartu metrik berikon, atau warna dekoratif pada setiap panel. Warna dipakai untuk aksi, data penting, dan status. Permukaan datar dengan garis 1 px; bayangan hanya bila perlu membedakan lapisan modal.

## Typography and numbers

- Headline ringkas: **Outfit** semibold. Isi, label, dan angka: **Geist**; host lokal bila frontend dibuat agar tetap tampil saat offline. Fallback sistem sans-serif tetap harus terbaca.
- Nominal, kuantitas, subtotal, selisih dan tabel: `font-variant-numeric: tabular-nums; font-feature-settings: "tnum" 1;` dan rata kanan pada kolom angka.
- Format IDR memakai `Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 })`; antarmuka ringkas dapat menampilkan `Rp18.000`, tidak `18k` pada nilai audit.
- Type scale ponsel: angka total 32 px, judul layar 24 px, label menu 18 px, body 16 px, bantuan 14 px. Jangan membuat label lebih keras daripada nominal.

## Screen structure

### Kasir POS, ponsel

1. Bar atas: **Cuanki POS**, cabang aktif, nama kasir, dan status sinkronisasi dengan jumlah transaksi menunggu.
2. Dua tab jelas: **Kasir** dan **Tutup Shift**. Tab tetap terjangkau ibu jari; tidak ada navigasi tersembunyi untuk pekerjaan utama.
3. Daftar menu aktif dari Sheets sebagai baris penuh: nama, harga, tombol `−` / jumlah / `+` dengan area sentuh minimal 48×48 px. Jumlah nol tetap terlihat.
4. Ringkasan keranjang menempel dekat bagian bawah layar, di atas tombol **Bayar** 56 px. Tampilkan total cup, total Rupiah, pilihan Tunai/QRIS; untuk Tunai tampilkan uang diterima dan kembalian.
5. Setelah Bayar, tampilkan `Tersimpan`, `Menunggu sinkronisasi`, atau `Gagal, coba lagi` sesuai hasil. Jangan mengosongkan keranjang sebelum transaksi tersimpan lokal atau server mengakui ID.

### Tutup Shift, ponsel

Alur dimulai dengan layar **Buka Shift** untuk modal awal dan Cup Bawa. Saat tutup, urutkan: **Cup** (bawa terkunci, sisa, reject, fisik versus POS), **Kas & QRIS** (modal dan QRIS sistem sebagai angka baca), **Operasional**, **Cash opname** (seluruh uang fisik termasuk modal), lalu **Periksa dan tutup**. Ringkasan selisih berada tepat sebelum tombol konfirmasi. Tombol **Tutup Shift** 56 px dan tidak aktif saat input wajib kosong atau antrean transaksi belum sinkron.

### Admin, desktop

Header ringan dengan cabang dan tanggal sebagai filter. Tampilkan omset per menu, total penerimaan, laba kotor, HPP dan laba bersih dalam satu alur baca. Selisih cup/kas dan `status_audit` berada di baris teratas saat ada masalah. Tabel memakai garis horizontal, angka rata kanan, tanpa zebra striping atau grafik bila belum ada pertanyaan yang perlu dijawab grafik. Pada lebar 390 px, tabel berubah menjadi baris berlabel yang tidak memaksa scroll horizontal untuk angka penting.

## States and behavior

- **Kosong:** `Belum ada transaksi hari ini`; tetap tampilkan total Rp0 dan struktur keranjang.
- **Offline:** status `Offline · 2 transaksi menunggu` dan aksi Bayar tetap bekerja lewat antrean lokal. Gunakan satu `trx_id` yang sama untuk semua retry.
- **Mengirim:** tombol sibuk dengan label `Menyimpan…`, cegah klik ganda.
- **Berhasil:** tampilkan nomor transaksi singkat, metode dan nominal.
- **Selisih:** tampilkan `Cup fisik 22, POS 21 · selisih +1` atau `Kas laci kurang Rp5.000`, beserta langkah periksa ulang. Jangan hanya warna merah.
- **Akses:** PIN empat digit dengan keyboard numerik, error `PIN tidak sesuai` tanpa membuka nilai PIN.
- **Aksesibilitas:** teks body/placeholder minimal 4.5:1, teks besar 3:1, fokus keyboard tegas, urutan fokus mengikuti alur kerja, dan `prefers-reduced-motion` meniadakan gerak non-esensial.

## Verification

Uji pada 390 px, 768 px, 1440 px, mode malam, keyboard, dan keadaan offline. Periksa bahwa seluruh isi tombol terbaca, target sentuh ≥48 px, angka Rupiah sejajar, tidak ada horizontal overflow, status antrean benar, serta contoh PRD (6 Ayam, 8 Kare, 8 Creamy) menjumlah Rp412.000 sebelum biaya.
