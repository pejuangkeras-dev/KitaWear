KITaWEAR MARKETPLACE — DEPLOYMENT

1. SUPABASE
- Original schema.sql sudah dijalankan pada project Supabase.
- Jalankan supabase/marketplace_security.sql SATU KALI di SQL Editor.
- Ini membuat policy seller/admin lebih ketat.

2. NETLIFY ENVIRONMENT VARIABLES
Pastikan sudah ada:
MIDTRANS_CLIENT_KEY
MIDTRANS_SERVER_KEY
MIDTRANS_IS_PRODUCTION=false
SUPABASE_URL
SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
Semua untuk Builds, Functions, Runtime sesuai konfigurasi project.

3. GITHUB / NETLIFY
Salin isi paket ini ke repository KitaWear yang terhubung ke Netlify.
Ganti index.html dengan index marketplace ini.
Tambahkan seller.html.
Tambahkan netlify.toml.
Tambahkan package.json.
Tambahkan folder netlify/functions.

4. AUTH
Website menggunakan Supabase Auth melalui CDN.
Pembeli dapat Daftar/Masuk dari tombol akun.
Checkout pembayaran memerlukan akun login.

5. SELLER
Setelah akun dibuat, jika ingin menguji seller pertama:
- buka SQL Editor Supabase
- buka promote_seller.sql
- ganti EMAIL_SELLER
- jalankan query
- buka https://kitawear.netlify.app/seller.html

6. PRODUK MARKETPLACE
Seller dapat membuat toko dan produk dari seller.html.
Produk aktif dari database akan otomatis tampil di homepage.
Jika database belum memiliki produk aktif, homepage mempertahankan katalog fallback KitaWear yang ada.

7. PAYMENT
create-transaction.mjs memerlukan login Supabase dan menyimpan order marketplace jika cart menggunakan produk database.
Midtrans tetap Sandbox karena MIDTRANS_IS_PRODUCTION=false.
midtrans-notification.mjs memperbarui status order berdasarkan notifikasi Midtrans.

8. PENTING
Jangan pernah memasukkan SUPABASE_SERVICE_ROLE_KEY atau MIDTRANS_SERVER_KEY ke HTML/frontend.
Jangan mengirim secret key ke chat.

9. NOTIFICATION URL MIDTRANS
https://kitawear.netlify.app/.netlify/functions/midtrans-notification

Tahap lanjutan:
- Admin dashboard
- seller approval UI
- Supabase Storage untuk upload foto
- order tracking
- stock reservation/decrement setelah pembayaran
- review/dispute UI
- payout/settlement workflow marketplace sesuai provider pembayaran dan struktur bisnis.
