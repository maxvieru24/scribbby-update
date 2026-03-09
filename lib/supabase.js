const { createClient } = require('@supabase/supabase-js');

const url = process.env.SUPABASE_URL;
const anonKey = process.env.SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

/** Client with anon key – use for user-facing requests (respects RLS). */
function getAnonClient() {
  if (!url || !anonKey) return null;
  return createClient(url, anonKey);
}

/** Client with service role – use only on the server for admin/backend (bypasses RLS). Never expose to the frontend. */
function getServiceClient() {
  if (!url || !serviceRoleKey) return null;
  return createClient(url, serviceRoleKey);
}

module.exports = { getAnonClient, getServiceClient };
