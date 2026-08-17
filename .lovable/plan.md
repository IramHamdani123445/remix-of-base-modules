# Print the real letterhead, and bring stationery into Omni-Comms

## What's wrong today

The printed PDF (`LTR-4DDFD39B0D1E`) shows a plain text header: three address lines, a rule, the body, and a footer line. The letterhead you designed in the Communication Hub — logo, organisation name, tagline, Head Office / Branch Office blocks side by side, green divider, footer note — never reaches the printer.

Reason: the print stationery resolver only reads two legacy columns on the letterhead record (`header_html`, `footer_html`, `logo_url`) and flattens them to text lines. The real letterhead lives in `design_config` (layout variant, which office blocks to show, which media asset is the logo/watermark/header band, which text block is the footer note), and its content is resolved live from Organisation, Locations/Branches and Text Blocks. The active letterheads in the database have `logo_url` empty and `logo_asset_code: SSB_LOGO_MAIN` in `design_config` — so the print path finds nothing.

## What will be built

### 1. Server-side letterhead resolution (one authority)

A new resolver `omni_comms_priv_print_letterhead_effective(org, department)` returns the complete, already-resolved stationery for a letter:

- effective letterhead (organisation default, overridden by department profile — unchanged inheritance)
- `design_config` layout: variant, page size, orientation, margins, divider colour, block layout, field flags
- live content resolved in SQL exactly as the Hub preview resolves it in the browser: organisation name and tagline, Head Office and Branch Office blocks from `office_locations` (role or specific id), footer note from `core_text_block`
- media assets resolved from the Media Library by asset code (logo, watermark, seal, header band, footer band) into bucket + storage path
- print footer and page-footer template, unchanged

The existing `..._print_stationery_effective` stays as a compatibility wrapper so nothing else breaks.

### 2. Faithful PDF rendering

`printArtefactAdapter.ts` gains a letterhead layout engine matching the Hub preview:

- **SSB standard variant**: logo (with tagline caption) top-left, organisation name beside it, Head Office / Branch Office blocks left-right or stacked, coloured divider rule, body, footer note block plus `Page n of m`.
- **Image bands variant**: full-width header image, body inset by configured margins, full-width footer image, logo/seal top-right.
- Watermark image drawn behind body content at low opacity.
- Page size, orientation and margins honoured from `design_config` (currently hard-coded A4).

The print worker already fetches and caches one logo; it will fetch and cache the full asset set per batch.

### 3. Stationery inside Omni-Comms

A new **Stationery** section in the Omni-Comms admin (Letterheads, Text Blocks, Media Library, Print Footers) rendering the existing Communication Hub screens — the same components and the same tables, no duplicate records or parallel editors. Plus a new **Effective stationery** panel showing, for each module/department (Benefits first): which letterhead resolves, where it inherits from, which assets it binds, and a live preview of the exact letter that will print, rendered from the same server resolver the worker uses.

## Technical notes

- New: `omni_comms_priv_print_letterhead_effective` (SQL), letterhead layout renderer in `supabase/functions/_shared/omni-comms/printArtefactAdapter.ts`, asset batch fetch in `omni-comms-print-production`, `StationerySurface` + `EffectiveStationeryPanel` under `src/platform/omni-comms/admin`.
- Reused unchanged: `comm_letterhead`, `comm_media_asset`, `core_text_block`, `comm_print_footer`, `core_department_profile` inheritance, `LetterheadPreview`, Media Library and Text Block admin components.
- No new tables, no duplicated letterhead or asset storage.

## Open question

The Communication Hub screens for Letterheads / Media Library / Text Blocks are also used by Legal and other modules. Plan is to **surface** them inside Omni-Comms (same screens, second entry point) rather than remove them from the Hub, so nothing else breaks. Say the word if you want the Hub entries retired instead.
