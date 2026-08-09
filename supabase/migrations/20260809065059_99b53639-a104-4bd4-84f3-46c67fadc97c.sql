-- Read-only operational role for Overpayment Recovery
INSERT INTO public.bn_op_role_action (role_code, action_code, is_synthetic)
VALUES
  ('BN_OP_READONLY', 'view', false),
  ('BN_OP_READONLY', 'view_financial_detail', false),
  ('BN_OP_READONLY', 'audit', false)
ON CONFLICT DO NOTHING;

-- Signed-in user: caseworker (maker)
INSERT INTO public.bn_op_user_role (user_id, role_code, is_synthetic)
VALUES ('08655ffc-6bb2-4eea-bc5b-502c52cdcf85', 'BN_OP_SYNTH_MAKER', false)
ON CONFLICT (user_id, role_code) DO NOTHING;

-- Platform administrator: independent approver (checker), preserving segregation of duties
INSERT INTO public.bn_op_user_role (user_id, role_code, is_synthetic)
VALUES ('62c928c3-cd5e-421f-a010-50f9123fff70', 'BN_OP_SYNTH_CHECKER', false)
ON CONFLICT (user_id, role_code) DO NOTHING;

-- Platform Admins get read-only visibility on the domain
INSERT INTO public.bn_op_user_role (user_id, role_code, is_synthetic)
SELECT ur.user_id, 'BN_OP_READONLY', false
FROM public.user_roles ur
WHERE ur.role::text = 'Admin'
ON CONFLICT (user_id, role_code) DO NOTHING;