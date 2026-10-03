-- P25 Final Production Audit: remove only verified duplicate indexes.
-- Constraint-backed unique indexes are intentionally retained.
DROP INDEX IF EXISTS public.buyer_addresses_one_default_idx;
DROP INDEX IF EXISTS public.chat_threads_seller_updated_idx;
DROP INDEX IF EXISTS public.chat_threads_buyer_store_unique;
DROP INDEX IF EXISTS public.chat_threads_buyer_store_unique_idx;
DROP INDEX IF EXISTS public.notifications_user_created_idx;
DROP INDEX IF EXISTS public.product_sizes_product_idx;
DROP INDEX IF EXISTS public.products_active_store_idx;
DROP INDEX IF EXISTS public.shipping_quotes_buyer_idx;
DROP INDEX IF EXISTS public.shipping_shipments_seller_updated_idx;
DROP INDEX IF EXISTS public.shipping_shipments_one_per_order_seller;
DROP INDEX IF EXISTS public.shipping_shipments_order_seller_unique_idx;
