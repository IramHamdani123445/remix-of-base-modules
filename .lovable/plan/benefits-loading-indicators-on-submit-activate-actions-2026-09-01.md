# Benefits — Loading Indicators on Submit / Activate Actions

Goal: every action button in Benefit Management (claims, servicing, risk, means tests, and the `/bn/config/*` configuration screens) shows a spinner and becomes disabled while its save / submit / activate / approve call is in flight, so users cannot double-click and always see that work is happening.

## Current state

- 118 Benefits files already read `isPending` and many already render a `Loader2` spinner — those stay as they are.
- 45 Benefits files run mutations but contain no spinner or busy state at all (all of `src/components/bn/risk/*` dialogs and sections, the means-test sections, and config screens such as `ProductEditor`, `RulesAdministration`, `ReasonCodes`, `ProductParameterRegistry`, `DerivedFactRegistry`, `EscalationConfig`, `BenefitCommunicationTemplates`, `ChannelsTab`, `CalculationBuilder`, `CountryProfileEditor`, `FundingSourceAccountManager`). These are the targets.

## Approach

1. **Add a shared `BnBusyButton`** to `src/components/bn/shared/` (exported from `index.ts`).
   - Props: everything `Button` accepts plus `loading?: boolean` and optional `loadingLabel`.
   - When `loading` is true: renders a `Loader2` spinner before the label, sets `disabled`, and keeps button width stable.
   - Uses existing shadcn `Button` and design tokens — no new colours or styles.

2. **Sweep the 45 files** and replace their submit / save / activate / approve / confirm / reject buttons with `BnBusyButton loading={mutation.isPending}`. Where a component fires several mutations, each button binds to its own mutation's pending flag.

3. **Row-level and toolbar actions** (e.g. risk section inline Activate buttons, means-test queue actions) get the same treatment, with the spinner scoped to the row being acted on where the mutation carries an id.

4. **Consistency pass** on the files that already have spinners: confirm the busy button is also `disabled` while pending (a few only show the spinner). No visual redesign.

## Out of scope

- No changes to mutations, services, RPCs, validation, or toasts.
- No backend or database changes.
- No changes outside `src/pages/bn/**` and `src/components/bn/**`.

## Verification

- Typecheck and build clean.
- Playwright pass on a representative sample (`/bn/config/products` editor save, a risk dialog submit, a means-test decision submit) confirming the button shows a spinner and is disabled during the call and returns to normal afterwards.
