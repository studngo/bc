-- Students NGO-Help database schema
-- Run this against your PostgreSQL / Supabase database before starting the server.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- ADMINS
-- ============================================================
CREATE TABLE IF NOT EXISTS admins (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email           VARCHAR(255) UNIQUE NOT NULL,
    password_hash   TEXT NOT NULL,
    full_name       VARCHAR(255) NOT NULL,
    role            VARCHAR(50) NOT NULL DEFAULT 'admin',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- SCHOOLS
-- A school "account" identified by a name + a self-chosen access code.
-- The code works like a Google Classroom join code — a shared, memorable
-- code the school keeps to come back and see their own registered
-- students. It is NOT a security boundary the way the admin login is:
-- anyone with the code can view/add that school's own registrations, but
-- individual student PII across the whole platform still only surfaces
-- through the admin-authenticated endpoints.
-- ============================================================
CREATE TABLE IF NOT EXISTS schools (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    school_name     VARCHAR(255) NOT NULL,
    school_code     VARCHAR(50) NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_schools_code_lower ON schools (lower(school_code));

ALTER TABLE schools ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- REGISTRATIONS (one payment "batch" of students, belonging to a school)
-- ============================================================
CREATE TABLE IF NOT EXISTS registrations (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id               UUID REFERENCES schools(id),
    registration_reference  VARCHAR(50) UNIQUE NOT NULL,
    number_of_students      INTEGER NOT NULL DEFAULT 0,
    amount                  NUMERIC(12,2) NOT NULL DEFAULT 0,
    currency                VARCHAR(10) NOT NULL DEFAULT 'KES',
    mpesa_phone             VARCHAR(20),
    paystack_reference      VARCHAR(100) UNIQUE,
    payment_status          VARCHAR(20) NOT NULL DEFAULT 'pending'
                                CHECK (payment_status IN ('pending','paid','failed','cancelled')),
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    paid_at                 TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_registrations_status ON registrations(payment_status);
CREATE INDEX IF NOT EXISTS idx_registrations_paystack_ref ON registrations(paystack_reference);
CREATE INDEX IF NOT EXISTS idx_registrations_school ON registrations(school_id);

-- ============================================================
-- STUDENTS
-- ============================================================
CREATE TABLE IF NOT EXISTS students (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    registration_id     UUID NOT NULL REFERENCES registrations(id) ON DELETE CASCADE,
    school_section       VARCHAR(30) NOT NULL CHECK (school_section IN ('primary','junior_secondary')),
    grade               VARCHAR(20) NOT NULL,
    identification_type VARCHAR(40) NOT NULL CHECK (identification_type IN ('birth_certificate_entry_number','assessment_number')),
    identification_number VARCHAR(100) NOT NULL,
    first_name          VARCHAR(100) NOT NULL,
    middle_name         VARCHAR(100),
    surname             VARCHAR(100) NOT NULL,
    gender              VARCHAR(10) NOT NULL CHECK (gender IN ('Male','Female')),
    household_type      VARCHAR(30) NOT NULL CHECK (household_type IN ('Permanent','Semi-permanent','Mud house')),
    guardian_status      VARCHAR(30) NOT NULL CHECK (guardian_status IN ('Both Parents','One Parent','Orphan')),
    status               VARCHAR(20) NOT NULL DEFAULT 'unconfirmed'
                                CHECK (status IN ('unconfirmed','confirmed')),
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Prevent duplicate identification numbers across the whole platform (per identification type)
CREATE UNIQUE INDEX IF NOT EXISTS uq_students_identification
    ON students(identification_type, identification_number);

CREATE INDEX IF NOT EXISTS idx_students_registration ON students(registration_id);
CREATE INDEX IF NOT EXISTS idx_students_grade ON students(grade);
CREATE INDEX IF NOT EXISTS idx_students_status ON students(status);
CREATE INDEX IF NOT EXISTS idx_students_household ON students(household_type);
CREATE INDEX IF NOT EXISTS idx_students_guardian ON students(guardian_status);
CREATE INDEX IF NOT EXISTS idx_students_name ON students(first_name, surname);

-- ============================================================
-- WEBHOOK EVENTS (idempotency guard for Paystack webhooks)
-- ============================================================
CREATE TABLE IF NOT EXISTS webhook_events (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id        VARCHAR(255) UNIQUE NOT NULL,
    event_type      VARCHAR(100),
    processed_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- ROW LEVEL SECURITY
-- The backend connects using the SERVICE ROLE key, which bypasses RLS
-- entirely — these policies are a defense-in-depth measure in case the
-- anon/public key is ever used against this project by mistake. No
-- policies are defined, so RLS with no policies = deny-all for anon/
-- authenticated roles; only the service role (this backend) can read
-- or write.
-- ============================================================
ALTER TABLE admins ENABLE ROW LEVEL SECURITY;
ALTER TABLE registrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE students ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_events ENABLE ROW LEVEL SECURITY;
-- schools' RLS is enabled where the table is created, above.

-- ============================================================
-- RPC FUNCTIONS
-- supabase-js talks to Postgres over PostgREST (HTTP), which cannot run
-- a multi-statement transaction from the client. Anything that needs to
-- happen atomically — recalculating a registration's payable amount, or
-- finalizing payment across two tables — is implemented as a single
-- Postgres function instead, called via supabase.rpc(...). Each function
-- runs as one atomic transaction on the database side.
-- ============================================================

-- Recalculates number_of_students / amount for a registration directly
-- from the students table. Never trust a count the frontend sends.
CREATE OR REPLACE FUNCTION recalculate_registration_amount(p_registration_id UUID, p_price_per_student INT)
RETURNS TABLE(student_count INT, total_amount NUMERIC)
LANGUAGE plpgsql
AS $$
DECLARE
  v_count INT;
BEGIN
  SELECT COUNT(*)::int INTO v_count FROM students
    WHERE registration_id = p_registration_id AND status = 'unconfirmed';

  UPDATE registrations
    SET number_of_students = v_count, amount = v_count * p_price_per_student
    WHERE id = p_registration_id;

  RETURN QUERY SELECT v_count, (v_count * p_price_per_student)::NUMERIC;
END;
$$;

-- Finalizes a registration after Paystack confirms payment: marks it paid
-- and promotes its students from 'unconfirmed' to 'confirmed'. Idempotent —
-- safe to call more than once for the same registration id (e.g. the
-- webhook fires twice, or the webhook and a manual verify race each other).
-- FOR UPDATE locks the row for the duration of the transaction so two
-- concurrent calls can't both pass the "not yet paid" check.
CREATE OR REPLACE FUNCTION finalize_registration_payment(p_registration_id UUID)
RETURNS TABLE(already_processed BOOLEAN, not_found BOOLEAN)
LANGUAGE plpgsql
AS $$
DECLARE
  v_status TEXT;
BEGIN
  SELECT payment_status INTO v_status FROM registrations WHERE id = p_registration_id FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, TRUE;
    RETURN;
  END IF;

  IF v_status = 'paid' THEN
    RETURN QUERY SELECT TRUE, FALSE;
    RETURN;
  END IF;

  UPDATE registrations SET payment_status = 'paid', paid_at = now() WHERE id = p_registration_id;
  UPDATE students SET status = 'confirmed' WHERE registration_id = p_registration_id AND status = 'unconfirmed';

  RETURN QUERY SELECT FALSE, FALSE;
END;
$$;

-- Returns every figure the admin dashboard needs in one JSON payload.
-- Grouped aggregates (by grade / household / guardian) are easiest to do
-- as a single SQL function rather than several round trips through the
-- REST query builder.
CREATE OR REPLACE FUNCTION get_dashboard_stats()
RETURNS JSON
LANGUAGE plpgsql
AS $$
DECLARE
  result JSON;
BEGIN
  SELECT json_build_object(
    'totalStudents', (SELECT COUNT(*) FROM students WHERE status = 'confirmed'),
    'primaryStudents', (SELECT COUNT(*) FROM students WHERE status = 'confirmed' AND school_section = 'primary'),
    'juniorSecondaryStudents', (SELECT COUNT(*) FROM students WHERE status = 'confirmed' AND school_section = 'junior_secondary'),
    'gradeBreakdown', (
      SELECT COALESCE(json_object_agg(grade, cnt), '{}'::json)
      FROM (SELECT grade, COUNT(*)::int cnt FROM students WHERE status = 'confirmed' GROUP BY grade) g
    ),
    'totalRegistrations', (SELECT COUNT(*) FROM registrations),
    'successfulPayments', (SELECT COUNT(*) FROM registrations WHERE payment_status = 'paid'),
    'pendingPayments', (SELECT COUNT(*) FROM registrations WHERE payment_status = 'pending'),
    'totalAmountCollected', (SELECT COALESCE(SUM(amount), 0) FROM registrations WHERE payment_status = 'paid'),
    'householdStatistics', (
      SELECT COALESCE(json_object_agg(household_type, cnt), '{}'::json)
      FROM (SELECT household_type, COUNT(*)::int cnt FROM students WHERE status = 'confirmed' GROUP BY household_type) h
    ),
    'guardianStatistics', (
      SELECT COALESCE(json_object_agg(guardian_status, cnt), '{}'::json)
      FROM (SELECT guardian_status, COUNT(*)::int cnt FROM students WHERE status = 'confirmed' GROUP BY guardian_status) gu
    )
  ) INTO result;

  RETURN result;
END;
$$;

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
