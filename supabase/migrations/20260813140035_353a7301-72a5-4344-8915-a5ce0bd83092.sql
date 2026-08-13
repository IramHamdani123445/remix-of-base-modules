-- Environment-specific incident remediation removed from permanent migration
-- execution. This migration version is retained so recorded production
-- migration history stays valid, but it is now a NO-OP: a fresh environment
-- must never require a production outbox UUID to rebuild.
--
-- Operational incident remediation belongs in audited operational tooling
-- (public.omni_comms_priv_requeue_business_event /
--  public.omni_comms_priv_reconcile_business_event_handoff), never in schema.
SELECT 1;
