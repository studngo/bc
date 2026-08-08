const express = require('express');
const supabase = require('../config/supabaseClient');
const { throwIfSupabaseError } = require('../utils/supabaseErrors');
const { ApiError } = require('../middleware/errorHandler');
const { generateRegistrationReference } = require('../utils/reference');
const { GRADES, isValidGrade } = require('../config/grades');
const { recalculateRegistrationAmount } = require('../services/registrationService');

const router = express.Router();

// POST /api/registrations — start a new (empty) registration batch
router.post('/', async (req, res, next) => {
  try {
    let reference;
    let attempts = 0;
    // Extremely unlikely to collide, but guard anyway
    while (attempts < 5) {
      reference = generateRegistrationReference();
      const { data: existing, error: checkError } = await supabase
        .from('registrations')
        .select('id')
        .eq('registration_reference', reference)
        .maybeSingle();
      throwIfSupabaseError(checkError);
      if (!existing) break;
      attempts += 1;
    }

    const { data: registration, error } = await supabase
      .from('registrations')
      .insert({
        registration_reference: reference,
        number_of_students: 0,
        amount: 0,
        payment_status: 'pending'
      })
      .select('id, registration_reference, payment_status, created_at')
      .single();
    throwIfSupabaseError(error);

    res.status(201).json({ registration });
  } catch (err) {
    next(err);
  }
});

// GET /api/registrations/:id — registration + its students (used for the summary screen)
router.get('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;

    const { data: registration, error: regError } = await supabase
      .from('registrations')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    throwIfSupabaseError(regError);
    if (!registration) throw new ApiError(404, 'Registration not found.');

    const { data: students, error: studentsError } = await supabase
      .from('students')
      .select(
        'id, school_section, grade, identification_type, identification_number, first_name, middle_name, surname, gender, household_type, guardian_status, status'
      )
      .eq('registration_id', id)
      .order('created_at', { ascending: true });
    throwIfSupabaseError(studentsError);

    res.json({ registration, students });
  } catch (err) {
    next(err);
  }
});

// POST /api/registrations/:id/students — add a student to a pending registration
router.post('/:id/students', async (req, res, next) => {
  try {
    const { id } = req.params;
    const {
      grade,
      identificationNumber,
      firstName,
      middleName,
      surname,
      gender,
      householdType,
      guardianStatus
    } = req.body;

    const { data: registration, error: regError } = await supabase
      .from('registrations')
      .select('id, payment_status')
      .eq('id', id)
      .maybeSingle();
    throwIfSupabaseError(regError);
    if (!registration) throw new ApiError(404, 'Registration not found.');
    if (registration.payment_status !== 'pending') {
      throw new ApiError(400, 'This registration has already been paid for or is no longer editable.');
    }

    if (!isValidGrade(grade)) throw new ApiError(400, 'Please select a valid grade.');
    if (!identificationNumber || !String(identificationNumber).trim()) {
      const label =
        GRADES[grade].idType === 'birth_certificate_entry_number'
          ? "Please enter the student's Birth Certificate Entry Number."
          : "Please enter the student's Assessment Number.";
      throw new ApiError(400, label);
    }
    if (!firstName || !String(firstName).trim()) throw new ApiError(400, "Please enter the student's first name.");
    if (!surname || !String(surname).trim()) throw new ApiError(400, "Please enter the student's surname.");
    if (!['Male', 'Female'].includes(gender)) throw new ApiError(400, "Please select the student's gender.");
    if (!['Permanent', 'Semi-permanent', 'Mud house'].includes(householdType)) {
      throw new ApiError(400, 'Please select the type of household.');
    }
    if (!['Both Parents', 'One Parent', 'Orphan'].includes(guardianStatus)) {
      throw new ApiError(400, "Please select who the student lives with.");
    }

    const gradeConfig = GRADES[grade];

    const { data: student, error } = await supabase
      .from('students')
      .insert({
        registration_id: id,
        school_section: gradeConfig.section,
        grade,
        identification_type: gradeConfig.idType,
        identification_number: String(identificationNumber).trim(),
        first_name: String(firstName).trim(),
        middle_name: middleName ? String(middleName).trim() : null,
        surname: String(surname).trim(),
        gender,
        household_type: householdType,
        guardian_status: guardianStatus,
        status: 'unconfirmed'
      })
      .select('*')
      .single();

    if (error && error.code === '23505') {
      throw new ApiError(409, 'This student identification number has already been registered.');
    }
    throwIfSupabaseError(error);

    await recalculateRegistrationAmount(id);

    res.status(201).json({ student });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
