INSERT INTO public.core_comm_assignment
  (organization_id, department_id, module_code, event_code, output_channel, assignment_kind, layout_id)
VALUES
  ('69afc88b-da5c-4f41-a1e7-199e1ee1d416', NULL, 'BENEFITS', NULL, 'email', 'layout_default', '23e471f6-afaa-47f2-860f-cfac8891cf38'),
  ('69afc88b-da5c-4f41-a1e7-199e1ee1d416', 'c28f40f8-00db-4766-b211-5bda5dd641a9', 'BENEFITS', NULL, 'email', 'layout_default', 'eabd1ecc-ca2a-4715-b36d-3bb4151eb762'),
  ('69afc88b-da5c-4f41-a1e7-199e1ee1d416', 'c28f40f8-00db-4766-b211-5bda5dd641a9', 'BENEFITS', 'BENEFITS.CLAIM.APPROVED', 'email', 'layout_default', '291aefd5-970d-4c90-a9fa-e2da40eb8bd2')
ON CONFLICT DO NOTHING;