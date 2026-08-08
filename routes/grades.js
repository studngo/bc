const express = require('express');
const { GRADES, PRICE_PER_STUDENT, GENDERS, HOUSEHOLD_TYPES, GUARDIAN_STATUSES } = require('../config/grades');

const router = express.Router();

// GET /api/grades — lets the frontend render grade cards & forms from one source of truth
router.get('/', (req, res) => {
  res.json({
    pricePerStudent: PRICE_PER_STUDENT,
    grades: GRADES,
    genders: GENDERS,
    householdTypes: HOUSEHOLD_TYPES,
    guardianStatuses: GUARDIAN_STATUSES
  });
});

module.exports = router;
