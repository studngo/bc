-- Students NGO-Help — add School accounts
-- Run this ONCE in the Supabase SQL Editor against your EXISTING project.
-- It only adds new things (a table, a column, indexes, functions) — it does
-- not touch or delete any data already in registrations/students/admins.

-- ============================================================
-- SCHOOLS
-- A school "account" identified by a name + a self-chosen access code.
-- The code works like a Google Classroom join code — a shared, memorable
-- code the school keeps to come back and see their own registered
-- students. It is NOT a security boundary the way the admin login is:
-- anyone with the code can view/add that school's own registrations, but
-- individual student PII across the whole platform still only surfaces
-- through the admin-authenticated endpoints. Document this to whoever
-- distributes codes.
-- ============================================================
CREATE TABLE IF NOT EXISTS schools (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    school_name     VARCHAR(255) NOT NULL,
    school_code     VARCHAR(50) NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Case-insensitive uniqueness: "ABC123" and "abc123" are treated as the same code.
CREATE UNIQUE INDEX IF NOT EXISTS uq_schools_code_lower ON schools (lower(school_code));

ALTER TABLE schools ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- Link registrations to the school that created them
-- ============================================================
ALTER TABLE registrations ADD COLUMN IF NOT EXISTS school_id UUID REFERENCES schools(id);
CREATE INDEX IF NOT EXISTS idx_registrations_school ON registrations(school_id);

-- ============================================================
-- RPC: a school's full registration + student history, newest first.
-- Powers the "your registered students" view that updates as the school
-- adds more — the frontend just refetches this after every add/edit/delete.
-- ============================================================
CREATE OR REPLACE FUNCTION get_school_registrations(p_school_id UUID)
RETURNS JSON
LANGUAGE plpgsql
AS $$
DECLARE
  result JSON;
BEGIN
  SELECT COALESCE(json_agg(row_to_json(r) ORDER BY r.created_at DESC), '[]'::json) INTO result
  FROM (
    SELECT
      reg.id,
      reg.registration_reference,
      reg.number_of_students,
      reg.amount,
      reg.payment_status,
      reg.created_at,
      reg.paid_at,
      (
        SELECT COALESCE(json_agg(row_to_json(s) ORDER BY s.created_at ASC), '[]'::json)
        FROM (
          SELECT id, school_section, grade, identification_type, identification_number,
                 first_name, middle_name, surname, gender, household_type, guardian_status, status
          FROM students WHERE registration_id = reg.id
        ) s
      ) AS students
    FROM registrations reg
    WHERE reg.school_id = p_school_id
  ) r;

  RETURN result;
END;
$$;
