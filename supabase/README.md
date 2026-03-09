# Supabase migrations

Run these in your Supabase project (SQL Editor or CLI).

## Apply `001_create_profiles.sql`

1. Open [Supabase Dashboard](https://supabase.com/dashboard) → your project → **SQL Editor**.
2. Paste the contents of `migrations/001_create_profiles.sql`.
3. Run the query.

This creates the `profiles` table, RLS policies, and the trigger that creates a profile row when a new user signs up in `auth.users`.
