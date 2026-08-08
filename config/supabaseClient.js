const { createClient } = require('@supabase/supabase-js');

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error('FATAL: SUPABASE_URL and/or SUPABASE_SERVICE_ROLE_KEY are not set. Check your .env file.');
}

// The SERVICE ROLE key bypasses Row Level Security — this client must only
// ever be used on the backend. Never send this key to the frontend.
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});

module.exports = supabase;
