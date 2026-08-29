UPDATE public.ce_risk_profiles p
SET risk_band = b.band_name,
    updated_at = now()
FROM public.ce_risk_bands b
JOIN public.ce_risk_policies pol ON pol.id = b.policy_id AND pol.status = 'ACTIVE'
WHERE p.scoring_version = 'PHASE5_DEMO'
  AND p.total_score > b.score_range_min
  AND p.total_score <= b.score_range_max
  AND p.risk_band IS DISTINCT FROM b.band_name;