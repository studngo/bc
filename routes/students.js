const express = require('express');
const supabase = require('../config/supabaseClient');
const { throwIfSupabaseError } = require('../utils/supabaseErrors');
const { ApiError } = require('../middleware/errorHandler');
const { requireAuth } = require('../middleware/auth');
const { recalculateRegistrationAmount } = require('../services/registrationService');

const router = express.Router();

// PUT /api/students/:id — edit a student while still unconfirmed (pre-payment)
router.put('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const {
      identificationNumber, firstName, middleName, surname, gender, householdType, guardianStatus
    } = req.body;

    const { data: existing, error: fetchError } = await supabase
      .from('students')
      .select('id, registration_id, registrations(payment_status)')
      .eq('id', id)
      .maybeSingle();
    throwIfSupabaseError(fetchError);
    if (!existing) throw new ApiError(404, 'Student not found.');
    if (existing.registrations.payment_status !== 'pending') {
      throw new ApiError(400, 'This student has already been finalized and can no longer be edited.');
    }

    if (!identificationNumber || !String(identificationNumber).trim()) {
      throw new ApiError(400, 'Identification number is required.');
    }
    if (!firstName || !String(firstName).trim()) throw new ApiError(400, 'First name is required.');
    if (!surname || !String(surname).trim()) throw new ApiError(400, 'Surname is required.');
    if (!['Male', 'Female'].includes(gender)) throw new ApiError(400, 'Please select a valid gender.');
    if (!['Permanent', 'Semi-permanent', 'Mud house'].includes(householdType)) {
      throw new ApiError(400, 'Please select a valid household type.');
    }
    if (!['Both Parents', 'One Parent', 'Orphan'].includes(guardianStatus)) {
      throw new ApiError(400, 'Please select a valid guardian status.');
    }

    const { data: student, error } = await supabase
      .from('students')
      .update({
        identification_number: String(identificationNumber).trim(),
        first_name: String(firstName).trim(),
        middle_name: middleName ? String(middleName).trim() : null,
        surname: String(surname).trim(),
        gender,
        household_type: householdType,
        guardian_status: guardianStatus
      })
      .eq('id', id)
      .select('*')
      .single();

    if (error && error.code === '23505') {
      throw new ApiError(409, 'This student identification number has already been registered.');
    }
    throwIfSupabaseError(error);

    res.json({ student });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/students/:id — remove a student while still unconfirmed
router.delete('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;

    const { data: existing, error: fetchError } = await supabase
      .from('students')
      .select('id, registration_id, registrations(payment_status)')
      .eq('id', id)
      .maybeSingle();
    throwIfSupabaseError(fetchError);
    if (!existing) throw new ApiError(404, 'Student not found.');
    if (existing.registrations.payment_status !== 'pending') {
      throw new ApiError(400, 'This student has already been finalized and can no longer be removed.');
    }

    const { error } = await supabase.from('students').delete().eq('id', id);
    throwIfSupabaseError(error);

    await recalculateRegistrationAmount(existing.registration_id);

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// GET /api/students — ADMIN ONLY: search & filter confirmed student records
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const {
      q, section, grade, gender, householdType, guardianStatus,
      page = 1, pageSize = 25
    } = req.query;

    const limit = Math.min(parseInt(pageSize, 10) || 25, 100);
    const currentPage = Math.max(parseInt(page, 10) || 1, 1);
    const from = (currentPage - 1) * limit;
    const to = from + limit - 1;

    let query = supabase
      .from('students')
      .select(
        'id, school_section, grade, identification_type, identification_number, first_name, middle_name, surname, gender, household_type, guardian_status, created_at',
        { count: 'exact' }
      )
      .eq('status', 'confirmed');

    if (q) {
      const term = `%${q}%`;
      query = query.or(
        `first_name.ilike.${term},surname.ilike.${term},middle_name.ilike.${term},identification_number.ilike.${term}`
      );
    }
    if (section) query = query.eq('school_section', section);
    if (grade) query = query.eq('grade', grade);
    if (gender) query = query.eq('gender', gender);
    if (householdType) query = query.eq('household_type', householdType);
    if (guardianStatus) query = query.eq('guardian_status', guardianStatus);

    const { data: students, count, error } = await query
      .order('created_at', { ascending: false })
      .range(from, to);
    throwIfSupabaseError(error);

    res.json({ students, total: count, page: currentPage, pageSize: limit });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
