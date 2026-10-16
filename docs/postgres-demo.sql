-- Read-only queries for pgAdmin. Execute after connecting to the project database.
-- 1. Server and current database
SELECT version(), current_database(), current_user;
-- 2. Application tables
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name;
-- 3. Bookings without names, phone numbers, or public access tokens
SELECT id, location_id, date, start_time, end_time, status, total_price, created_at
FROM public.bookings ORDER BY created_at DESC LIMIT 30;
-- 4. Booking totals
SELECT status, COUNT(*) AS booking_count FROM public.bookings GROUP BY status ORDER BY status;
-- 5. Column definitions
SELECT table_name, column_name, data_type, is_nullable
FROM information_schema.columns WHERE table_schema = 'public'
ORDER BY table_name, ordinal_position;
