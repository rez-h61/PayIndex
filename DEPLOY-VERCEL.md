# Sambung setup: GitHub → Vercel → Supabase

Panduan ini bermula selepas langkah 1–3 dalam START-HERE: SQL sudah dijalankan, akaun email/password admin sudah dicipta, dan bootstrap admin sudah dibuat. Tidak perlu ulang SQL tersebut.

| Servis | Tugas |
| --- | --- |
| GitHub | Simpan kod projek supaya perubahan boleh diterbitkan semula |
| Vercel | Bina kod dan hos website pada alamat HTTPS |
| Supabase | Akaun admin, database, fail gambar dan fungsi untuk simpan/padam |

## 1. Masukkan kod ke GitHub

Gunakan repository **Private** bernama `payindex`. Langkah di bawah akan menciptanya. Repository private tidak menghalang kawan daripada membuka website Vercel.

Cara mudah untuk projek ini ialah **GitHub Desktop**:

1. Log masuk GitHub Desktop. Pilih **File → Add local repository** dan pilih `C:\Users\famou\OneDrive\Documents\PayIndex`.
2. Jika aplikasi mengatakan folder itu belum menjadi Git repository, pilih pautan **create a repository here**. Semak lokasi akhir masih folder PayIndex yang sama, bukan folder baharu di dalamnya. Kekalkan `.gitignore` yang sudah ada.
3. Semak senarai Changes. Pastikan `.env`, `node_modules` dan `dist` tidak disenaraikan. Isi ringkasan seperti `Prepare PayIndex` lalu **Commit to main** jika ada perubahan belum dikomit.
4. Klik **Publish repository**, namakan `payindex` dan tandakan **Keep this code private**. Jika repository sudah wujud, gunakan repository itu; jangan cipta dua salinan.

Fail/folder yang patut ada di GitHub:

```text
src/
public/
supabase/             (kecuali .temp/ atau fail .env di dalamnya)
scripts/
tests/
.gitignore
.env.example         (contoh sahaja, bukan .env sebenar)
index.html
package.json
package-lock.json
vercel.json
vite.config.ts
vitest.config.ts
playwright.config.ts
tsconfig.json
tsconfig.edge.json
README.md
START-HERE.md
DEPLOY-VERCEL.md
TESTING.md
```

Jangan upload `.env`, `node_modules/`, `dist/`, `test-results/`, `playwright-report/`, `.vercel/`, `supabase/.temp/` atau `*.tsbuildinfo`. `.gitignore` sudah mengecualikannya apabila menggunakan Git. Upload melalui laman GitHub secara manual tidak menggunakan perlindungan `.gitignore`; jika guna cara itu, pilih hanya fail/folder dalam senarai di atas dan kekalkan struktur folder.

Password admin, service-role key dan cleanup secret tidak boleh ada dalam kod atau SQL yang dimasukkan ke GitHub. Kekalkan placeholder dalam fail SQL; gantikan secret hanya dalam Supabase SQL Editor semasa menjalankannya.

## 2. Import repository ke Vercel

1. Log masuk [Vercel](https://vercel.com/new) menggunakan GitHub.
2. Pilih **Add New → Project**, benarkan akses ke repository `payindex`, kemudian **Import**.
3. Semak tetapan berikut:

| Tetapan | Nilai |
| --- | --- |
| Framework Preset | Vite |
| Root Directory | `./` — folder yang mengandungi package.json |
| Build Command | `npm run build` |
| Output Directory | `dist` |
| Install Command | Biarkan default atau `npm ci` |
| Node.js Version | 24.x |

4. Dalam **Environment Variables**, tambah tiga nilai ini untuk Production:

| Name | Value |
| --- | --- |
| `VITE_SUPABASE_URL` | `https://kdrjgkvwhaqougbcrwxf.supabase.co` |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Salin nilai `sb_publishable_...` daripada `.env` tempatan atau Supabase API Keys |
| `VITE_ENABLE_DEMO` | `false` |

Jangan masukkan `VITE_...=` dalam ruangan Value; ruangan Name dan Value berasingan. Jangan letakkan password admin atau service-role key di Vercel. Untuk deployment preview, gunakan projek Supabase staging berasingan jika mahu menguji perubahan yang menulis data.

5. Klik **Deploy**. Selepas siap, salin alamat **Production** yang tetap, contohnya `https://payindex-abc.vercel.app`. Contoh ini bukan alamat sebenar projek awak. Gunakan alamat yang Vercel berikan, bukan URL unik bagi setiap build.

`vercel.json` sudah menyediakan fallback untuk `/admin/login`, `/people/...` dan `/qr/...`, serta header keselamatan. Vercel tidak menggunakan fail `public/_headers` dan `_redirects`; kedua-duanya untuk hos lain.

Website mungkin sudah boleh memaparkan direktori selepas langkah ini. Simpan/padam masih memerlukan langkah 3 di bawah. Jika ubah environment variables selepas deployment, buat **Redeploy** supaya nilai baharu masuk ke binaan.

## 3. Aktifkan simpan/padam dalam Supabase

Folder `supabase/functions/` di GitHub tidak akan dideploy ke Supabase secara automatik oleh Vercel. Kita deploy dua fungsi secara berasingan.

Dalam Supabase Dashboard, buka **Edge Functions → Secrets** dan tambah:

| Name | Value |
| --- | --- |
| `ALLOWED_ORIGINS` | `http://localhost:5173,http://127.0.0.1:5173,https://ALAMAT-SEBENAR.vercel.app` |
| `CLEANUP_SECRET` | Nilai rawak yang panjang, contoh 64 aksara hex daripada password manager |

Gantikan alamat contoh dengan alamat Production Vercel tadi. Jangan tambah `/` di hujung alamat. Simpan cleanup secret dalam password manager; nilai yang sama diperlukan sekali lagi pada langkah 4. Ini bukan password admin. Secret tersedia kepada fungsi tanpa dimasukkan ke kod.

Kemudian buka **PowerShell** pada komputer. Jalankan satu demi satu:

```powershell
cd "C:\Users\famou\OneDrive\Documents\PayIndex"
npx supabase login
```

Jika diminta memasang pakej Supabase, jawab `y`. Login ini ialah login pemilik projek Supabase, bukan akaun admin PayIndex. Ikut arahan login yang dipaparkan pada browser/terminal; jangan tampal token dalam chat.

Deploy dua fungsi:

```powershell
npx supabase functions deploy directory-manage --project-ref kdrjgkvwhaqougbcrwxf --use-api --no-verify-jwt
npx supabase functions deploy directory-cleanup --project-ref kdrjgkvwhaqougbcrwxf --use-api --no-verify-jwt
```

`--use-api` menggunakan pembundelan pada server supaya deployment ini tidak memerlukan Docker. Arahan memilih projek secara terus, jadi tidak perlu `supabase db push`, `supabase init` atau mengulang migration yang sudah dijalankan.

Pengesahan gateway dimatikan kerana aplikasi menggunakan publishable key. Kod `directory-manage` sendiri mengesahkan token pengguna dan identiti admin; `directory-cleanup` memerlukan cleanup secret. Jangan buang semakan tersebut. Tidak perlu deploy fungsi lama `qr-manage` atau `qr-cleanup`.

## 4. Hidupkan pembersihan fail lama

1. Dalam Supabase **Database → Extensions**, hidupkan `pg_cron` dan `pg_net`.
2. Buka fail `supabase/schedule-cleanup.sql` dan salin kandungannya ke **SQL Editor**.
3. Dalam SQL Editor sahaja, gantikan `REPLACE_WITH_RANDOM_CLEANUP_SECRET` dengan nilai `CLEANUP_SECRET` tadi. Project URL dalam fail sudah diisi untuk projek awak.
4. Jalankan sekali. Jadual ini membersihkan fail lama/terbiar setiap 15 minit. Jangan masukkan salinan SQL yang sudah berisi secret ke GitHub.

Jika jadual sudah dibuat, jangan jalankan skrip yang sama sekali lagi tanpa menyemak job dan secret sedia ada.

## 5. Cuba website sebenar

1. Buka alamat Production Vercel tanpa `?demo=1`.
2. Buka `/admin/login`, login dengan akaun yang dibuat dalam Supabase.
3. Tambah seorang, gambar pilihan, dan satu QR penerimaan yang awak ada izin untuk kongsi.
4. Buka website dalam Incognito: direktori dan QR patut boleh dilihat tanpa login; fungsi edit hanya untuk admin.
5. Cuba download, gantikan QR, refresh terus halaman `/admin/login` atau halaman QR, dan sign out.

Jika login berjaya tetapi simpan gagal, semak deployment `directory-manage`, Function Logs dan `ALLOWED_ORIGINS` (alamat mesti sama tepat). Jika direktori gagal dimuatkan, semak tiga environment variables dan SQL yang dipasang. Jika skrin admin menyatakan tiada akses, semak bootstrap menggunakan email akaun yang sama.

Selepas itu, perubahan kod yang dikomit dan dipush ke branch Production GitHub akan membina semula website Vercel. Perubahan fungsi Supabase masih perlu arahan deploy fungsi semula; perubahan SQL perlu migration berasingan.

Panduan ini menyediakan konfigurasi; deployment dalam akaun GitHub/Vercel/Supabase awak belum dilakukan atau disahkan oleh Codex.

Rujukan rasmi: [Vite di Vercel](https://vercel.com/docs/frameworks/frontend/vite), [Supabase function deployment](https://supabase.com/docs/guides/functions/deploy), [Supabase secrets](https://supabase.com/docs/guides/functions/secrets).
