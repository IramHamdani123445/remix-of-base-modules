create or replace view public.ce_v_violation_type_mix as
select
  v.violation_type_id,
  vt.code as type_code,
  coalesce(vt.name, 'Unclassified') as type_name,
  count(*)::bigint as open_count
from public.ce_violations v
left join public.ce_violation_types vt on vt.id = v.violation_type_id
where coalesce(v.is_deleted, false) = false
  and v.status in ('OPEN','IN_PROGRESS','UNDER_REVIEW','ESCALATED')
group by 1,2,3;

create or replace view public.ce_v_violation_ageing as
select bucket, bucket_order, count(*)::bigint as open_count
from (
  select
    case
      when now() - created_at < interval '8 days'  then '0-7 days'
      when now() - created_at < interval '15 days' then '8-14 days'
      when now() - created_at < interval '31 days' then '15-30 days'
      when now() - created_at < interval '61 days' then '31-60 days'
      else '60+ days'
    end as bucket,
    case
      when now() - created_at < interval '8 days'  then 1
      when now() - created_at < interval '15 days' then 2
      when now() - created_at < interval '31 days' then 3
      when now() - created_at < interval '61 days' then 4
      else 5
    end as bucket_order
  from public.ce_violations
  where coalesce(is_deleted, false) = false
    and status in ('OPEN','IN_PROGRESS','UNDER_REVIEW','ESCALATED')
) t
group by 1,2;

create or replace view public.ce_v_risk_band_summary as
select
  coalesce(coalesce(rp.override_band, rp.risk_band), 'UNKNOWN') as risk_band,
  count(*)::bigint as employer_count,
  avg(rp.total_score)::numeric(10,2) as avg_score
from public.ce_risk_profiles rp
group by 1;

create or replace view public.ce_v_priority_employers as
with v as (
  select employer_id,
         max(employer_name) as employer_name,
         count(*)::bigint as open_violations,
         min(created_at) as oldest_issue,
         max(assigned_to_name) as assigned_officer
  from public.ce_violations
  where coalesce(is_deleted, false) = false
    and status in ('OPEN','IN_PROGRESS','UNDER_REVIEW','ESCALATED')
    and employer_id is not null
  group by 1
),
o as (
  select employer_id, sum(total_outstanding)::numeric as outstanding_exposure
  from public.ce_v_employer_outstanding
  group by 1
),
a as (
  select employer_id, max(status) as arrangement_status
  from public.ce_payment_arrangements
  where status in ('ACTIVE','DEFAULTED','BREACHED','PENDING_APPROVAL')
  group by 1
),
l as (
  select employer_id, max(status) as legal_status
  from public.ce_legal_referrals
  group by 1
)
select
  rp.employer_id,
  coalesce(rp.employer_name, v.employer_name) as employer_name,
  coalesce(rp.override_band, rp.risk_band) as risk_band,
  rp.total_score as risk_score,
  coalesce(v.open_violations, 0) as open_violations,
  coalesce(o.outstanding_exposure, 0) as outstanding_exposure,
  v.oldest_issue,
  v.assigned_officer,
  a.arrangement_status,
  l.legal_status
from public.ce_risk_profiles rp
left join v on v.employer_id = rp.employer_id
left join o on o.employer_id = rp.employer_id
left join a on a.employer_id = rp.employer_id
left join l on l.employer_id = rp.employer_id
where coalesce(rp.override_band, rp.risk_band) in ('HIGH','CRITICAL')
   or coalesce(v.open_violations, 0) > 0
   or coalesce(o.outstanding_exposure, 0) > 0;

grant select on public.ce_v_violation_type_mix to authenticated;
grant select on public.ce_v_violation_ageing to authenticated;
grant select on public.ce_v_risk_band_summary to authenticated;
grant select on public.ce_v_priority_employers to authenticated;
grant select on public.ce_v_violation_type_mix to service_role;
grant select on public.ce_v_violation_ageing to service_role;
grant select on public.ce_v_risk_band_summary to service_role;
grant select on public.ce_v_priority_employers to service_role;