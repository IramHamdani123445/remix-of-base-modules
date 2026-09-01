-- Remap legacy transition-rule role vocabulary to the canonical roles
-- actually assigned in user_roles.
WITH mapping(legacy, canonical) AS (
  VALUES
    ('bn_clerk',      ARRAY['BN_INTAKE_OFFICER','BN_DOCUMENT_OFFICER']),
    ('bn_officer',    ARRAY['BN_CLAIMS_OFFICER','BN_ELIGIBILITY_OFFICER','BN_AWARD_OFFICER']),
    ('bn_supervisor', ARRAY['BN_SUPERVISOR','BN_SENIOR_ELIGIBILITY_OFFICER']),
    ('bn_manager',    ARRAY['BN_MANAGER','BN_DIRECTOR']),
    ('bn_finance',    ARRAY['BN_PAYMENT_OFFICER','BN_FINANCE_SUPERVISOR'])
),
expanded AS (
  SELECT r.id,
         ARRAY(
           SELECT DISTINCT x
           FROM (
             SELECT unnest(
               CASE
                 WHEN m.canonical IS NOT NULL THEN m.canonical
                 ELSE ARRAY[role_token]
               END
             ) AS x
             FROM unnest(r.allowed_roles) AS role_token
             LEFT JOIN mapping m ON m.legacy = role_token
           ) s
         ) AS new_roles
  FROM public.bn_claim_transition_rule r
  WHERE r.is_active
)
UPDATE public.bn_claim_transition_rule r
SET allowed_roles = e.new_roles
FROM expanded e
WHERE r.id = e.id
  AND r.allowed_roles IS DISTINCT FROM e.new_roles;

-- Payment-facing actions must always include the Payment Officer roles.
UPDATE public.bn_claim_transition_rule
SET allowed_roles = ARRAY(
  SELECT DISTINCT x FROM unnest(allowed_roles || ARRAY['BN_PAYMENT_OFFICER','BN_FINANCE_SUPERVISOR']) AS x
)
WHERE is_active
  AND (from_status, to_status) IN (('AWARD_SETUP','PAYMENT_QUEUE'), ('PAYMENT_QUEUE','IN_PAYMENT'));