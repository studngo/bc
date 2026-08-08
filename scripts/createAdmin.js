/**
 * Creates (or updates the password for) an administrator account.
 * Usage:
 *   node scripts/createAdmin.js "admin@example.org" "StrongPassword123!" "Admin Name"
 */
require('dotenv').config();
const bcrypt = require('bcryptjs');
const supabase = require('../config/supabaseClient');

async function main() {
  const [, , email, password, fullName] = process.argv;

  if (!email || !password || !fullName) {
    console.error('Usage: node scripts/createAdmin.js "<email>" "<password>" "<full name>"');
    process.exit(1);
  }
  if (password.length < 8) {
    console.error('Password must be at least 8 characters.');
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const normalizedEmail = email.toLowerCase().trim();

  const { error } = await supabase
    .from('admins')
    .upsert(
      { email: normalizedEmail, password_hash: passwordHash, full_name: fullName, role: 'admin' },
      { onConflict: 'email' }
    );

  if (error) {
    console.error('Failed to create admin:', error.message);
    process.exit(1);
  }

  console.log(`Admin account ready for ${normalizedEmail}`);
  process.exit(0);
}

main().catch((err) => {
  console.error('Failed to create admin:', err.message);
  process.exit(1);
});
