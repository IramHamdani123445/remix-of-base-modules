/**
 * Checkpoint F — the open client decision register must be reachable and every
 * provisional surface must declare which decision it depends on.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

describe('open client decision register', () => {
  it('the register page exists and reads the governed table', () => {
    const src = read('src/pages/compliance/settings/OpenDecisionRegister.tsx');
    expect(src).toContain('ce_open_business_decision');
    expect(src).toContain('production_blocker');
    expect(src).toContain('current_safe_behaviour');
  });

  it('is registered as a route and reachable from the compliance menu', () => {
    expect(read('src/components/routing/AppRoutes.tsx')).toContain(
      '/compliance/admin/settings/open-decisions',
    );
    expect(read('src/components/sidebar/menuItems/complianceMenuItems.ts')).toContain(
      '/compliance/admin/settings/open-decisions',
    );
  });

  it('risk surfaces declare the provisional weights decision', () => {
    expect(read('src/pages/compliance/settings/RiskRulePolicy.tsx')).toContain('E-RISK-FACTOR-WEIGHTS');
    expect(read('src/pages/compliance/risk/RiskScoreDetailsPage.tsx')).toContain('E-RISK-FACTOR-WEIGHTS');
  });

  it('the shared notice only renders decisions that are still OPEN', () => {
    const src = read('src/components/compliance/governance/OpenDecisionNotice.tsx');
    expect(src).toContain(".eq('status', 'OPEN')");
  });

  it('arrangement installments expose reminder state', () => {
    const src = read('src/components/compliance/arrangements/ArrangementInstallmentsPanel.tsx');
    expect(src).toContain('ce_arrangement_installment_reminders');
    expect(src).toContain('Reminders');
  });
});
