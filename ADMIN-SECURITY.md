# Setup keselamatan admin PayIndex

**Update:** Login kini menggunakan backend cookie HttpOnly. Untuk deployment kod semasa, ikut [COOKIE-SESSIONS.md](./COOKIE-SESSIONS.md) dahulu; panduan Turnstile di bawah menerangkan setup widget/provider sahaja.

Kod CAPTCHA tersedia, tetapi perlindungan live hanya aktif selepas frontend
dideploy dengan site key sebenar **dan** Supabase Auth menguatkuasakan CAPTCHA.
Tiada perubahan kepada akses public directory.

## 1. Cipta Cloudflare Turnstile

1. Buka Cloudflare Dashboard → Turnstile → Add widget.
2. Pilih Managed dan benarkan hostname `payindex-kokoro.vercel.app`.
   Tambah custom domain sebenar jika digunakan. Jangan benarkan semua hostname.
3. Simpan **site key** dan **secret key**. Site key memang public; secret key
   hanya dimasukkan dalam Supabase, bukan Git, chat, `.env` frontend atau `VITE_`.

Rujukan: https://developers.cloudflare.com/turnstile/get-started/widget-management/dashboard/

## 2. Deploy frontend dahulu

1. Vercel → projek PayIndex → Settings → Environment Variables:
   tambah `VITE_TURNSTILE_SITE_KEY` dengan **site key** untuk Production.
2. Deploy kod baharu. Pastikan CSP baharu dari `vercel.json` turut digunakan.
3. Buka `/admin/login` dalam private window. Sahkan widget boleh selesai,
   butang Sign in hanya aktif selepas verification, dan login berjaya.
   Pada tahap ini CAPTCHA belum dikuatkuasakan oleh server.

Widget tidak dimuatkan untuk pelawat directory. Token yang tamat tempoh atau
sudah dihantar tidak digunakan semula. Kegagalan widget menyekat submit apabila
site key dikonfigurasi. Tanpa site key, login lama kekal tersedia untuk membolehkan
setup berperingkat; keadaan ini **bukan CAPTCHA protection**.

## 3. Aktifkan enforcement dalam Supabase

1. Buka https://supabase.com/dashboard/project/kdrjgkvwhaqougbcrwxf/auth/protection
   (atau Authentication → Bot and Abuse Protection).
2. Aktifkan CAPTCHA, pilih Turnstile, masukkan **secret key**, dan simpan.
3. Dalam private window baharu, sahkan login dengan widget berjaya.
4. Sahkan permintaan terus ke `/auth/v1/token?grant_type=password` tanpa
   `gotrue_meta_security.captcha_token` ditolak. Gunakan satu percubaan dengan
   akaun ujian sendiri; jangan brute-force akaun production atau kongsi credential.

Pengesahan server ini yang menghalang bot memintas UI.

Jika widget gagal selepas enforcement aktif, baiki site key, hostname atau CSP.
Jangan kosongkan site key sambil CAPTCHA Supabase masih aktif. Untuk rollback,
ubah tetapan CAPTCHA Supabase dahulu, kemudian rollback frontend jika perlu.

Rujukan: https://supabase.com/docs/guides/auth/auth-captcha

## 4. Rate limit dan password

- Authentication → Rate Limits: periksa limit token endpoint (`/auth/v1/token`),
  yang merangkumi password login **dan refresh token**. Untuk satu admin,
  mulakan dengan 30 permintaan setiap 5 minit per IP jika dashboard menyokongnya.
  Pantau 429 sebelum memperketatkan lagi. Jangan ubah limit OTP sahaja dan anggap
  password login sudah dilindungi. Rate limit per IP tidak menghentikan semua
  cubaan daripada banyak IP; CAPTCHA menambah satu lapisan perlindungan.
- Authentication → password/security settings: aktifkan Leaked Password
  Protection jika tersedia pada pelan. Jika perlu naik taraf berbayar, tentukan
  sendiri dahulu. Jika tidak tersedia, gunakan password admin panjang, unik,
  dijana password manager. Mengaktifkan tetapan tidak membuktikan password lama
  sudah diperiksa; tukar password melalui dashboard atau aliran rasmi jika perlu.
- Pastikan public signups dan anonymous sign-ins dimatikan kerana PayIndex
  hanya memerlukan satu akaun admin.

Rujukan: https://supabase.com/docs/guides/auth/rate-limits

Rujukan: https://supabase.com/docs/guides/auth/password-security

## 5. CSP dan dependency

`script-src` membenarkan origin app dan `https://challenges.cloudflare.com`;
`frame-src` hanya membenarkan Turnstile. Tiada `unsafe-inline` atau `unsafe-eval`
ditambah. `connect-src https:` sengaja dikekalkan atas pilihan pemilik untuk
membolehkan import QR daripada mana-mana domain HTTPS. `img-src https:` juga
diperlukan untuk gambar profil melalui link.

Frontend dan semua fungsi Supabase kini mengunci `@supabase/supabase-js` kepada
`2.117.2`, iaitu versi yang telah dipasang dan diuji dalam projek ini. Redeploy
`directory-manage` untuk menggunakan pin server; jangan deploy fungsi legacy
`qr-manage` atau `qr-cleanup` yang tidak digunakan. Pin dalam kod belum mengubah
versi fungsi live. Kemas kini dependency secara sengaja bersama lockfile dan
ujian; pin bukan pengganti kemas kini keselamatan.

## 6. MFA (pilihan kemudian)

MFA untuk admin app memerlukan skrin enrolment, challenge selepas password login,
dan semakan AAL2 pada server sebelum mutation. Mengaktifkan MFA akaun dashboard
Supabase sahaja tidak melindungi login admin PayIndex. Integrasi MFA app belum
dibuat dalam perubahan CAPTCHA ini; jangan enforce AAL2 sebelum aliran itu siap
dan recovery diuji.

## Ujian kod

```sh
npm test
npm run build
npx tsc -p tsconfig.edge.json
npx playwright test --config playwright.security.config.ts
```

Browser tests menggunakan fixture widget dan Auth, bukan key/credential sebenar.
Ia menguji guard tanpa token, token tamat tempoh, penghantaran token, reset selepas
percubaan, kegagalan widget, mesej 429, dan tiada widget untuk directory public.
Ujian live dalam langkah 2–3 tetap diperlukan selepas setup.
