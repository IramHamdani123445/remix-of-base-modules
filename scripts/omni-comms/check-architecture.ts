#!/usr/bin/env node
/**
 * Local + CI entry point for Omni-Comms architecture boundary checks.
 * Reads only. No mutation. Exits non-zero on any unbaselined new violation,
 * invalid baseline, or stale baseline.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  runArchitectureChecks,
  formatViolations,
} from '../../src/platform/omni-comms/architecture';

function main(): void {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.resolve(here, '..', '..');
  const summary = runArchitectureChecks({ repoRoot });

  const failing = summary.violations.filter(
    (v) => v.baselineStatus !== 'existing_baseline',
  );

  console.log('Omni-Comms architecture check');
  console.log(`  Files scanned:            ${summary.checkedFiles}`);
  console.log(`  Active baseline entries:  ${summary.activeBaselineEntries}`);
  console.log(`  Stale baseline entries:   ${summary.staleBaselineEntries}`);
  console.log(`  New unbaselined issues:   ${failing.length}`);
  console.log('');

  if (failing.length > 0) {
    console.log(formatViolations(failing));
    console.log('');
    console.log('FAIL — architecture boundary violations detected.');
    process.exit(1);
  }

  console.log('PASS — no unbaselined new-system architecture violations.');
}

main();
