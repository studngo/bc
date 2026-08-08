// Single source of truth for grade / section / identification-type rules.
// Used by both the registrations and students controllers so the backend
// never has to trust anything the client claims about a grade.

const PRICE_PER_STUDENT = 100; // KSh, integer amount

const GRADES = {
  'Grade 1': { section: 'primary', idType: 'birth_certificate_entry_number' },
  'Grade 2': { section: 'primary', idType: 'birth_certificate_entry_number' },
  'Grade 3': { section: 'primary', idType: 'assessment_number' },
  'Grade 4': { section: 'primary', idType: 'assessment_number' },
  'Grade 5': { section: 'primary', idType: 'assessment_number' },
  'Grade 6': { section: 'primary', idType: 'assessment_number' },
  'Grade 7': { section: 'junior_secondary', idType: 'assessment_number' },
  'Grade 8': { section: 'junior_secondary', idType: 'assessment_number' },
  'Grade 9': { section: 'junior_secondary', idType: 'assessment_number' }
};

const GENDERS = ['Male', 'Female'];
const HOUSEHOLD_TYPES = ['Permanent', 'Semi-permanent', 'Mud house'];
const GUARDIAN_STATUSES = ['Both Parents', 'One Parent', 'Orphan'];

function isValidGrade(grade) {
  return Object.prototype.hasOwnProperty.call(GRADES, grade);
}

module.exports = {
  PRICE_PER_STUDENT,
  GRADES,
  GENDERS,
  HOUSEHOLD_TYPES,
  GUARDIAN_STATUSES,
  isValidGrade
};
