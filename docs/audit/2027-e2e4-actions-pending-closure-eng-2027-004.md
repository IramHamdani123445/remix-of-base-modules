# Internal Audit — Stage 1B / E2E-4

## Closed – Actions Pending, with post-closure action monitoring

Engagement: **ENG-2027-004 — Compliance / Contribution Processing (C3)**
Engagement id: `f157530a-f9e5-4ea9-89b4-c3b4f769d724`
Status: **CLOSED (business journey certified)**
Scope: business lifecycle only. No Omni-Comms platform development, no channel activation changes.

---

## 1. Journey executed

| Stage | Actor | Result |
| --- | --- | --- |
| Launch → Notification Sent | Head of Internal Audit | `ia_launch_engagement` |
| Preparation complete | Lead Auditor | `ia_complete_preparation` |
| Fieldwork | Lead Auditor | 2 findings raised, reviewed, confirmed, released |
| Management responses | Compliance management | Both **Accepted**, both reviewed by the Lead Auditor |
| Corrective actions | Lead Auditor | ACT-2027-004-A (due 2027-06-30), ACT-2027-004-B (due 2027-05-29) |
| Exit meeting + draft report | Lead Auditor | report `807b23c8-…`, version V1.0 |
| Quality review | **Quality Reviewer** | `Cleared`, rating *Satisfactory* |
| Report issued | Head of Internal Audit | `ia_issue_report` + Final Report Issue communication stage |
| Follow-up monitoring | Head of Internal Audit | findings moved to *Responded* |
| Closure | Head of Internal Audit | **Closed – Actions Pending**, 2 actions still open |

Findings: `F-2027-004-01` (Critical — C3 schedules accepted without reconciliation to remitted funds),
`F-2027-004-02` (High — late-filing penalties not raised on overdue C3 submissions).

### Negative test — closure discipline

Attempting a plain **Closed** while corrective actions remained open was rejected:

```
IA_ACTIONS_PENDING — "Corrective actions or follow-ups are still open —
close as \"Closed – Actions Pending\"" (open_actions: 2, open_follow_ups: 0)
```

Closure only succeeded under the correct disposition, and both actions remain `Open`
after closure, i.e. governance over remediation survives audit closure.

---

## 2. Defects found and closed this stage

### DEF-S1B-27 — Assigned Quality Reviewer could not conclude their own quality review

`ia_cmd_guard_elevated` recognised only the engagement's lead auditor or engagement
reviewer. The person designated on `ia_quality_reviews.reviewer_id` was therefore refused
with `IA_FORBIDDEN`, and quality sign-off could only be performed by someone with weaker
independence.

**Fix:** the guard now also recognises the assigned quality reviewer for that engagement.
The existing segregation-of-duties block — the lead auditor cannot clear QA on their own
engagement — is unchanged. Proven by the Quality Reviewer persona clearing review
`3c35a578-…` (`IA.QA.CLEARED`).

### DEF-S1B-28 — Lead Auditor never resolved for reminders and escalations

`ia_resolve_escalation_recipient` treated `ia_audit_engagements.lead_auditor_id`
(an `ia_auditors` key) as a `profiles` key, so every `LEAD_AUDITOR` escalation returned
`UNRESOLVED / PROFILE_NOT_FOUND`. All 30-day and 60-day escalations would have gone out
without the audit-side recipient.

**Fix:** the resolver maps the auditor record to its linked user account
(`coalesce(profile_id, user_id)`), returns `LEAD_AUDITOR_NOT_PROFILE_LINKED` when no link
exists, and still accepts legacy rows that already hold a profile id.
Post-fix resolution source: `ia_auditors.profile_id` → *W4 Cert Auditor*.

### Configuration gap closed

The **Compliance** department had no resolvable head (`DEPARTMENT_HEAD_NOT_PROFILE_LINKED`).
A governed designation was proposed and approved under maker-checker
(`ia_office_holder` `a79c8b3d-…`, Compliance Manager (UAT), effective 2026-08-01).

---

## 3. Reminder and escalation certification

`ia_comms_generate_reminders` was run for every window across both actions
(+14, +7, 0, −7, −30, −60 days relative to target date):

| Occurrence | Roles emitted | Resolution source |
| --- | --- | --- |
| `due_soon_14` | Action Owner | `ia_action_tracking.responsible_profile_id` |
| `due_soon_7` | Action Owner | `ia_action_tracking.responsible_profile_id` |
| `due_today` | Action Owner | `ia_action_tracking.responsible_profile_id` |
| `overdue_7` | Action Owner | `ia_action_tracking.responsible_profile_id` |
| `overdue_30` | Action Owner, Department Head, Lead Auditor | action / `ia_office_holder` / `ia_auditors.profile_id` |
| `overdue_60` | Action Owner, Department Head, Lead Auditor, Head of Internal Audit | action / `ia_office_holder` / `ia_auditors.profile_id` / `ia_office_holder` |

Totals across 12 dated runs: **22 emitted, 0 unresolved, 0 role conflicts, 0 errors**,
every run `COMPLETED`.

Business events raised through the Omni-Comms outbox (no direct sending by the audit module):

- `INTERNAL_AUDIT.ACTION.DUE_SOON` — 6
- `INTERNAL_AUDIT.ACTION.OVERDUE` — 2
- `INTERNAL_AUDIT.ACTION.ESCALATED` — 14

**Idempotency:** re-running 2027-07-30 and 2027-08-29 produced `emitted: 0`,
`deduplicated: 3` and `deduplicated: 4` respectively — no recipient is notified twice for
the same occurrence and role.

---

## 4. Not in scope

- No channel was activated or released; emissions stop at the governed event outbox and
  remain subject to the existing dispatch-authorization gate.
- No Omni-Comms platform code was changed.
- The Head of Internal Audit still cannot configure office holders (that remains an
  administrator function); noted, not changed.
