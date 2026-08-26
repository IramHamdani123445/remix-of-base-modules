# Presales & Marketing Pack

Sales-facing material for the Social Security & Public Administration Platform.
Everything here is grounded in software that exists in this repository. Nothing
in this pack should be sent to a prospect until the `[CONFIRM]` placeholders are
filled in by someone who owns the commercial relationship.

## Which document for which moment

| Situation | Use |
|---|---|
| First call / cold intro / one-pager to leave behind | `01-executive-brief.md` |
| "What does it actually do?" / RFP functional response | `02-feature-catalogue.md` |
| "Why you and not a big vendor?" / technical due diligence | `03-platform-differentiators.md` |
| Preparing for a discovery meeting or handling pushback | `04-discovery-and-objections.md` |
| Live or recorded product demo | `05-demo-script.md` |
| Writing a proposal, tender response, or MoU | `06-proposal-boilerplate.md` |

## Ground rules for anyone using this pack

1. **Do not add claims that are not in these files.** The feature catalogue was
   written from the actual codebase. If a prospect asks for something not
   listed, the honest answer is "not built today — here is what it would take".
2. **Roadmap items are labelled `Roadmap`.** Never present them as shipped.
3. **No numbers were invented.** Anywhere a figure would strengthen the pitch,
   there is a `[CONFIRM]` marker. Fill it with a real, defensible number.
4. **Reference-client naming needs permission.** The platform's reference
   implementation is a national social security board; naming it publicly
   requires written consent. Until then use "a Caribbean national social
   security board" or leave `[CONFIRM: reference client naming]`.
5. **No compliance or certification claims.** Do not write SOC 2, ISO 27001,
   GDPR-compliant, or similar unless an audit report exists.

## Open items to resolve before external use

- [ ] `[CONFIRM: reference client naming]` — may we name the reference board?
- [ ] `[CONFIRM: go-live dates]` — which modules are in production, since when?
- [ ] `[CONFIRM: scale figures]` — registered persons, employers, users, volumes.
- [ ] `[CONFIRM: hosting/residency options]` — what deployment models we offer.
- [ ] `[CONFIRM: commercial model]` — licensing, implementation, support tiers.
