# Unify Case "History" and "Timeline" into a single Activity tab

## Answer first

They are technically different data sources, but conceptually the same thing to a user:

- **History** tab reads `ce_case_history` — case-only status transitions (action, from/to status, performed by, notes), rendered as a table.
- **Timeline** tab reads the compliance audit log via `ComplianceTimeline` in aggregate mode — audited events for the case *plus* its linked violations, notices and arrangements, rendered as a vertical feed.

So Timeline is a superset in scope (related records) but History carries case status-change rows that come from a different table. Showing both as separate tabs is redundant and confusing.

## Proposal

Replace the two tabs with one tab titled **Activity** (icon: History), containing a single chronological, newest-first feed of both sources merged.

```text
[ Overview ] [ Violations ] [ Notices ] [ Arrangements ] [ Documents ] [ Inspections ] [ Activity (n) ]
```

Inside the Activity tab:
- Header with a scope filter: **All activity** (default) / **This case only**.
  - "This case only" hides events belonging to linked violations, notices and arrangements.
- One merged, newest-first list. Each entry shows: timestamp, action label, source chip (Case / Violation / Notice / Arrangement), from → to status when present, performer, and notes/description.
- Case status transitions from `ce_case_history` appear as entries with a "Case" chip, styled the same as audit entries.
- De-duplication: if a `ce_case_history` row and an audit entry describe the same status change (same case, same action, same to-status, within a small time window), show only one entry.
- Empty state: "No activity recorded for this case."

Existing deep links using `?tab=history` or `?tab=timeline` resolve to the Activity tab so old links do not break.

## Technical notes

- `src/components/compliance/ComplianceTimeline.tsx`: add optional extra entries input so caller-supplied `ce_case_history` rows can be normalised into the same `ComplianceAuditEntry` shape and merged before sorting, plus an optional scope filter control. No change to the audit service or any table.
- `src/pages/compliance/cases/CaseDetailView.tsx`: remove the `history` tab trigger and its table `TabsContent`; rename the `timeline` tab to `Activity` with value `activity`; pass the already-fetched `caseHistory` rows into the timeline component; map legacy tab values to `activity`.
- No database, RLS, or service-layer changes. `ce_case_history` keeps being read exactly as it is today; no raw audit-log querying is added.
- Count badge on the tab is the merged entry count.

## Out of scope

Other Compliance pages that use `ComplianceTimeline` in single mode keep their current behaviour and title.
