-- Setelah membuat akun KitaWear melalui website, jalankan query ini sebagai pemilik project
-- untuk menjadikan akun tersebut seller.
-- Ganti EMAIL_SELLER dengan email akun yang baru dibuat.

update public.profiles
set role = 'seller', updated_at = now()
where id = (
  select id from auth.users where email = 'EMAIL_SELLER'
);

-- Verifikasi:
select id, full_name, role
from public.profiles
where id = (
  select id from auth.users where email = 'EMAIL_SELLER'
);
