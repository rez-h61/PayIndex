# Sesi admin dengan cookie HttpOnly

Perubahan ini memindahkan login dan semua tindakan admin ke `/api/admin` pada
Vercel. Directory, foto dan QR masih boleh dibaca secara public melalui Supabase.
Browser tidak lagi menerima access/refresh token dalam respons JSON atau menyimpan
sesi Supabase dalam localStorage. Cookie dienkripsi AES-256-GCM, HttpOnly,
Secure, SameSite=Strict, host-only, dengan had mutlak 12 jam.

**Kod ini belum mengubah production. Sediakan tetapan di bawah sebelum push kod
yang mencetuskan deployment production.** Tiada service-role key diperlukan di
Vercel; secret Supabase kekal pada Edge Function sedia ada.

## Urutan setup dan deployment

### 1. Tambah environment variables server di Vercel

Projek `pay-index` → Settings → Environments → Production → Environment Variables.

| Nama | Type | Nilai |
| --- | --- | --- |
| `PAYINDEX_APP_ORIGIN` | Config | `https://payindex-kokoro.vercel.app` |
| `SUPABASE_URL` | Config | URL projek Supabase yang sama dengan `VITE_SUPABASE_URL` |
| `SUPABASE_PUBLISHABLE_KEY` | Config | Publishable key yang sama dengan `VITE_SUPABASE_PUBLISHABLE_KEY` |
| `PAYINDEX_COOKIE_SECRET` | Secret | 32 random bytes dalam format base64 |

Jana cookie secret sendiri di terminal tempatan, kemudian terus salin ke Vercel:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
```

Jangan hantar secret itu dalam chat, commit ke Git atau tambah awalan `VITE_`.
Jangan guna secret key Cloudflare sebagai cookie secret. Memutar cookie secret
akan menamatkan semua sesi cookie PayIndex, dan admin perlu login semula.

Kekalkan `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` dan
`VITE_TURNSTILE_SITE_KEY` sedia ada. Secret Turnstile kekal dalam Supabase Auth;
backend menghantar CAPTCHA token kepada Supabase untuk disahkan seperti biasa.

Origin di atas mesti sama tepat dengan URL browser: scheme, hostname dan port.
Gunakan URL itu untuk login admin. Alias/custom domain lain masih boleh membaca
directory, tetapi endpoint admin akan menolak origin lain. Jika memilih custom
domain utama, gunakan domain itu pada `PAYINDEX_APP_ORIGIN` dan hostname Turnstile.
Jangan gunakan wildcard atau percaya Host/X-Forwarded-Host sebagai origin.

### 2. Apply migration Supabase dahulu

Di SQL Editor, jalankan:

`supabase/migrations/20261015131407_active_directory_admin_session.sql`

Ia hanya menambah RPC `is_active_directory_admin()`, yang semak admin dan
`session_id` JWT terhadap `auth.sessions`. Tiada data directory dipadam atau
ditukar. Jangan rerun `setup-new.sql` pada projek sedia ada.

Jika guna CLI yang telah dilink ke projek betul, `supabase db push` juga boleh
digunakan selepas menyemak migration yang belum diaplikasi.

### 3. Deploy Edge Function, kemudian frontend/backend Vercel

Redeploy `directory-manage` dari source baharu selepas migration berjaya:

```sh
supabase functions deploy directory-manage --no-verify-jwt
```

Ia masih menyemak token dan admin sendiri, serta menolak sesi yang telah logout.
Jangan deploy fungsi legacy `qr-manage` atau `qr-cleanup`.

Kemudian commit/push kod lengkap ke branch production yang disambungkan dengan
Vercel. `/api/admin` mesti dijalankan sebagai Vercel Function, bukan dihantar ke
SPA `/index.html`; rewrite API disediakan dalam `vercel.json`. Backend tidak boleh
digunakan pada hosting static-only. Preview memerlukan environment server dan
origin preview tersendiri; jangan salin secret production untuk preview tidak dipercayai.

### 4. Uji selepas deployment

1. Hard refresh/app update. Sesi lama dalam localStorage tidak diimport; login
   semula melalui Turnstile dalam Incognito.
2. DevTools → Application → Cookies: `__Host-payindex-admin` mesti mempunyai
   HttpOnly, Secure, SameSite Strict dan Path `/`. Nilainya opaque/encrypted.
3. DevTools → Local Storage: tiada `sb-...-auth-token` untuk projek PayIndex.
   `document.cookie` tidak boleh membaca cookie sesi admin.
4. Network: login/session/manage melalui `/api/admin`; respons hanya status/data
   operasi, tidak mengandungi access_token atau refresh_token. Jangan kongsi
   screenshot yang mendedahkan nilai cookie atau credential.
5. Uji tambah/edit/delete rekod ujian milik sendiri, upload gambar, design QR dan
   share link. Had upload baharu 4 MB kerana limit request Vercel 4.5 MB; fail
   sedia ada sehingga 5 MB masih boleh dibaca. Server Edge masih menyemak bytes.
6. Buka dua tab dan pastikan refresh/reload mengekalkan admin. Selepas logout,
   reload kedua-dua tab dan pastikan tiada akses admin. Selepas 12 jam, login
   semula diperlukan. Refresh tidak melanjutkan had mutlak ini.
7. Permintaan API tanpa cookie atau dengan Origin asing mesti ditolak. Permintaan
   login tanpa CAPTCHA mesti ditolak. Jangan brute-force production untuk menguji limit.

Selepas aliran baharu disahkan, tamatkan sesi admin lama melalui kemudahan revoke
sessions Supabase jika tersedia, kemudian login semula. Memadam localStorage sahaja
tidak membatalkan JWT lama di server. Semakan sesi aktif Edge memastikan token
yang telah direvoke tidak boleh digunakan semula untuk mutation.

## Apa yang dilindungi dan batasannya

- CSRF: semua endpoint hanya menerima POST, Origin tepat dan header bukan-simple
  `X-PayIndex-Request: admin`, di samping SameSite Strict. Tiada CORS public pada API.
- Setiap session check/mutation mengesahkan user dengan Supabase dan semak sesi
  aktif serta identiti admin. Akses database terus masih dilindungi RLS/grants.
- Refresh token rotation kekal dikendalikan Supabase; kekalkan reuse interval
  lalai 10 saat. Web Locks menyelaraskan request admin antara tab pada browser
  yang menyokongnya. Pada browser tanpa Web Locks, Supabase mengendalikan
  concurrent refresh melalui reuse interval/parent-token rules. Tiada replay
  mutation automatik apabila sambungan terputus.
- Logout memadam cookie dan meminta Supabase revoke sesi itu sahaja. Jika server
  Supabase gagal dihubungi, cookie browser tetap dipadam jika API Vercel dicapai,
  tetapi revocation server belum dijamin; UI melaporkan kegagalan. Jika rangkaian
  langsung terputus, browser tidak boleh memadam cookie HttpOnly sendiri.
- HttpOnly menghalang JavaScript membaca token, tetapi XSS masih boleh melakukan
  tindakan menggunakan browser yang login. CSP dan validasi input tetap perlu.
- Login kini melalui backend. Tanpa IP forwarding, Supabase melihat IP keluar
  backend, jadi rate limit Auth tidak semestinya berasingan mengikut IP pelawat.
  Untuk satu admin, pantau 429 sebelum ubah limit. Mengaktifkan IP forwarding
  memerlukan integrasi secret API key dan trusted client-IP forwarding berasingan;
  jangan aktifkan toggle sahaja atau percaya header IP daripada pengguna.
- Cookie production wajib HTTPS. Dalam development localhost sahaja, cookie
  `payindex-admin-dev` menggunakan HttpOnly/SameSite Strict tanpa Secure supaya
  dev HTTP boleh diuji. Bypass ini tidak dibenarkan pada Vercel.

## Development dan tests

Copy `.env.example` ke `.env.local`, isi konfigurasi server dan site key widget
development. Gunakan origin exact `http://127.0.0.1:5173` untuk `npm run dev`.
Vite menjalankan handler API yang sama melalui middleware tempatan. `vite preview`
ialah static preview; gunakan Vercel preview atau dev server untuk API sebenar.

```sh
npm test
npm run build
npx tsc -p tsconfig.edge.json
npx playwright test --config playwright.security.config.ts
```

Unit/integration tests menggunakan fixture Supabase untuk memeriksa cookie,
CSRF, encryption/tamper, timeout, refresh, admin checks, logout/replay dan proxy
upload. Database tests memeriksa RPC menolak session yang telah direvoke.
Browser fixture tests bukan bukti konfigurasi Vercel/Supabase production; ujian
live di atas tetap diperlukan.

Rujukan:
https://vercel.com/docs/functions/runtimes/node-js
https://vercel.com/docs/functions/limitations
https://supabase.com/docs/guides/auth/sessions
