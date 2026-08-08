const crypto = require('crypto');

/**
 * Generates a human-readable, unique-enough registration reference.
 * Example: REG-2026-9F3K7Q
 */
function generateRegistrationReference() {
  const year = new Date().getFullYear();
  const random = crypto.randomBytes(4).toString('hex').toUpperCase().slice(0, 6);
  return `REG-${year}-${random}`;
}

module.exports = { generateRegistrationReference };
