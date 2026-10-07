# PayIndex versi baharu

Google OAuth tidak diperlukan lagi. Kawan-kawan terus buka pautan; awak sahaja login sebagai admin.

**Dah siap langkah 1–3 dan nak guna GitHub + Vercel?** Sambung dalam [DEPLOY-VERCEL.md](./DEPLOY-VERCEL.md). Panduan itu senaraikan fail untuk GitHub, tetapan Vercel, dan cara deploy fungsi Supabase.

## Tengok design dulu

Buka `http://127.0.0.1:5173/?demo=1` semasa aplikasi berjalan. Ini preview berlabel dengan nama rekaan, bukan data sebenar. Untuk aplikasi sebenar buka `http://127.0.0.1:5173/`.

## Aktifkan akaun admin dan simpanan sebenar

1. Dalam Supabase **SQL Editor**, jalankan `supabase/setup-new.sql` jika belum pernah jalankan SQL PayIndex. Jika SQL versi lama sudah dipasang, jalankan migration `202610060002_single_admin_directory.sql` sahaja.
2. Dalam **Authentication → Users**, cipta satu user menggunakan email/password awak. Hidupkan sign-in Email dan matikan Google serta pendaftaran user baharu. Jangan masukkan password dalam kod atau hantar di chat.
3. Dalam SQL Editor, jalankan `supabase/bootstrap-admin.sql` selepas menggantikan `YOUR_ADMIN_EMAIL` dengan email akaun tadi.
4. Deploy fungsi `directory-manage` dan `directory-cleanup`, tetapkan origin/cleanup secret, kemudian hidupkan jadual cleanup. Arahan penuh ada dalam README.
5. Buka `/admin/login`, login, kemudian **Add person**. Tambah nama, pilih gambar jika mahu, dan tambah QR berlabel pada halaman orang tersebut.

Gambar profil: boleh upload atau guna URL HTTPS terus. QR: boleh upload atau import dari pautan imej; pautan yang tidak membenarkan import perlu dimuat naik secara manual. Fail disimpan dalam Storage, bukan sebagai data imej dalam jadual database.

Sesiapa yang ada pautan boleh melihat direktori. Orang lain tidak boleh edit. Tiada Google login, akaun ahli, approval, nickname atau pengurusan kumpulan dalam aplikasi baharu.
