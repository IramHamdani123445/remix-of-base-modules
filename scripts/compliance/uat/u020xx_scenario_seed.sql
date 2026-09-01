-- =====================================================================
-- U020xx SCENARIO-EMPLOYER COHORT — Compliance certification fixtures
-- =====================================================================
-- TEST ONLY. Idempotent: safe to re-run. Teardown at the bottom.
--
-- Architecture: this file deliberately reuses the SAME fixture pattern
-- established by scripts/compliance/uat/batch1_seed.sql (U010xx cohort):
--   * employers live in er_master with a 'U0....' regno
--   * C3 filing history lives in cn_c3_reported
--   * payment history lives in cn_payment_header + cn_payment
--   * everything derived (obligation periods, violations, review flags,
--     risk scores) is produced by the REAL workers, never hand-inserted:
--        ce-obligation-lifecycle  (obligation timeline + reminders)
--        ce-violation-scan        (DR-001..DR-013)
--        ce-risk-recalculation    (five-factor risk)
--
-- Deterministic TEST basis
-- ------------------------
-- Active policy POL-2024-002: deadline_basis=calendar_month_end,
-- reporting_offset_months=1, grace 0/0.
--   wage period M  ->  due date = last day of (M + 1 month)
-- Wage periods used: 2026-01-01 .. 2026-06-01
--   2026-06 wage period is due 2026-07-31 — already elapsed at the
--   controlled TEST as-of date 2026-08-29, so no scenario depends on
--   "today". Re-runs are stable.
--
-- Per-period contribution basis (3 employees unless stated):
--   total_wages 10,000  ss 1,100  levy 350  pension/PE 100
--   period liability = 1,550.00
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 1. Scenario employers
-- ---------------------------------------------------------------------
INSERT INTO er_master (regno, name, office_code, status, registration_date,
                       date_wages_first_paid, date_incorporated, industrial_code,
                       village_code, sector_code, activity_type, hq_addr1, mobile, email)
VALUES
 ('U02001','U020 Clean Control Ltd',            'STK','A','2023-01-10','2026-01-01','2023-01-01','7220','001','P','Consulting','U020 Test Site','8695560001','u020.01@example.test'),
 ('U02002','U020 Non-Reporting Ltd',            'STK','A','2023-01-10','2026-01-01','2023-01-01','7220','001','P','Consulting','U020 Test Site','8695560002','u020.02@example.test'),
 ('U02003','U020 Late Reporting Ltd',           'STK','A','2023-01-10','2026-01-01','2023-01-01','7220','001','P','Consulting','U020 Test Site','8695560003','u020.03@example.test'),
 ('U02004','U020 Non-Payment Ltd',              'STK','A','2023-01-10','2026-01-01','2023-01-01','7220','001','P','Consulting','U020 Test Site','8695560004','u020.04@example.test'),
 ('U02005','U020 Late Payment Resolution Ltd',  'STK','A','2023-01-10','2026-01-01','2023-01-01','7220','001','P','Consulting','U020 Test Site','8695560005','u020.05@example.test'),
 ('U02006','U020 Partial Payment Ltd',          'STK','A','2023-01-10','2026-01-01','2023-01-01','7220','001','P','Consulting','U020 Test Site','8695560006','u020.06@example.test'),
 ('U02007','U020 Healthy Arrangement Ltd',      'STK','A','2023-01-10','2026-01-01','2023-01-01','7220','001','P','Consulting','U020 Test Site','8695560007','u020.07@example.test'),
 ('U02008','U020 Arrangement Breach Ltd',       'STK','A','2023-01-10','2026-01-01','2023-01-01','7220','001','P','Consulting','U020 Test Site','8695560008','u020.08@example.test'),
 ('U02009','U020 Inspection Pathway Ltd',       'STK','A','2023-01-10','2026-01-01','2023-01-01','7220','001','P','Consulting','U020 Test Site','8695560009','u020.09@example.test'),
 ('U02010','U020 Headcount Anomaly Ltd',        'STK','A','2023-01-10','2026-01-01','2023-01-01','7220','001','P','Consulting','U020 Test Site','8695560010','u020.10@example.test'),
 ('U02011','U020 Wage Anomaly Ltd',             'STK','A','2023-01-10','2026-01-01','2023-01-01','7220','001','P','Construction','U020 Test Site','8695560011','u020.11@example.test'),
 ('U02012','U020 Repeat Offender Ltd',          'STK','A','2023-01-10','2026-01-01','2023-01-01','7220','001','P','Consulting','U020 Test Site','8695560012','u020.12@example.test'),
 ('U02013','U020 Exemption Ltd',                'STK','A','2023-01-10','2026-01-01','2023-01-01','7220','001','P','Consulting','U020 Test Site','8695560013','u020.13@example.test'),
 ('U02014','U020 Cessation Ltd',                'STK','A','2023-01-10','2026-01-01','2023-01-01','7220','001','P','Consulting','U020 Test Site','8695560014','u020.14@example.test'),
 ('U02015','U020 Legal Escalation Ltd',         'STK','A','2023-01-10','2026-01-01','2023-01-01','7220','001','P','Consulting','U020 Test Site','8695560015','u020.15@example.test'),
 ('U02016','U020 Arrears Threshold Ltd',        'STK','A','2023-01-10','2026-01-01','2023-01-01','7220','001','P','Consulting','U020 Test Site','8695560016','u020.16@example.test'),
 ('U02017','U020 Multi-Factor Risk Ltd',        'STK','A','2023-01-10','2026-01-01','2023-01-01','7220','001','P','Consulting','U020 Test Site','8695560017','u020.17@example.test'),
 ('U02018','U020 Payment Stops Escalation Ltd', 'STK','A','2023-01-10','2026-01-01','2023-01-01','7220','001','P','Consulting','U020 Test Site','8695560018','u020.18@example.test'),
 ('U02019','U020 Waiver Resolution Ltd',        'STK','A','2023-01-10','2026-01-01','2023-01-01','7220','001','P','Consulting','U020 Test Site','8695560019','u020.19@example.test'),
 ('U02020','U020 Compound Case Ltd',            'STK','A','2023-01-10','2026-01-01','2023-01-01','7220','001','P','Consulting','U020 Test Site','8695560020','u020.20@example.test')
ON CONFLICT (regno) DO UPDATE
  SET name = EXCLUDED.name,
      status = 'A',
      sector_code = EXCLUDED.sector_code,
      date_wages_first_paid = EXCLUDED.date_wages_first_paid;

-- ---------------------------------------------------------------------
-- 2. C3 filing history
-- ---------------------------------------------------------------------
-- Helper CTE contract for every insert below:
--   period            wage period (first day of month)
--   due               last day of (period + 1 month)
--   received          date_received (NULL row simply not inserted)
--   employees / wages / ss / levy / pe
-- ---------------------------------------------------------------------

-- Clear prior U020 C3 rows so re-runs are deterministic (TEST cohort only).
DELETE FROM cn_c3_reported WHERE payer_id LIKE 'U020%';

WITH spec(regno, period, received, employees, wages, ss, levy, pe) AS (VALUES
  -- U02001 CLEAN CONTROL — every period filed 5 days before the deadline
  ('U02001','2026-01-01','2026-02-24',3,10000.0,1100.0,350.0,100.0),
  ('U02001','2026-02-01','2026-03-26',3,10000.0,1100.0,350.0,100.0),
  ('U02001','2026-03-01','2026-04-25',3,10000.0,1100.0,350.0,100.0),
  ('U02001','2026-04-01','2026-05-26',3,10000.0,1100.0,350.0,100.0),
  ('U02001','2026-05-01','2026-06-25',3,10000.0,1100.0,350.0,100.0),
  ('U02001','2026-06-01','2026-07-26',3,10000.0,1100.0,350.0,100.0),

  -- U02002 NON-REPORTING — filed Jan..Apr, then nothing (May, Jun missing)
  ('U02002','2026-01-01','2026-02-24',3,10000.0,1100.0,350.0,100.0),
  ('U02002','2026-02-01','2026-03-26',3,10000.0,1100.0,350.0,100.0),
  ('U02002','2026-03-01','2026-04-25',3,10000.0,1100.0,350.0,100.0),
  ('U02002','2026-04-01','2026-05-26',3,10000.0,1100.0,350.0,100.0),

  -- U02003 LATE REPORTING — May filed 2026-07-15 (due 2026-06-30)
  ('U02003','2026-01-01','2026-02-24',3,10000.0,1100.0,350.0,100.0),
  ('U02003','2026-02-01','2026-03-26',3,10000.0,1100.0,350.0,100.0),
  ('U02003','2026-03-01','2026-04-25',3,10000.0,1100.0,350.0,100.0),
  ('U02003','2026-04-01','2026-05-26',3,10000.0,1100.0,350.0,100.0),
  ('U02003','2026-05-01','2026-07-15',3,10000.0,1100.0,350.0,100.0),
  ('U02003','2026-06-01','2026-07-26',3,10000.0,1100.0,350.0,100.0),

  -- U02004 NON-PAYMENT — filed on time throughout, payment seeded only Jan..Apr
  ('U02004','2026-01-01','2026-02-24',3,10000.0,1100.0,350.0,100.0),
  ('U02004','2026-02-01','2026-03-26',3,10000.0,1100.0,350.0,100.0),
  ('U02004','2026-03-01','2026-04-25',3,10000.0,1100.0,350.0,100.0),
  ('U02004','2026-04-01','2026-05-26',3,10000.0,1100.0,350.0,100.0),
  ('U02004','2026-05-01','2026-06-25',3,10000.0,1100.0,350.0,100.0),
  ('U02004','2026-06-01','2026-07-26',3,10000.0,1100.0,350.0,100.0),

  -- U02005 LATE PAYMENT / RESOLUTION — April paid late but in full
  ('U02005','2026-01-01','2026-02-24',3,10000.0,1100.0,350.0,100.0),
  ('U02005','2026-02-01','2026-03-26',3,10000.0,1100.0,350.0,100.0),
  ('U02005','2026-03-01','2026-04-25',3,10000.0,1100.0,350.0,100.0),
  ('U02005','2026-04-01','2026-05-26',3,10000.0,1100.0,350.0,100.0),
  ('U02005','2026-05-01','2026-06-25',3,10000.0,1100.0,350.0,100.0),
  ('U02005','2026-06-01','2026-07-26',3,10000.0,1100.0,350.0,100.0),

  -- U02006 PARTIAL PAYMENT — June only partly settled
  ('U02006','2026-01-01','2026-02-24',3,10000.0,1100.0,350.0,100.0),
  ('U02006','2026-02-01','2026-03-26',3,10000.0,1100.0,350.0,100.0),
  ('U02006','2026-03-01','2026-04-25',3,10000.0,1100.0,350.0,100.0),
  ('U02006','2026-04-01','2026-05-26',3,10000.0,1100.0,350.0,100.0),
  ('U02006','2026-05-01','2026-06-25',3,10000.0,1100.0,350.0,100.0),
  ('U02006','2026-06-01','2026-07-26',3,10000.0,1100.0,350.0,100.0),

  -- U02007 HEALTHY ARRANGEMENT — filed, unpaid Mar..Jun (arrangement covers it)
  ('U02007','2026-01-01','2026-02-24',3,10000.0,1100.0,350.0,100.0),
  ('U02007','2026-02-01','2026-03-26',3,10000.0,1100.0,350.0,100.0),
  ('U02007','2026-03-01','2026-04-25',3,10000.0,1100.0,350.0,100.0),
  ('U02007','2026-04-01','2026-05-26',3,10000.0,1100.0,350.0,100.0),
  ('U02007','2026-05-01','2026-06-25',3,10000.0,1100.0,350.0,100.0),
  ('U02007','2026-06-01','2026-07-26',3,10000.0,1100.0,350.0,100.0),

  -- U02008 ARRANGEMENT BREACH — same filing shape as U02007
  ('U02008','2026-01-01','2026-02-24',3,10000.0,1100.0,350.0,100.0),
  ('U02008','2026-02-01','2026-03-26',3,10000.0,1100.0,350.0,100.0),
  ('U02008','2026-03-01','2026-04-25',3,10000.0,1100.0,350.0,100.0),
  ('U02008','2026-04-01','2026-05-26',3,10000.0,1100.0,350.0,100.0),
  ('U02008','2026-05-01','2026-06-25',3,10000.0,1100.0,350.0,100.0),
  ('U02008','2026-06-01','2026-07-26',3,10000.0,1100.0,350.0,100.0),

  -- U02009 INSPECTION PATHWAY — deliberately clean on paper so that the only
  -- violation that can appear is the one converted from an inspection finding
  ('U02009','2026-01-01','2026-02-24',3,10000.0,1100.0,350.0,100.0),
  ('U02009','2026-02-01','2026-03-26',3,10000.0,1100.0,350.0,100.0),
  ('U02009','2026-03-01','2026-04-25',3,10000.0,1100.0,350.0,100.0),
  ('U02009','2026-04-01','2026-05-26',3,10000.0,1100.0,350.0,100.0),
  ('U02009','2026-05-01','2026-06-25',3,10000.0,1100.0,350.0,100.0),
  ('U02009','2026-06-01','2026-07-26',3,10000.0,1100.0,350.0,100.0),

  -- U02010 HEADCOUNT ANOMALY — steady 12 employees, then 3 in June
  ('U02010','2026-01-01','2026-02-24',12,42000.0,4620.0,1470.0,420.0),
  ('U02010','2026-02-01','2026-03-26',12,42000.0,4620.0,1470.0,420.0),
  ('U02010','2026-03-01','2026-04-25',12,42000.0,4620.0,1470.0,420.0),
  ('U02010','2026-04-01','2026-05-26',12,42000.0,4620.0,1470.0,420.0),
  ('U02010','2026-05-01','2026-06-25',12,42000.0,4620.0,1470.0,420.0),
  ('U02010','2026-06-01','2026-07-26', 3,10500.0,1155.0, 367.5,105.0),

  -- U02011 WAGE ANOMALY — sector P benchmark min 400 / avg 700 per employee.
  -- Normal 700/employee, June collapses to 100/employee.
  ('U02011','2026-01-01','2026-02-24',10,7000.0,770.0,245.0,70.0),
  ('U02011','2026-02-01','2026-03-26',10,7000.0,770.0,245.0,70.0),
  ('U02011','2026-03-01','2026-04-25',10,7000.0,770.0,245.0,70.0),
  ('U02011','2026-04-01','2026-05-26',10,7000.0,770.0,245.0,70.0),
  ('U02011','2026-05-01','2026-06-25',10,7000.0,770.0,245.0,70.0),
  ('U02011','2026-06-01','2026-07-26',10,1000.0,110.0, 35.0,10.0),

  -- U02012 REPEAT OFFENDER — three LATE FILINGS (same type) inside 12 months
  -- plus one on-time-but-unpaid period as a mixed-type negative control.
  ('U02012','2026-01-01','2026-03-20',3,10000.0,1100.0,350.0,100.0),  -- late (due 2026-02-28)
  ('U02012','2026-02-01','2026-04-20',3,10000.0,1100.0,350.0,100.0),  -- late (due 2026-03-31)
  ('U02012','2026-03-01','2026-05-20',3,10000.0,1100.0,350.0,100.0),  -- late (due 2026-04-30)
  ('U02012','2026-04-01','2026-05-26',3,10000.0,1100.0,350.0,100.0),  -- on time
  ('U02012','2026-05-01','2026-06-25',3,10000.0,1100.0,350.0,100.0),  -- on time, unpaid (mixed type)
  ('U02012','2026-06-01','2026-07-26',3,10000.0,1100.0,350.0,100.0),

  -- U02013 CONTRIBUTION EXEMPTION — levy reported as zero (exemption in force)
  ('U02013','2026-01-01','2026-02-24',3,10000.0,1100.0,0.0,100.0),
  ('U02013','2026-02-01','2026-03-26',3,10000.0,1100.0,0.0,100.0),
  ('U02013','2026-03-01','2026-04-25',3,10000.0,1100.0,0.0,100.0),
  ('U02013','2026-04-01','2026-05-26',3,10000.0,1100.0,0.0,100.0),
  ('U02013','2026-05-01','2026-06-25',3,10000.0,1100.0,0.0,100.0),
  ('U02013','2026-06-01','2026-07-26',3,10000.0,1100.0,0.0,100.0),

  -- U02014 CESSATION — filings stop after March; cessation effective 2026-04-15.
  -- Historical obligations for Jan..Mar must survive the status change.
  ('U02014','2026-01-01','2026-02-24',3,10000.0,1100.0,350.0,100.0),
  ('U02014','2026-02-01','2026-03-26',3,10000.0,1100.0,350.0,100.0),
  ('U02014','2026-03-01','2026-04-25',3,10000.0,1100.0,350.0,100.0),

  -- U02015 FULL LEGAL ESCALATION — filed throughout, nothing paid at all
  ('U02015','2026-01-01','2026-02-24',8,40000.0,4400.0,1400.0,400.0),
  ('U02015','2026-02-01','2026-03-26',8,40000.0,4400.0,1400.0,400.0),
  ('U02015','2026-03-01','2026-04-25',8,40000.0,4400.0,1400.0,400.0),
  ('U02015','2026-04-01','2026-05-26',8,40000.0,4400.0,1400.0,400.0),
  ('U02015','2026-05-01','2026-06-25',8,40000.0,4400.0,1400.0,400.0),
  ('U02015','2026-06-01','2026-07-26',8,40000.0,4400.0,1400.0,400.0),

  -- U02016 ARREARS THRESHOLD — flat, easily averaged monthly liability of
  -- 3,100.00 per period so avg x multiplier is arithmetically checkable.
  ('U02016','2026-01-01','2026-02-24',6,20000.0,2200.0,700.0,200.0),
  ('U02016','2026-02-01','2026-03-26',6,20000.0,2200.0,700.0,200.0),
  ('U02016','2026-03-01','2026-04-25',6,20000.0,2200.0,700.0,200.0),
  ('U02016','2026-04-01','2026-05-26',6,20000.0,2200.0,700.0,200.0),
  ('U02016','2026-05-01','2026-06-25',6,20000.0,2200.0,700.0,200.0),
  ('U02016','2026-06-01','2026-07-26',6,20000.0,2200.0,700.0,200.0),

  -- U02017 MULTI-FACTOR RISK — late filings + nothing paid + breach + legal
  ('U02017','2026-01-01','2026-03-20',5,25000.0,2750.0,875.0,250.0),  -- late
  ('U02017','2026-02-01','2026-04-20',5,25000.0,2750.0,875.0,250.0),  -- late
  ('U02017','2026-03-01','2026-05-20',5,25000.0,2750.0,875.0,250.0),  -- late
  ('U02017','2026-04-01','2026-05-26',5,25000.0,2750.0,875.0,250.0),
  ('U02017','2026-05-01','2026-06-25',5,25000.0,2750.0,875.0,250.0),
  ('U02017','2026-06-01','2026-07-26',5,25000.0,2750.0,875.0,250.0),

  -- U02018 PAYMENT STOPS ESCALATION — arrears then paid in full 2026-08-20
  ('U02018','2026-01-01','2026-02-24',4,16000.0,1760.0,560.0,160.0),
  ('U02018','2026-02-01','2026-03-26',4,16000.0,1760.0,560.0,160.0),
  ('U02018','2026-03-01','2026-04-25',4,16000.0,1760.0,560.0,160.0),
  ('U02018','2026-04-01','2026-05-26',4,16000.0,1760.0,560.0,160.0),
  ('U02018','2026-05-01','2026-06-25',4,16000.0,1760.0,560.0,160.0),
  ('U02018','2026-06-01','2026-07-26',4,16000.0,1760.0,560.0,160.0),

  -- U02019 WAIVER / MANAGEMENT RESOLUTION — unpaid May & June
  ('U02019','2026-01-01','2026-02-24',3,10000.0,1100.0,350.0,100.0),
  ('U02019','2026-02-01','2026-03-26',3,10000.0,1100.0,350.0,100.0),
  ('U02019','2026-03-01','2026-04-25',3,10000.0,1100.0,350.0,100.0),
  ('U02019','2026-04-01','2026-05-26',3,10000.0,1100.0,350.0,100.0),
  ('U02019','2026-05-01','2026-06-25',3,10000.0,1100.0,350.0,100.0),
  ('U02019','2026-06-01','2026-07-26',3,10000.0,1100.0,350.0,100.0),

  -- U02020 COMPOUND — historic late filings, current non-payment, prior
  -- arrangement, one inspection, review-flag material, enforcement history
  ('U02020','2026-01-01','2026-03-20',7,35000.0,3850.0,1225.0,350.0),  -- late
  ('U02020','2026-02-01','2026-04-20',7,35000.0,3850.0,1225.0,350.0),  -- late
  ('U02020','2026-03-01','2026-04-25',7,35000.0,3850.0,1225.0,350.0),
  ('U02020','2026-04-01','2026-05-26',7,35000.0,3850.0,1225.0,350.0),
  ('U02020','2026-05-01','2026-06-25',7,35000.0,3850.0,1225.0,350.0),
  ('U02020','2026-06-01','2026-07-26',2,10000.0,1100.0, 350.0,100.0)   -- headcount drop too
)
INSERT INTO cn_c3_reported(id, payer_id, payer_type, sequence_no, period, number_employed,
  emp_ss_amt_calc, emp_levy_amt_calc, emp_pe_amt_calc, total_wages,
  date_received, date_entered, date_posted, posting_status, nil_return,
  entered_by, payer_name, is_for_director, created_at, updated_at,
  emp_ss_amt_rpt, emp_levy_amt_rpt, emp_pe_amt_rpt)
SELECT gen_random_uuid(), s.regno, 'ER', 1, s.period::date, s.employees,
       s.ss, s.levy, s.pe, s.wages,
       s.received::date, s.received::date, s.received::date,
       'VAC', false, 'u020-seed', e.name, false, now(), now(),
       s.ss, s.levy, s.pe
FROM spec s JOIN er_master e ON e.regno = s.regno;

-- ---------------------------------------------------------------------
-- 3. Payment history (cn_payment_header + cn_payment)
-- ---------------------------------------------------------------------
-- Deterministic payment_id block 9020000+ reserved for the U020 cohort.
DELETE FROM cn_payment WHERE payment_sequence_no BETWEEN 9020000 AND 9029999;
DELETE FROM cn_payment_header WHERE payment_id BETWEEN 9020000 AND 9029999;

WITH pay(regno, period, pay_date, amount, seq) AS (VALUES
  -- U02001 clean: every period paid in full on/before the due date
  ('U02001','2026-01-01','2026-02-25',1550.0, 1),
  ('U02001','2026-02-01','2026-03-27',1550.0, 2),
  ('U02001','2026-03-01','2026-04-26',1550.0, 3),
  ('U02001','2026-04-01','2026-05-27',1550.0, 4),
  ('U02001','2026-05-01','2026-06-26',1550.0, 5),
  ('U02001','2026-06-01','2026-07-27',1550.0, 6),

  -- U02002 pays the four periods it did report
  ('U02002','2026-01-01','2026-02-25',1550.0, 7),
  ('U02002','2026-02-01','2026-03-27',1550.0, 8),
  ('U02002','2026-03-01','2026-04-26',1550.0, 9),
  ('U02002','2026-04-01','2026-05-27',1550.0,10),

  -- U02003 late FILING but payment accompanied each filing in full
  ('U02003','2026-01-01','2026-02-25',1550.0,11),
  ('U02003','2026-02-01','2026-03-27',1550.0,12),
  ('U02003','2026-03-01','2026-04-26',1550.0,13),
  ('U02003','2026-04-01','2026-05-27',1550.0,14),
  ('U02003','2026-05-01','2026-07-15',1550.0,15),
  ('U02003','2026-06-01','2026-07-27',1550.0,16),

  -- U02004 non-payment: nothing after April
  ('U02004','2026-01-01','2026-02-25',1550.0,17),
  ('U02004','2026-02-01','2026-03-27',1550.0,18),
  ('U02004','2026-03-01','2026-04-26',1550.0,19),
  ('U02004','2026-04-01','2026-05-27',1550.0,20),

  -- U02005 late payment then resolution: April settled 2026-07-10 in full
  ('U02005','2026-01-01','2026-02-25',1550.0,21),
  ('U02005','2026-02-01','2026-03-27',1550.0,22),
  ('U02005','2026-03-01','2026-04-26',1550.0,23),
  ('U02005','2026-04-01','2026-07-10',1550.0,24),
  ('U02005','2026-05-01','2026-06-26',1550.0,25),
  ('U02005','2026-06-01','2026-07-27',1550.0,26),

  -- U02006 partial: June 500 of 1,550 (shortfall 1,050 > 50 and > 5%)
  ('U02006','2026-01-01','2026-02-25',1550.0,27),
  ('U02006','2026-02-01','2026-03-27',1550.0,28),
  ('U02006','2026-03-01','2026-04-26',1550.0,29),
  ('U02006','2026-04-01','2026-05-27',1550.0,30),
  ('U02006','2026-05-01','2026-06-26',1550.0,31),
  ('U02006','2026-06-01','2026-07-27', 500.0,32),

  -- U02007 / U02008 arrangement employers: Jan & Feb paid, Mar..Jun in debt
  ('U02007','2026-01-01','2026-02-25',1550.0,33),
  ('U02007','2026-02-01','2026-03-27',1550.0,34),
  ('U02008','2026-01-01','2026-02-25',1550.0,35),
  ('U02008','2026-02-01','2026-03-27',1550.0,36),

  -- U02009 inspection pathway: fully paid so paperwork stays clean
  ('U02009','2026-01-01','2026-02-25',1550.0,37),
  ('U02009','2026-02-01','2026-03-27',1550.0,38),
  ('U02009','2026-03-01','2026-04-26',1550.0,39),
  ('U02009','2026-04-01','2026-05-27',1550.0,40),
  ('U02009','2026-05-01','2026-06-26',1550.0,41),
  ('U02009','2026-06-01','2026-07-27',1550.0,42),

  -- U02010 headcount anomaly employer is otherwise compliant
  ('U02010','2026-01-01','2026-02-25',6510.0,43),
  ('U02010','2026-02-01','2026-03-27',6510.0,44),
  ('U02010','2026-03-01','2026-04-26',6510.0,45),
  ('U02010','2026-04-01','2026-05-27',6510.0,46),
  ('U02010','2026-05-01','2026-06-26',6510.0,47),
  ('U02010','2026-06-01','2026-07-27',1627.5,48),

  -- U02011 wage anomaly employer is otherwise compliant
  ('U02011','2026-01-01','2026-02-25',1085.0,49),
  ('U02011','2026-02-01','2026-03-27',1085.0,50),
  ('U02011','2026-03-01','2026-04-26',1085.0,51),
  ('U02011','2026-04-01','2026-05-27',1085.0,52),
  ('U02011','2026-05-01','2026-06-26',1085.0,53),
  ('U02011','2026-06-01','2026-07-27', 155.0,54),

  -- U02012 repeat offender pays everything except May (mixed-type control)
  ('U02012','2026-01-01','2026-03-20',1550.0,55),
  ('U02012','2026-02-01','2026-04-20',1550.0,56),
  ('U02012','2026-03-01','2026-05-20',1550.0,57),
  ('U02012','2026-04-01','2026-05-27',1550.0,58),
  ('U02012','2026-06-01','2026-07-27',1550.0,59),

  -- U02013 exemption employer pays exactly what it declared (no levy)
  ('U02013','2026-01-01','2026-02-25',1200.0,60),
  ('U02013','2026-02-01','2026-03-27',1200.0,61),
  ('U02013','2026-03-01','2026-04-26',1200.0,62),
  ('U02013','2026-04-01','2026-05-27',1200.0,63),
  ('U02013','2026-05-01','2026-06-26',1200.0,64),
  ('U02013','2026-06-01','2026-07-27',1200.0,65),

  -- U02014 cessation employer paid its three live periods
  ('U02014','2026-01-01','2026-02-25',1550.0,66),
  ('U02014','2026-02-01','2026-03-27',1550.0,67),
  ('U02014','2026-03-01','2026-04-26',1550.0,68),

  -- U02015 legal escalation: NOTHING paid at all (no rows)

  -- U02016 arrears threshold: nothing paid, six periods x 3,100 = 18,600
  -- (no payment rows)

  -- U02017 multi-factor risk: nothing paid (no payment rows)

  -- U02018 payment stops escalation: full arrears cleared 2026-08-20
  ('U02018','2026-01-01','2026-08-20',2480.0,69),
  ('U02018','2026-02-01','2026-08-20',2480.0,70),
  ('U02018','2026-03-01','2026-08-20',2480.0,71),
  ('U02018','2026-04-01','2026-08-20',2480.0,72),
  ('U02018','2026-05-01','2026-08-20',2480.0,73),
  ('U02018','2026-06-01','2026-08-20',2480.0,74),

  -- U02019 waiver employer: paid Jan..Apr, May & June outstanding
  ('U02019','2026-01-01','2026-02-25',1550.0,75),
  ('U02019','2026-02-01','2026-03-27',1550.0,76),
  ('U02019','2026-03-01','2026-04-26',1550.0,77),
  ('U02019','2026-04-01','2026-05-27',1550.0,78),

  -- U02020 compound: historic periods paid, current periods unpaid
  ('U02020','2026-01-01','2026-03-20',5425.0,79),
  ('U02020','2026-02-01','2026-04-20',5425.0,80),
  ('U02020','2026-03-01','2026-04-26',5425.0,81)
),
hdr AS (
  INSERT INTO cn_payment_header(payment_id, payer_id, payer_type, batch_number,
                                date_received, remarks, status, is_for_director)
  SELECT 9020000 + p.seq, p.regno, 'ER', 'U020-BATCH',
         p.pay_date::date, 'U020 scenario fixture', 'POSTED', false
  FROM pay p
  RETURNING payment_id
)
INSERT INTO cn_payment(payment_id, payment_sequence_no, payment_code, mop_code,
                       fund_code, payment_date, payment_amount, period, created_at)
SELECT 9020000 + p.seq, 9020000 + p.seq, 'CON', 'CSH', 'SS',
       p.pay_date::date, p.amount, p.period::date, now()
FROM pay p;

-- ---------------------------------------------------------------------
-- 3b. Baseline pre-history (2025-11, 2025-12)
-- ---------------------------------------------------------------------
-- The obligation enumerator materialises a rolling window that starts before
-- the first scenario period. Without a clean pre-history EVERY employer —
-- including the CLEAN CONTROL — would carry two unrelated "unreported"
-- periods and the control case could not prove non-over-detection.
-- Each employer's 2026-01 filing is replayed on time and paid in full for
-- the two preceding wage periods.
INSERT INTO cn_c3_reported(id, payer_id, payer_type, sequence_no, period, number_employed,
  emp_ss_amt_calc, emp_levy_amt_calc, emp_pe_amt_calc, total_wages,
  date_received, date_entered, date_posted, posting_status, nil_return,
  entered_by, payer_name, is_for_director, created_at, updated_at,
  emp_ss_amt_rpt, emp_levy_amt_rpt, emp_pe_amt_rpt)
SELECT gen_random_uuid(), c.payer_id, 'ER', 1, b.period, c.number_employed,
       c.emp_ss_amt_calc, c.emp_levy_amt_calc, c.emp_pe_amt_calc, c.total_wages,
       b.received, b.received, b.received, 'VAC', false,
       'u020-seed', c.payer_name, false, now(), now(),
       c.emp_ss_amt_rpt, c.emp_levy_amt_rpt, c.emp_pe_amt_rpt
FROM cn_c3_reported c
CROSS JOIN (VALUES (DATE '2025-11-01', DATE '2025-12-26'),
                   (DATE '2025-12-01', DATE '2026-01-26')) AS b(period, received)
WHERE c.payer_id LIKE 'U020%' AND c.period = DATE '2026-01-01';

WITH base AS (
  SELECT c.payer_id,
         (c.emp_ss_amt_calc + c.emp_levy_amt_calc + c.emp_pe_amt_calc) AS amt,
         row_number() OVER (ORDER BY c.payer_id) AS rn
  FROM cn_c3_reported c
  WHERE c.payer_id LIKE 'U020%' AND c.period = DATE '2026-01-01'
),
pay2 AS (
  SELECT b.payer_id, v.period, v.pay_date, b.amt,
         9020500 + (b.rn * 2) + v.ofs AS pid
  FROM base b
  CROSS JOIN (VALUES (DATE '2025-11-01', DATE '2025-12-27', 0),
                     (DATE '2025-12-01', DATE '2026-01-27', 1)) AS v(period, pay_date, ofs)
),
hdr2 AS (
  INSERT INTO cn_payment_header(payment_id, payer_id, payer_type, batch_number,
                                date_received, remarks, status, is_for_director)
  SELECT p.pid, p.payer_id, 'ER', 'U020-BASE', p.pay_date,
         'U020 baseline pre-history', 'POSTED', false
  FROM pay2 p
  RETURNING payment_id
)
INSERT INTO cn_payment(payment_id, payment_sequence_no, payment_code, mop_code,
                       fund_code, payment_date, payment_amount, period, created_at)
SELECT p.pid, p.pid, 'CON', 'CSH', 'SS', p.pay_date, p.amt, p.period, now()
FROM pay2 p;



-- ---------------------------------------------------------------------
-- 4. U02013 — contribution exemption (levy) for one insured person
-- ---------------------------------------------------------------------
DELETE FROM public.ce_contribution_exemptions WHERE authority_reference LIKE 'U020-EX-%';

INSERT INTO public.ce_contribution_exemptions
  (person_ssn, person_name, employer_id, fund_code, effective_from, effective_to,
   granting_authority, authority_reference, status, notes, recorded_by, verified_by, verified_at)
VALUES
  ('920013','U020 Exempt Person X','U02013','LV','2026-01-01','2026-12-31',
   'DIRECTOR','U020-EX-001','ACTIVE',
   'U02013 scenario: levy exemption in force for the whole TEST year',
   'u020-seed','u020-seed', now()),
  -- Negative control: SAME person, DIFFERENT employer, no exemption granted
  -- (deliberately not inserted — absence is the control).
  -- Negative control: same person + employer but an EXPIRED window.
  ('920014','U020 Expired Exemption Person','U02013','LV','2025-01-01','2025-06-30',
   'DIRECTOR','U020-EX-002','EXPIRED',
   'U02013 scenario: out-of-period exemption must NOT suppress 2026 detection',
   'u020-seed','u020-seed', now());

-- ---------------------------------------------------------------------
-- 5. U02014 — governed cessation status state
-- ---------------------------------------------------------------------
DELETE FROM public.ce_employer_status_states WHERE employer_id = 'U02014';

INSERT INTO public.ce_employer_status_states
  (employer_id, status, effective_date, evidence_type, evidence_reference, reason, changed_by)
VALUES
  ('U02014','CEASED','2026-04-15','INSPECTOR_VISIT','U020-STATUS-001',
   'U02014 scenario: business ceased trading; no clearance certificate produced',
   'u020-seed');

-- ---------------------------------------------------------------------
-- 6. U02007 / U02008 / U02020 — payment arrangements + installments
-- ---------------------------------------------------------------------
DELETE FROM public.ce_installments
 WHERE arrangement_id IN (SELECT id FROM public.ce_payment_arrangements
                           WHERE employer_id LIKE 'U020%');
DELETE FROM public.ce_payment_arrangements WHERE employer_id LIKE 'U020%';

WITH arr AS (
  INSERT INTO public.ce_payment_arrangements
    (arrangement_number, employer_id, employer_name, status, total_debt,
     down_payment, installment_amount, number_of_installments, frequency,
     start_date, end_date, total_paid, installments_paid, next_due_date,
     missed_payments, max_missed_before_breach, breach_detected,
     terms_text, created_by, submitted_by, submitted_at, approved_by, approved_at)
  VALUES
    ('U020-ARR-007','U02007','U020 Healthy Arrangement Ltd','ACTIVE', 6200.00,
     0.00, 1550.00, 4, 'MONTHLY',
     '2026-05-15','2026-08-15', 3100.00, 2, '2026-07-15',
     0, 0, false,
     'U02007 scenario: healthy arrangement, installments paid on schedule',
     'u020-seed','u020-seed', now(), 'u020-seed-approver', now()),
    ('U020-ARR-008','U02008','U020 Arrangement Breach Ltd','ACTIVE', 6200.00,
     0.00, 1550.00, 4, 'MONTHLY',
     '2026-05-15','2026-08-15', 1550.00, 1, '2026-06-15',
     1, 0, false,
     'U02008 scenario: second installment missed — zero-grace breach expected',
     'u020-seed','u020-seed', now(), 'u020-seed-approver', now()),
    ('U020-ARR-020','U02020','U020 Compound Case Ltd','COMPLETED', 5425.00,
     0.00, 5425.00, 1, 'MONTHLY',
     '2026-04-15','2026-04-15', 5425.00, 1, NULL,
     0, 0, false,
     'U02020 scenario: prior arrangement, fully performed and closed',
     'u020-seed','u020-seed', now(), 'u020-seed-approver', now())
  RETURNING id, arrangement_number
)
INSERT INTO public.ce_installments
  (arrangement_id, installment_number, due_date, amount, paid_amount, paid_date, status)
SELECT a.id, v.num, v.due::date, v.amt, v.paid, v.paid_on::date, v.st
FROM arr a
JOIN (VALUES
  -- U02007 — first two paid on time, remaining two not yet due at TEST basis
  ('U020-ARR-007',1,'2026-05-15',1550.0,1550.0,'2026-05-14','PAID'),
  ('U020-ARR-007',2,'2026-06-15',1550.0,1550.0,'2026-06-13','PAID'),
  ('U020-ARR-007',3,'2026-07-15',1550.0,1550.0,'2026-07-14','PAID'),
  ('U020-ARR-007',4,'2026-08-15',1550.0,1550.0,'2026-08-13','PAID'),
  -- U02008 — installment 2 missed entirely (zero grace ⇒ immediate breach)
  ('U020-ARR-008',1,'2026-05-15',1550.0,1550.0,'2026-05-14','PAID'),
  ('U020-ARR-008',2,'2026-06-15',1550.0,   0.0,NULL,        'PENDING'),
  ('U020-ARR-008',3,'2026-07-15',1550.0, 400.0,'2026-07-15','PARTIAL'),
  ('U020-ARR-008',4,'2026-08-15',1550.0,   0.0,NULL,        'PENDING'),
  -- U02020 — prior arrangement fully performed
  ('U020-ARR-020',1,'2026-04-15',5425.0,5425.0,'2026-04-14','PAID')
) AS v(arrno, num, due, amt, paid, paid_on, st)
  ON v.arrno = a.arrangement_number;

-- U02007 healthy arrangement: fix total_paid to reflect four settled installments
UPDATE public.ce_payment_arrangements
   SET total_paid = 6200.00, installments_paid = 4, next_due_date = NULL
 WHERE arrangement_number = 'U020-ARR-007';

-- ---------------------------------------------------------------------
-- 7. SE020xx — self-employed / voluntary contributor cohort (DR-013)
-- ---------------------------------------------------------------------
DELETE FROM public.ce_self_employed_obligations WHERE person_ssn LIKE '9202%';

INSERT INTO public.ce_self_employed_obligations
  (person_ssn, person_name, contributor_type, wage_period, obligation_type,
   expected_amount, declared_amount, paid_amount, filing_received_date,
   payment_received_date, due_date, grace_end_date, status,
   employer_reported, employer_reported_by, suppressed)
VALUES
  -- SE02001 CLEAN — declared and paid on time for every period
  ('920201','SE02001 Clean Self-Employed','SELF_EMPLOYED','2026-04-01','CONTRIBUTION',
   300.0,300.0,300.0,'2026-05-20','2026-05-20','2026-05-31','2026-05-31','SATISFIED',false,NULL,false),
  ('920201','SE02001 Clean Self-Employed','SELF_EMPLOYED','2026-05-01','CONTRIBUTION',
   300.0,300.0,300.0,'2026-06-20','2026-06-20','2026-06-30','2026-06-30','SATISFIED',false,NULL,false),
  ('920201','SE02001 Clean Self-Employed','SELF_EMPLOYED','2026-06-01','CONTRIBUTION',
   300.0,300.0,300.0,'2026-07-20','2026-07-20','2026-07-31','2026-07-31','SATISFIED',false,NULL,false),

  -- SE02002 MULTI-PERIOD OUTSTANDING — three consecutive unpaid periods,
  -- proves reminder consolidation and underlying-period traceability
  ('920202','SE02002 Multi-Period Outstanding','SELF_EMPLOYED','2026-04-01','CONTRIBUTION',
   300.0,300.0,0.0,'2026-05-20',NULL,'2026-05-31','2026-05-31','OUTSTANDING',false,NULL,false),
  ('920202','SE02002 Multi-Period Outstanding','SELF_EMPLOYED','2026-05-01','CONTRIBUTION',
   300.0,300.0,0.0,'2026-06-20',NULL,'2026-06-30','2026-06-30','OUTSTANDING',false,NULL,false),
  ('920202','SE02002 Multi-Period Outstanding','SELF_EMPLOYED','2026-06-01','CONTRIBUTION',
   300.0,300.0,0.0,'2026-07-20',NULL,'2026-07-31','2026-07-31','OUTSTANDING',false,NULL,false),

  -- SE02003 ALSO REPORTED BY AN EMPLOYER — overlap flag, not a violation
  ('920203','SE02003 Employer Overlap','SELF_EMPLOYED','2026-05-01','CONTRIBUTION',
   300.0,300.0,0.0,'2026-06-20',NULL,'2026-06-30','2026-06-30','OUTSTANDING',true,'U02001',false),
  ('920203','SE02003 Employer Overlap','SELF_EMPLOYED','2026-06-01','CONTRIBUTION',
   300.0,300.0,0.0,'2026-07-20',NULL,'2026-07-31','2026-07-31','OUTSTANDING',true,'U02001',false),

  -- SE02004 OVER-CONTRIBUTION / CREDIT — paid more than expected
  ('920204','SE02004 Over-Contribution','SELF_EMPLOYED','2026-05-01','CONTRIBUTION',
   300.0,300.0,500.0,'2026-06-20','2026-06-20','2026-06-30','2026-06-30','SATISFIED',false,NULL,false),
  ('920204','SE02004 Over-Contribution','SELF_EMPLOYED','2026-06-01','CONTRIBUTION',
   300.0,300.0,450.0,'2026-07-20','2026-07-20','2026-07-31','2026-07-31','SATISFIED',false,NULL,false),

  -- SE02005 VOLUNTARY CONTRIBUTOR — different contributor type, part paid
  ('920205','SE02005 Voluntary Contributor','VOLUNTARY','2026-05-01','CONTRIBUTION',
   200.0,200.0,100.0,'2026-06-20','2026-06-20','2026-06-30','2026-06-30','OUTSTANDING',false,NULL,false),
  ('920205','SE02005 Voluntary Contributor','VOLUNTARY','2026-06-01','CONTRIBUTION',
   200.0,200.0,0.0,'2026-07-20',NULL,'2026-07-31','2026-07-31','OUTSTANDING',false,NULL,false);

COMMIT;

-- =====================================================================
-- TEARDOWN (run manually to remove the whole U020 / SE020 cohort)
-- =====================================================================
-- BEGIN;
-- DELETE FROM public.ce_installments WHERE arrangement_id IN
--   (SELECT id FROM public.ce_payment_arrangements WHERE employer_id LIKE 'U020%');
-- DELETE FROM public.ce_payment_arrangements   WHERE employer_id LIKE 'U020%';
-- DELETE FROM public.ce_self_employed_obligations WHERE person_ssn LIKE '9202%';
-- DELETE FROM public.ce_contribution_exemptions WHERE authority_reference LIKE 'U020-EX-%';
-- DELETE FROM public.ce_employer_status_states WHERE employer_id LIKE 'U020%';
-- DELETE FROM public.ce_inspection_findings WHERE inspection_id IN
--   (SELECT id FROM public.ce_inspections WHERE employer_id LIKE 'U020%');
-- DELETE FROM public.ce_inspections            WHERE employer_id LIKE 'U020%';
-- DELETE FROM public.ce_violations             WHERE employer_id LIKE 'U020%';
-- DELETE FROM public.ce_compliance_review_flags WHERE employer_id LIKE 'U020%';
-- DELETE FROM public.ce_obligation_periods     WHERE employer_id LIKE 'U020%';
-- DELETE FROM cn_payment        WHERE payment_id BETWEEN 9020000 AND 9029999;
-- DELETE FROM cn_payment_header WHERE payment_id BETWEEN 9020000 AND 9029999;
-- DELETE FROM cn_c3_reported    WHERE payer_id LIKE 'U020%';
-- DELETE FROM er_master         WHERE regno   LIKE 'U020%';
-- COMMIT;
