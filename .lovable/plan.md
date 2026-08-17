# Omni-Comms: real sub-menu navigation + email stationery/templating

Two things to fix:

1. The module hides most surfaces behind `?view=` tabs on one Overview page. You want real
   menu entries and real pages.
2. Print now resolves letterheads, logos and footers properly, but **email has no equivalent**.
   Emails go out with whatever raw HTML the template produced — no organisation email layout,
   no department override, no branded header/footer.

---

## Part 1 — Replace tabs with a proper left-menu structure

Today the seven permanent routes are Overview, Operations, Events, Templates, Channels,
Preferences, Health, and Overview secretly hosts six more surfaces through `?view=`
(dashboard, control-center, setup, safe-test, reference-data, stationery). Stationery itself
then adds a second tab strip (Letterheads / Media / Text blocks / Headers & footers / Signatures).
Two stacked tab layers is exactly what feels wrong.

New structure — every destination becomes an addressable route and a sidebar entry, grouped:

```text
Omnichannel Communications
├── Overview                     /admin/omnichannel-communications
├── Control Center               .../control-center
├── Channels                     .../channels
├── Events                       .../events
├── Templates                    .../templates
├── Operations                   .../operations
├── Stationery
│   ├── Letterheads              .../stationery/letterheads
│   ├── Email layouts            .../stationery/email-layouts
│   ├── Media library            .../stationery/media
│   ├── Text blocks              .../stationery/text-blocks
│   ├── Headers & footers        .../stationery/headers-footers
│   └── Signatures               .../stationery/signatures
└── Setup & Health
    ├── Setup                    .../setup
    ├── Safe test                .../safe-test
    └── Health                   .../health
```

- Sidebar entries are inserted into `app_modules` under the existing Omni-Comms parent so the
  left menu drives navigation, with a matching in-page section rail for the Stationery group.
- Old `?view=` and `?section=` links keep working via redirects, so nothing already bookmarked breaks.
- The route registry, route-count architecture check and permission registry are updated in the
  same change (governance requires registry and route to move together).
- Overview becomes a genuine landing dashboard again — capability status, live gates, what is
  queued — instead of a tab host.

## Part 2 — Bring email branding and templating over from the Communication Hub

The Hub already has the pieces email needs; they are just not wired to Omni-Comms sends:

| Hub asset | Purpose | Where it lands |
| --- | --- | --- |
| Organisation email defaults | Org-level sender, header, footer, colours | Stationery → Email layouts (org scope) |
| Email layouts | Reusable branded HTML shells | Stationery → Email layouts |
| Text blocks / disclaimers | Reusable copy, legal footers | Stationery → Text blocks |
| Media library | Logo/banner assets for email headers | Stationery → Media library |
| Department profiles | Department overrides (Benefits, Legal, …) | Scope selector inside Email layouts |

Resolution precedence, matching the print letterhead resolver already in place:

```text
Organisation default → Department override → Event/template override
```

Work:

- Add a server-side `omni_comms_priv_email_layout_effective` resolver mirroring the existing
  print letterhead resolver, reading the same Hub tables (no duplicate tables, no new
  email module).
- The dispatch claim RPC starts carrying the resolved email layout (header HTML, logo asset,
  footer blocks, disclaimer, sender identity) alongside the message body.
- A shared `emailLayoutRenderer` wraps the template body in the resolved branded shell before
  the Resend adapter sends it — so Benefits, Legal, Compliance and every future module inherit
  branding without changing any module code.
- Templates page gains an email preview that renders through the same resolver, so what an
  administrator sees is what recipients get.
- Stationery → Email layouts surfaces the existing Hub editors (organisation defaults, layouts)
  at their new Omni-Comms routes, editing the same records — one system, second entry point.

## Technical notes

- No new tables: reuse `comm_letterhead`, `comm_media_asset`, `core_text_block`,
  `core_organization`, `core_department_profile` and the existing template master.
- `omniCommsNavigation.ts` becomes route-driven; `resolveOverviewView` is kept only as a
  redirect shim for legacy links.
- `StationerySurface.tsx` is split into per-route pages; each embedded Hub editor keeps its
  current component so there is no behaviour drift.
- Registry files updated together: route registry, route-count check, permission registry,
  `app_modules` seed migration.
- Existing Omni-Comms tests are updated for the new routes; navigation tests assert every
  sidebar entry resolves to a real page and every legacy `?view=` link redirects.

## Sequence

1. Route + sidebar restructure with legacy redirects (Part 1).
2. Email layout resolver + dispatch wiring (Part 2 backend).
3. Email layout editors and template preview at their new routes (Part 2 UI).
4. Full test pass and a live branded Benefits email verification.
