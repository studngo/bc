const express = require('express');
const rateLimit = require('express-rate-limit');
const supabase = require('../config/supabaseClient');
const { throwIfSupabaseError } = require('../utils/supabaseErrors');
const { ApiError } = require('../middleware/errorHandler');

const router = express.Router();

// School codes are shorter and self-chosen, so guessing is easier than an
// admin password — rate-limit login attempts to slow that down.
const schoolLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Please try again in a few minutes.' }
});

function validateSchoolInput(schoolName, schoolCode) {
  if (!schoolName || !String(schoolName).trim()) {
    throw new ApiError(400, "Please enter the school's name.");
  }
  if (!schoolCode || !String(schoolCode).trim()) {
    throw new ApiError(400, 'Please choose a school code.');
  }
  const code = String(schoolCode).trim();
  if (code.length < 4 || code.length > 50) {
    throw new ApiError(400, 'School code must be between 4 and 50 characters.');
  }
}

// POST /api/schools/register — create a new school account
router.post('/register', async (req, res, next) => {
  try {
    const { schoolName, schoolCode } = req.body;
    validateSchoolInput(schoolName, schoolCode);

    const { data: school, error } = await supabase
      .from('schools')
      .insert({ school_name: String(schoolName).trim(), school_code: String(schoolCode).trim() })
      .select('id, school_name, created_at')
      .single();

    if (error && error.code === '23505') {
      throw new ApiError(409, 'That school code is already taken. Please choose a different one.');
    }
    throwIfSupabaseError(error);

    res.status(201).json({ school: { id: school.id, schoolName: school.school_name } });
  } catch (err) {
    next(err);
  }
});

// POST /api/schools/login — resume an existing school account with its code
router.post('/login', schoolLoginLimiter, async (req, res, next) => {
  try {
    const { schoolCode } = req.body;
    if (!schoolCode || !String(schoolCode).trim()) {
      throw new ApiError(400, 'Please enter your school code.');
    }

    const { data: school, error } = await supabase
      .from('schools')
      .select('id, school_name')
      .ilike('school_code', String(schoolCode).trim())
      .maybeSingle();
    throwIfSupabaseError(error);

    if (!school) {
      throw new ApiError(401, 'We could not find a school with that code. Please check and try again.');
    }

    res.json({ school: { id: school.id, schoolName: school.school_name } });
  } catch (err) {
    next(err);
  }
});

// GET /api/schools/:id — restore a session from a previously stored school id
router.get('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { data: school, error } = await supabase
      .from('schools')
      .select('id, school_name')
      .eq('id', id)
      .maybeSingle();
    throwIfSupabaseError(error);
    if (!school) throw new ApiError(404, 'School account not found.');

    res.json({ school: { id: school.id, schoolName: school.school_name } });
  } catch (err) {
    next(err);
  }
});

// GET /api/schools/:id/registrations — full persistent history for this school,
// newest first, each with its nested students. This is what powers the
// "your registered students" list that updates as the school adds more.
router.get('/:id/registrations', async (req, res, next) => {
  try {
    const { id } = req.params;

    const { data: school, error: schoolError } = await supabase
      .from('schools')
      .select('id')
      .eq('id', id)
      .maybeSingle();
    throwIfSupabaseError(schoolError);
    if (!school) throw new ApiError(404, 'School account not found.');

    const { data: registrations, error } = await supabase.rpc('get_school_registrations', {
      p_school_id: id
    });
    throwIfSupabaseError(error);

    res.json({ registrations });
  } catch (err) {
    next(err);
  }
});

// GET /api/schools/:id/pending-registration — the school's current unpaid
// cart, if one exists, so returning to the site resumes it instead of
// starting a new one every visit.
router.get('/:id/pending-registration', async (req, res, next) => {
  try {
    const { id } = req.params;

    const { data: registration, error } = await supabase
      .from('registrations')
      .select('*')
      .eq('school_id', id)
      .eq('payment_status', 'pending')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    throwIfSupabaseError(error);

    res.json({ registration: registration || null });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
