-- Checkpoint B2 certification fixtures (TEST only).
-- Deterministic, idempotent seed used to prove DR-005..DR-013 operate against
-- the real data model. Safe to re-run.

-- DR-010 sector wage benchmarks -------------------------------------------------
INSERT INTO public.ce_sector_wage_benchmarks
  (sector_code, sector_label, calculated_minimum, calculated_average, sample_count,
   effective_from, recalculated_at, is_enabled)
SELECT v.sector_code, v.sector_label, v.min_wage, v.avg_wage, v.sample_count,
       DATE '2024-01-01', now(), true
FROM (VALUES
  ('P', 'Construction',        400.0, 700.0, 120),
  ('R', 'Professional Svcs',   500.0, 900.0, 200),
  ('O', 'Other',               300.0, 600.0,  80)
) AS v(sector_code, sector_label, min_wage, avg_wage, sample_count)
WHERE NOT EXISTS (
  SELECT 1 FROM public.ce_sector_wage_benchmarks b
  WHERE b.sector_code = v.sector_code AND b.effective_to IS NULL
);

-- DR-007 exemption: suppresses the Levy omission for one S00001 person ----------
INSERT INTO public.ce_contribution_exemptions
  (person_ssn, person_name, employer_id, fund_code, effective_from, granting_authority,
   authority_reference, status, notes, recorded_by, verified_by, verified_at)
SELECT '900001', 'B2 Fixture Person 1', 'S00001', 'LV', DATE '2024-01-01',
       'DIRECTOR', 'B2-CERT-EX-001', 'ACTIVE',
       'Checkpoint B2 certification fixture', 'b2-certification', 'b2-certification', now()
WHERE NOT EXISTS (
  SELECT 1 FROM public.ce_contribution_exemptions
  WHERE authority_reference = 'B2-CERT-EX-001'
);

-- DR-008 unregistered employer leads --------------------------------------------
INSERT INTO public.ce_unregistered_employer_leads
  (lead_number, trade_name, business_address, source_type, source_reference,
   status, discovered_date, legal_recommended, created_by)
SELECT 'B2-LEAD-001', 'Palm Ridge Beach Bar', '19 Frigate Bay Road', 'INSPECTION',
       'B2-CERT', 'NEW', CURRENT_DATE - 3, false, 'b2-certification'
WHERE NOT EXISTS (SELECT 1 FROM public.ce_unregistered_employer_leads WHERE lead_number = 'B2-LEAD-001');

INSERT INTO public.ce_unregistered_employer_leads
  (lead_number, trade_name, business_address, source_type, source_reference,
   status, discovered_date, instructed_at, legal_recommended, created_by)
SELECT 'B2-LEAD-002', 'Harbour View Rentals', '4 Bay Road', 'SCOUTING',
       'B2-CERT', 'INSTRUCTED', CURRENT_DATE - 40, now() - INTERVAL '40 days', false, 'b2-certification'
WHERE NOT EXISTS (SELECT 1 FROM public.ce_unregistered_employer_leads WHERE lead_number = 'B2-LEAD-002');

-- DR-011 authoritative employer status state -------------------------------------
INSERT INTO public.ce_employer_status_states
  (employer_id, status, effective_date, evidence_type, evidence_reference, reason, changed_by)
SELECT '100003', 'CEASED', CURRENT_DATE - 20, 'INSPECTOR_VISIT', 'B2-CERT-STATUS-001',
       'Checkpoint B2 certification fixture: cessation without clearance certificate', 'b2-certification'
WHERE NOT EXISTS (
  SELECT 1 FROM public.ce_employer_status_states WHERE employer_id = '100003'
);

-- DR-013 self-employed obligations ------------------------------------------------
INSERT INTO public.ce_self_employed_obligations
  (person_ssn, person_name, contributor_type, wage_period, obligation_type,
   expected_amount, declared_amount, paid_amount, due_date, grace_end_date,
   status, employer_reported, suppressed)
SELECT v.ssn, v.nm, v.ctype, v.period::date, 'CONTRIBUTION',
       v.expected, v.declared, v.paid,
       (date_trunc('month', v.period::date) + INTERVAL '2 month - 1 day')::date,
       (date_trunc('month', v.period::date) + INTERVAL '2 month - 1 day')::date,
       'OUTSTANDING', v.emp_reported, false
FROM (VALUES
  ('910001', 'B2 Self-Employed A', 'SELF_EMPLOYED', '2026-01-01', 300.0, 0.0,   0.0, false),
  ('910002', 'B2 Voluntary B',     'VOLUNTARY',     '2026-01-01', 200.0, 200.0, 50.0, false),
  ('910003', 'B2 Overlap C',       'SELF_EMPLOYED', '2026-02-01', 300.0, 0.0,   0.0, true)
) AS v(ssn, nm, ctype, period, expected, declared, paid, emp_reported)
WHERE NOT EXISTS (
  SELECT 1 FROM public.ce_self_employed_obligations s
  WHERE s.person_ssn = v.ssn AND s.wage_period = v.period::date
);
