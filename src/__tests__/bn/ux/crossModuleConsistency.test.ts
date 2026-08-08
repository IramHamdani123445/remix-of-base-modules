/**
 * Cross-module Benefits UI consistency.
 *
 * Means-Test, Fraud/Error & Risk, Uprating & Indexation and Overpayment
 * Recovery must feel like one product: the same page frame, the same header,
 * the same breadcrumb trail and the same queue state presentation.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const MODULE_PAGES = {
  'Means-Test': 'src/pages/bn/meansTests/BnMeansTestsPage.tsx',
  Risk: 'src/pages/bn/risk/BnRiskManagementPage.tsx',
  Uprating: 'src/pages/bn/uprating/BnUpratingPage.tsx',
  Overpayment: 'src/pages/bn/servicing/OverpaymentRecovery.tsx',
} as const;

const read = (relative: string) => fs.readFileSync(path.join(process.cwd(), relative), 'utf8');

describe('Benefits cross-module UI consistency', () => {
  it.each(Object.entries(MODULE_PAGES))('%s uses the shared page frame', (_name, file) => {
    const source = read(file);
    expect(source).toContain('BnModulePage');
    expect(source).toContain('BnModuleHeader');
  });

  it.each(Object.entries(MODULE_PAGES))('%s uses the shared breadcrumb trail', (_name, file) => {
    expect(read(file)).toContain('BnModuleTrail');
  });

  it.each(Object.entries(MODULE_PAGES))('%s uses consistent responsive page padding', (_name, file) => {
    const source = read(file);
    expect(source).not.toMatch(/className="[^"]*\bp-6\b[^"]*"/);
  });

  it('exposes the shared primitives from the Benefits UX barrel', () => {
    const barrel = read('src/components/bn/ux/index.ts');
    for (const symbol of ['BnModulePage', 'BnModuleHeader', 'BnModuleGuidance', 'BnDataState', 'BnFilterBar', 'BnModuleTrail']) {
      expect(barrel).toContain(symbol);
    }
  });

  it('renders queue loading, error and empty states through BnDataState', () => {
    expect(read(MODULE_PAGES['Means-Test'])).toContain('BnDataState');
    expect(read(MODULE_PAGES.Overpayment)).toContain('BnDataState');
  });

  it('offers a single clear-filters affordance through BnFilterBar', () => {
    expect(read(MODULE_PAGES['Means-Test'])).toContain('BnFilterBar');
    expect(read(MODULE_PAGES.Overpayment)).toContain('BnFilterBar');
  });
});
