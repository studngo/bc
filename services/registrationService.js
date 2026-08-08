const supabase = require('../config/supabaseClient');
const { throwIfSupabaseError } = require('../utils/supabaseErrors');
const { PRICE_PER_STUDENT } = require('../config/grades');

/**
 * Recalculates number_of_students and amount for a registration directly
 * from the students table via the recalculate_registration_amount RPC —
 * this runs as one atomic transaction on the database, and is the ONLY
 * place the payable amount is derived. The frontend's count is never
 * trusted.
 */
async function recalculateRegistrationAmount(registrationId) {
  const { data, error } = await supabase.rpc('recalculate_registration_amount', {
    p_registration_id: registrationId,
    p_price_per_student: PRICE_PER_STUDENT
  });
  throwIfSupabaseError(error);

  const row = Array.isArray(data) ? data[0] : data;
  return { count: row.student_count, amount: Number(row.total_amount) };
}

/**
 * Finalizes a registration after Paystack confirms payment via the
 * finalize_registration_payment RPC — marks the registration paid and
 * promotes its students from 'unconfirmed' to 'confirmed' in a single
 * atomic Postgres transaction. Idempotent — safe to call more than once
 * for the same registration (e.g. webhook fired twice, or webhook +
 * manual verify race).
 */
async function finalizeRegistrationPayment(registrationId) {
  const { data, error } = await supabase.rpc('finalize_registration_payment', {
    p_registration_id: registrationId
  });
  throwIfSupabaseError(error);

  const row = Array.isArray(data) ? data[0] : data;
  return { alreadyProcessed: row.already_processed, notFound: row.not_found };
}

async function markRegistrationFailed(registrationId) {
  const { error } = await supabase
    .from('registrations')
    .update({ payment_status: 'failed' })
    .eq('id', registrationId)
    .eq('payment_status', 'pending');
  throwIfSupabaseError(error);
}

module.exports = { recalculateRegistrationAmount, finalizeRegistrationPayment, markRegistrationFailed };
