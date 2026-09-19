# Kalkulator Incentive Agent

Web app statis (HTML/JS, tanpa server) untuk menghitung incentive agent:
- **index.html** — dipakai agent: input revenue per produk & target, lalu hitung
  incentive (mode maju), atau input incentive yang diinginkan untuk tahu berapa
  tambahan revenue yang dibutuhkan (mode mundur, diprioritaskan ke produk yang
  paling banyak dijual agent tersebut).
- **admin.html** — dipakai admin: upload file Excel skema incentive mingguan,
  lalu download `schema.json` untuk di-upload ke repo.
- **data/schema.json** — "database" skema incentive (rate per produk per
  threshold, per week, per team). Ini yang di-update tiap minggu.

Tidak butuh backend/server — semua jalan di browser. Cocok untuk di-host gratis
di **GitHub Pages**.

## Setup awal (sekali saja)

1. Upload semua file & folder di project ini (`index.html`, `admin.html`,
   folder `css/`, `js/`, `data/`) ke repo GitHub Anda — bisa lewat drag & drop
   di GitHub web UI (Add file → Upload files) atau `git push`.
2. Di repo, buka **Settings → Pages**.
3. Di bagian "Build and deployment", pilih source **Deploy from a branch**,
   branch **main** (atau branch tempat Anda upload), folder **/ (root)**.
4. Simpan. Tunggu 1-2 menit, GitHub akan menampilkan URL-nya, biasanya:
   `https://<username>.github.io/<nama-repo>/`
5. Buka URL tersebut → harusnya langsung muncul kalkulator dengan data contoh
   yang sudah ada di `data/schema.json` (week 32-35).

Bagikan link tersebut ke agent-agent untuk mereka pakai langsung dari HP/laptop.

## Update skema tiap minggu (rutin)

Skema incentive & threshold biasanya berubah tiap minggu, jadi ini yang perlu
dilakukan admin setiap minggu:

1. Siapkan file Excel skema minggu ini dengan format sheet:
   - **Incentive Schema**: kolom `Week`, `STATUS`, `TEAM`, `PRODUCT`, `TH 0`,
     `TH 1`, `TH 2`, ... (jumlah kolom TH bebas, tidak harus 5).
   - **Threshold** (opsional tapi disarankan): kolom `ISO Week`, `Team`,
     `Threshold (TH)`, `% Ach >=`.
   - **Target Agent** (opsional): kolom `ISO Week`, `Team`,
     `Target/Agent/Week` — dipakai sebagai nilai default yang otomatis
     terisi di form (agent tetap bisa mengubahnya).
2. Buka halaman **admin.html** di link GitHub Pages Anda
   (`https://<username>.github.io/<nama-repo>/admin.html`).
3. Upload file Excel tersebut.
   - *(Opsional, disarankan)* Sebelum itu, download dulu `data/schema.json`
     yang sedang aktif di repo (buka file-nya di GitHub → tombol "Download
     raw file"), lalu upload di bagian "Gabung dengan schema.json yang sudah
     ada" — supaya minggu-minggu sebelumnya tidak hilang dan tetap bisa
     dipilih agent.
4. Cek preview di halaman admin, pastikan angka-angkanya sesuai.
5. Klik **Download schema.json**.
6. Buka repo GitHub → masuk folder `data/` → klik **Add file → Upload
   files** → pilih file `schema.json` yang baru saja didownload (pastikan
   namanya tetap `schema.json`, otomatis menimpa yang lama) → **Commit
   changes**.
7. Tunggu ±1 menit, GitHub Pages otomatis rebuild. Refresh halaman
   `index.html` — minggu baru akan muncul di dropdown "ISO Week".

## Cara kerja perhitungan

- **Achievement** = Total Revenue ÷ Target.
- **Threshold aktif** = threshold tertinggi yang cutoff-nya (%) masih ≤
  achievement (mis. achievement 82% dengan threshold TH1=50%, TH2=75%,
  TH3=100% → yang aktif TH2).
- **Incentive** = jumlah dari `(revenue tiap produk × rate produk itu di
  threshold aktif)`.
- **Mode mundur** (incentive yang diinginkan → revenue dibutuhkan): sistem
  mencoba tiap threshold sebagai "hasil akhir", menghitung berapa tambahan
  revenue yang dibutuhkan pada satu produk (produk dengan revenue existing
  terbesar) supaya incentive tercapai, lalu memvalidasi apakah achievement
  hasil akhir memang konsisten jatuh di threshold tersebut. Solusi dengan
  tambahan revenue paling kecil yang ditampilkan sebagai rekomendasi utama.

## Struktur file

```
index.html          # halaman kalkulator untuk agent
admin.html           # halaman admin untuk generate schema.json
css/style.css        # styling bersama
js/calc.js            # logika perhitungan (forward & reverse)
js/parse.js           # parsing file Excel -> schema.json (dipakai admin.html)
data/schema.json      # data skema incentive (di-update tiap minggu)
```

## Catatan

- Semua perhitungan jalan di browser masing-masing (client-side), tidak ada
  data yang dikirim ke server manapun — revenue yang diinput agent bersifat
  privat, tidak tersimpan/terkirim kemana-mana.
- `admin.html` memuat library SheetJS dari CDN (jsdelivr) untuk membaca file
  Excel di browser.
- Kalau kolom `STATUS` di sheet "Incentive Schema" berisi selain "Agent"
  (misal "Leader", "TL"), baris tersebut otomatis diabaikan (bisa diubah di
  field "Filter kolom STATUS" pada halaman admin).
