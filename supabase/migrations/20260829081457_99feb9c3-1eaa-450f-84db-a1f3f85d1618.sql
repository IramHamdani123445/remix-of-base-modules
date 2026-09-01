
-- ============================================================
-- Checkpoint B1 — DR-004 Partial Payment governed workflow
-- Schema, policy configuration, governance wiring
-- ============================================================

-- ---------- 1. Policy configuration ----------
CREATE TABLE IF NOT EXISTS public.ce_partial_payment_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_code text NOT NULL,
  policy_name text NOT NULL,
  scope_key text NOT NULL DEFAULT 'DEFAULT',
  is_active boolean NOT NULL DEFAULT false,
  -- allocation order is a list of tb_payment_type.payment_code values
  allocation_order text[] NOT NULL DEFAULT ARRAY['SSC','LVC','PEC','SSF','LVF','PEF','SLF','LVL','PEL','SCC','LCC','PCC']::text[],
  allow_allocation_override boolean NOT NULL DEFAULT true,
  minimum_acceptable_percent numeric(5,2) NOT NULL DEFAULT 0,
  minimum_acceptable_amount numeric(14,2) NOT NULL DEFAULT 0,
  extends_payment_grace boolean NOT NULL DEFAULT true,
  max_grace_extension_days integer NOT NULL DEFAULT 30,
  authority_validity_days integer NOT NULL DEFAULT 14,
  required_approval_role text NOT NULL DEFAULT 'senior',
  escalated_approval_role text NOT NULL DEFAULT 'head',
  escalation_threshold_amount numeric(14,2),
  require_separate_approver boolean NOT NULL DEFAULT true,
  block_when_arrangement_active boolean NOT NULL DEFAULT true,
  notes text,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_by text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ce_pp_policies_code_key UNIQUE (policy_code),
  CONSTRAINT ce_pp_policies_roles_chk CHECK (
    required_approval_role IN ('inspector','senior','head')
    AND escalated_approval_role IN ('inspector','senior','head')),
  CONSTRAINT ce_pp_policies_pct_chk CHECK (minimum_acceptable_percent >= 0 AND minimum_acceptable_percent <= 100),
  CONSTRAINT ce_pp_policies_days_chk CHECK (max_grace_extension_days >= 0 AND authority_validity_days > 0)
);

-- exactly one active policy per scope
CREATE UNIQUE INDEX IF NOT EXISTS ce_pp_policies_one_active_per_scope
  ON public.ce_partial_payment_policies (scope_key) WHERE is_active;

GRANT SELECT ON public.ce_partial_payment_policies TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.ce_partial_payment_policies TO authenticated;
GRANT ALL ON public.ce_partial_payment_policies TO service_role;
ALTER TABLE public.ce_partial_payment_policies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ce_pp_policies_read" ON public.ce_partial_payment_policies
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "ce_pp_policies_write" ON public.ce_partial_payment_policies
  FOR ALL TO authenticated
  USING (public.ce_actor_can(auth.uid(), 'compliance.config.manage'))
  WITH CHECK (public.ce_actor_can(auth.uid(), 'compliance.config.manage'));

DROP TRIGGER IF EXISTS ce_pp_policies_touch ON public.ce_partial_payment_policies;
CREATE TRIGGER ce_pp_policies_touch BEFORE UPDATE ON public.ce_partial_payment_policies
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
DROP TRIGGER IF EXISTS zz_ce_config_guard ON public.ce_partial_payment_policies;
CREATE TRIGGER zz_ce_config_guard BEFORE INSERT OR UPDATE OR DELETE ON public.ce_partial_payment_policies
  FOR EACH ROW EXECUTE FUNCTION public.ce_config_guard_trg();
DROP TRIGGER IF EXISTS zz_ce_config_history ON public.ce_partial_payment_policies;
CREATE TRIGGER zz_ce_config_history AFTER INSERT OR UPDATE OR DELETE ON public.ce_partial_payment_policies
  FOR EACH ROW EXECUTE FUNCTION public.ce_config_history_trg();

-- ---------- 2. Requests ----------
CREATE TABLE IF NOT EXISTS public.ce_partial_payment_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_number text NOT NULL UNIQUE,
  employer_id text NOT NULL,
  employer_name text,
  obligation_period_id uuid REFERENCES public.ce_obligation_periods(id) ON DELETE SET NULL,
  wage_period date NOT NULL,
  obligation_type text NOT NULL DEFAULT 'CONTRIBUTION_PAYMENT',
  source text NOT NULL DEFAULT 'EMPLOYER',
  status text NOT NULL DEFAULT 'PENDING_APPROVAL',
  policy_id uuid REFERENCES public.ce_partial_payment_policies(id),
  policy_snapshot jsonb,
  total_liability numeric(14,2) NOT NULL DEFAULT 0,
  requested_amount numeric(14,2) NOT NULL,
  approved_amount numeric(14,2),
  settled_amount numeric(14,2) NOT NULL DEFAULT 0,
  reason_code text,
  justification text NOT NULL,
  supporting_documents jsonb NOT NULL DEFAULT '[]'::jsonb,
  arrangement_id uuid,
  case_id uuid,
  violation_id uuid,
  grace_extension_days integer NOT NULL DEFAULT 0,
  grace_extended_to date,
  authority_invoice_id integer REFERENCES public.cn_invoices(id),
  authority_number text,
  authority_issued_at timestamptz,
  authority_expires_on date,
  requested_by text,
  requested_by_user_id uuid,
  requested_at timestamptz NOT NULL DEFAULT now(),
  decided_by text,
  decided_by_user_id uuid,
  decided_at timestamptz,
  decision_comments text,
  decision_context jsonb,
  settled_at timestamptz,
  payment_reference text,
  row_version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ce_pp_requests_status_chk CHECK (status IN
    ('DRAFT','PENDING_APPROVAL','APPROVED','REJECTED','CANCELLED','SETTLED','EXPIRED')),
  CONSTRAINT ce_pp_requests_source_chk CHECK (source IN ('EMPLOYER','CASHIER','COMPLIANCE')),
  CONSTRAINT ce_pp_requests_amount_chk CHECK (requested_amount > 0),
  CONSTRAINT ce_pp_requests_approved_chk CHECK (approved_amount IS NULL OR approved_amount > 0)
);

-- one open request per employer + obligation period
CREATE UNIQUE INDEX IF NOT EXISTS ce_pp_requests_one_open
  ON public.ce_partial_payment_requests (employer_id, wage_period, obligation_type)
  WHERE status IN ('DRAFT','PENDING_APPROVAL','APPROVED');
CREATE INDEX IF NOT EXISTS ce_pp_requests_status_idx
  ON public.ce_partial_payment_requests (status, wage_period DESC);
CREATE INDEX IF NOT EXISTS ce_pp_requests_employer_idx
  ON public.ce_partial_payment_requests (employer_id, wage_period DESC);

GRANT SELECT ON public.ce_partial_payment_requests TO authenticated;
GRANT ALL ON public.ce_partial_payment_requests TO service_role;
ALTER TABLE public.ce_partial_payment_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ce_pp_requests_read" ON public.ce_partial_payment_requests
  FOR SELECT TO authenticated
  USING (public.ce_actor_can(auth.uid(), 'compliance.cases.manage'));

DROP TRIGGER IF EXISTS ce_pp_requests_touch ON public.ce_partial_payment_requests;
CREATE TRIGGER ce_pp_requests_touch BEFORE UPDATE ON public.ce_partial_payment_requests
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ---------- 3. Allocation lines ----------
CREATE TABLE IF NOT EXISTS public.ce_partial_payment_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.ce_partial_payment_requests(id) ON DELETE CASCADE,
  payment_code text NOT NULL,
  fund_code text,
  bucket_label text,
  outstanding_amount numeric(14,2) NOT NULL DEFAULT 0,
  requested_amount numeric(14,2) NOT NULL DEFAULT 0,
  approved_amount numeric(14,2),
  allocation_sequence integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ce_pp_alloc_unique UNIQUE (request_id, payment_code),
  CONSTRAINT ce_pp_alloc_amounts_chk CHECK (requested_amount >= 0 AND (approved_amount IS NULL OR approved_amount >= 0))
);
CREATE INDEX IF NOT EXISTS ce_pp_alloc_request_idx ON public.ce_partial_payment_allocations (request_id);

GRANT SELECT ON public.ce_partial_payment_allocations TO authenticated;
GRANT ALL ON public.ce_partial_payment_allocations TO service_role;
ALTER TABLE public.ce_partial_payment_allocations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ce_pp_alloc_read" ON public.ce_partial_payment_allocations
  FOR SELECT TO authenticated
  USING (public.ce_actor_can(auth.uid(), 'compliance.cases.manage'));

DROP TRIGGER IF EXISTS ce_pp_alloc_touch ON public.ce_partial_payment_allocations;
CREATE TRIGGER ce_pp_alloc_touch BEFORE UPDATE ON public.ce_partial_payment_allocations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ---------- 4. Request history (append-only) ----------
CREATE TABLE IF NOT EXISTS public.ce_partial_payment_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.ce_partial_payment_requests(id) ON DELETE CASCADE,
  action text NOT NULL,
  from_status text,
  to_status text,
  amount numeric(14,2),
  allocation_snapshot jsonb,
  reason text,
  comments text,
  acted_by text,
  acted_by_user_id uuid,
  acted_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ce_pp_events_request_idx
  ON public.ce_partial_payment_events (request_id, acted_at DESC);

GRANT SELECT ON public.ce_partial_payment_events TO authenticated;
GRANT ALL ON public.ce_partial_payment_events TO service_role;
ALTER TABLE public.ce_partial_payment_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ce_pp_events_read" ON public.ce_partial_payment_events
  FOR SELECT TO authenticated
  USING (public.ce_actor_can(auth.uid(), 'compliance.cases.manage'));

-- ---------- 5. Seed the St Kitts default policy ----------
INSERT INTO public.ce_partial_payment_policies
  (policy_code, policy_name, scope_key, is_active, minimum_acceptable_percent,
   minimum_acceptable_amount, extends_payment_grace, max_grace_extension_days,
   authority_validity_days, required_approval_role, escalated_approval_role,
   escalation_threshold_amount, notes, created_by, updated_by)
VALUES
  ('SKN_PARTIAL_DEFAULT', 'St Kitts & Nevis — Partial Payment Policy', 'DEFAULT', true,
   0, 0, true, 30, 14, 'senior', 'head', 50000,
   'Client-approved default: no fixed minimum shortfall threshold; every partial payment requires governed approval before posting.',
   'SYSTEM', 'SYSTEM')
ON CONFLICT (policy_code) DO NOTHING;

-- ---------- 6. Feature flag ----------
INSERT INTO public.feature_flags (flag_key, display_name, description, is_enabled, rollout_state)
VALUES ('compliance.payment.partial_payment', 'Partial Payment Requests',
        'Governed DR-004 partial payment request, approval and payment-authority workflow.', true, 'public')
ON CONFLICT (flag_key) DO NOTHING;
