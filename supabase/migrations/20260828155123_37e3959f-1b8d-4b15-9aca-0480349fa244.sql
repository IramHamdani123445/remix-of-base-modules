UPDATE public.ia_audit_engagements
   SET lead_auditor_id = 'd4e4f228-db0e-4d66-985c-f675708b1fbc',
       reviewer_id     = '330fbb9a-eb4a-42d7-bfef-6259143e75dd',
       team_member_ids = '["66a54aff-f263-4dac-b3dd-f1fe06d4ba4c"]'::jsonb,
       updated_at      = now(),
       updated_by      = 'STAGE1B_E2E1_CERTIFICATION'
 WHERE engagement_code = 'ENG-2027-001';