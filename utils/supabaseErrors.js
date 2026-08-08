/**
 * supabase-js returns { data, error } instead of throwing. This converts a
 * PostgREST error into a regular JS Error, preserving the underlying
 * Postgres error code (e.g. '23505' for a unique-constraint violation) so
 * the central errorHandler middleware can keep handling it the same way
 * it did with the old pg-based code.
 */
function throwIfSupabaseError(error) {
  if (!error) return;
  const err = new Error(error.message || 'Database error');
  if (error.code) err.code = error.code;
  throw err;
}

module.exports = { throwIfSupabaseError };
