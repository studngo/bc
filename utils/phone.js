/**
 * Normalizes Kenyan phone numbers into the 2547XXXXXXXX / 2541XXXXXXXX
 * format Paystack/M-Pesa expects. Accepts:
 *   07XXXXXXXX, 01XXXXXXXX, 2547XXXXXXXX, 2541XXXXXXXX, +2547XXXXXXXX
 * Returns null if the number is not a valid Kenyan mobile number.
 */
function normalizeKenyanPhone(raw) {
  if (!raw || typeof raw !== 'string') return null;
  let digits = raw.trim().replace(/[\s\-()]/g, '');

  if (digits.startsWith('+')) digits = digits.slice(1);

  // 07XXXXXXXX or 01XXXXXXXX -> 2547XXXXXXXX / 2541XXXXXXXX
  if (/^0[17]\d{8}$/.test(digits)) {
    digits = `254${digits.slice(1)}`;
  }

  // Already 2547XXXXXXXX or 2541XXXXXXXX
  if (/^254[17]\d{8}$/.test(digits)) {
    return digits;
  }

  return null;
}

module.exports = { normalizeKenyanPhone };
