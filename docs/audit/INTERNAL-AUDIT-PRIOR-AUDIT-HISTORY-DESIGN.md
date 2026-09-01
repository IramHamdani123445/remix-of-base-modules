# Internal Audit — Prior Audit History Design

## Business requirement

> "Where will these corrective actions be shown during the next audit?"

Corrective Actions stay owned by the audit that raised them:

```text
Original Audit → Original Finding → Original Corrective Action → Follow-Up
```

Ownership is **never** transferred to a later audit. Instead, when a new audit is
prepared for the same Department (optionally the same Function), the relevant
history is resurfaced automatically.

## Where it lives

Engagement → **Preparation** → **Prior Audit History**
(`src/components/audit/execution/PriorAuditHistoryPanel.tsx`)

Prior engagements are matched on the current engagement's department, excluding
the current engagement. A "same function only" filter narrows the lookback;
default lookback is all available history.

## Content

**Per prior audit** (`ia_prior_audit_history`): reference, title, period, final
report date, closure status, and summaries of

- Findings — Critical / High / Medium / Low, open, closed
- Corrective Actions — open, in progress, overdue, completion submitted,
  in verification, verified, closed
- Follow-Ups — scheduled, due, overdue, implemented, partially implemented,
  not implemented, reopened

**Per prior corrective action** (`ia_prior_action_detail`): action reference,
source audit, finding reference and title, recommendation, severity, responsible
person, accountable department, function, original due date, current target date,
progress %, lifecycle status, verification status, follow-up status and last
progress date.

## Review in Current Audit

`ia_link_prior_action(p_engagement_id, p_prior_action_id, p_relationship_type, p_relevance_reason)`
creates a **reference only** in `ia_prior_action_reference`:

```text
current_engagement_id · prior_action_id · relationship_type
relevance_reason · linked_by · linked_at · is_active
```

Relationship types: `PRIOR_ACTION_REVIEW`, `REPEAT_FINDING`, `FOLLOWUP_RETEST`.

Guarantees enforced server-side:
- the prior action's `engagement_id` is never changed;
- the action is never cloned;
- an action already belonging to the current engagement is rejected
  (`IA_ACTION_NOT_PRIOR`);
- unlinking (`ia_unlink_prior_action`) deactivates the reference only.

A referenced action is planning **context** — it may inform scope, objective,
risk consideration and audit procedures. It never auto-creates a Finding. A new
Finding arises only from current-audit evidence and testing.

## Preparation acknowledgement

When relevant prior audits exist, `ia_complete_preparation` refuses to complete
until `ia_acknowledge_prior_history` has recorded **Prior Audit History Reviewed**
(`prior_history_reviewed_at/_by/_note` on the engagement).

Open prior actions do **not** block preparation completion or launch.

## Security

Prior Audit History is auditor-private. Both read commands require
`ia_cmd_guard('audit_engagements','view', engagement)`; Management Respondents
are refused with `IA_FORBIDDEN`. Formal release of an individual action to a
department elsewhere in the system does not grant access to this workspace,
prior working papers, auditor evidence, QA notes, unreleased findings or internal
deliberation.
