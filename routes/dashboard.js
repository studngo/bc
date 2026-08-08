const express = require('express');
const supabase = require('../config/supabaseClient');
const { throwIfSupabaseError } = require('../utils/supabaseErrors');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

const GRADES = ['Grade 1', 'Grade 2', 'Grade 3', 'Grade 4', 'Grade 5', 'Grade 6', 'Grade 7', 'Grade 8', 'Grade 9'];
const HOUSEHOLD_TYPES = ['Permanent', 'Semi-permanent', 'Mud house'];
const GUARDIAN_STATUSES = ['Both Parents', 'One Parent', 'Orphan'];

// GET /api/dashboard/stats — ADMIN ONLY
// All aggregation happens in a single Postgres function (get_dashboard_stats,
// see db/schema.sql) since grouped counts aren't practical through the
// PostgREST query builder — one round trip instead of six.
router.get('/stats', requireAuth, async (req, res, next) => {
  try {
    const { data, error } = await supabase.rpc('get_dashboard_stats');
    throwIfSupabaseError(error);

    // json_object_agg omits grades/categories with zero confirmed students —
    // fill in the zeroes so the dashboard always shows every row.
    const gradeBreakdown = {};
    GRADES.forEach((g) => { gradeBreakdown[g] = data.gradeBreakdown[g] || 0; });

    const householdStatistics = {};
    HOUSEHOLD_TYPES.forEach((h) => { householdStatistics[h] = data.householdStatistics[h] || 0; });

    const guardianStatistics = {};
    GUARDIAN_STATUSES.forEach((g) => { guardianStatistics[g] = data.guardianStatistics[g] || 0; });

    res.json({
      totalStudents: data.totalStudents,
      primaryStudents: data.primaryStudents,
      juniorSecondaryStudents: data.juniorSecondaryStudents,
      gradeBreakdown,
      totalRegistrations: data.totalRegistrations,
      successfulPayments: data.successfulPayments,
      pendingPayments: data.pendingPayments,
      totalAmountCollected: Number(data.totalAmountCollected),
      householdStatistics,
      guardianStatistics
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
