/**
 * Generates docs/bn/BENEFITS_OMNI_COMMS_CATALOGUE.md from source truth.
 *
 * Never hand-maintained: every row is derived from the Benefits
 * communication catalogue plus the source-parity layer, which itself derives
 * implementation status from current Benefits command registries and the
 * generated database function inventory.
 *
 * Run: bun run scripts/omni-comms/generate-benefits-coverage-report.ts
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

// Node/Bun shim: some Benefits modules transitively import the browser client.
if (typeof globalThis.localStorage === 'undefined') {
  const store = new Map<string, string>();
  (globalThis as Record<string, unknown>).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: () => null,
    length: 0,
  };
}

import {
  benefitsCoverageRows,
  benefitsSourceParityReport,
  benefitsThreeNumberCoverage,
} from '../../src/platform/omni-comms/integrations/business/benefits/benefitsSourceParity';
import { benefitsCoverageSummary } from '../../src/platform/omni-comms/integrations/business/benefits/benefitsCommunicationCatalogue';

const rows = benefitsCoverageRows();
const coverage = benefitsThreeNumberCoverage();
const summary = benefitsCoverageSummary();
const parity = benefitsSourceParityReport();

const domains = [...new Set(rows.map((r) => r.domain))];

const lines: string[] = [];
lines.push('# Benefits → Omni-Comms communication catalogue');
lines.push('');
lines.push('> Generated file. Do not edit by hand.');
lines.push('> `bun run scripts/omni-comms/generate-benefits-coverage-report.ts`');
lines.push('');
lines.push('## Coverage (three independent numbers)');
lines.push('');
lines.push('| Measure | Count |');
lines.push('| --- | ---: |');
lines.push(`| Transitions catalogued | ${summary.total} |`);
lines.push(`| Distinct events designed | ${coverage.eventsDesigned} |`);
lines.push(`| Source EXECUTABLE | ${coverage.sourceExecutable} |`);
lines.push(`| Source SCHEDULER | ${coverage.sourceScheduler} |`);
lines.push(`| Source PLANNED (not executable today) | ${coverage.sourcePlanned} |`);
lines.push(`| Producers wired | ${coverage.producersWired} |`);
lines.push(`| Producers pending wiring (source executable) | ${coverage.producersPendingWiring} |`);
lines.push(`| Producers waiting for source implementation | ${coverage.producersWaitingForSource} |`);
lines.push(`| Email-capable | ${coverage.emailCapable} |`);
lines.push(`| Email-capable with executable source | ${coverage.emailCapableExecutable} |`);
lines.push('');
lines.push('## Classification');
lines.push('');
lines.push('| Classification | Count |');
lines.push('| --- | ---: |');
lines.push(`| COMMUNICATION_REQUIRED | ${summary.communicationRequired} |`);
lines.push(`| COMMUNICATION_OPTIONAL | ${summary.communicationOptional} |`);
lines.push(`| INTERNAL_ONLY | ${summary.internalOnly} |`);
lines.push(`| NO_COMMUNICATION_REQUIRED | ${summary.noCommunicationRequired} |`);
lines.push('');
lines.push('## Source parity');
lines.push('');
lines.push(`- Catalogue commands: ${parity.catalogueCommands.length}`);
lines.push(`- Source commands discovered: ${parity.sourceCommands.length}`);
lines.push(`- Catalogue-only (no source declaration): ${parity.catalogueOnly.length}`);
lines.push(`- Source commands missing from catalogue: ${parity.sourceMissingFromCatalogue.length}`);
lines.push(`- Deprecated aliases used as transitions: ${parity.aliasesUsedAsTransitions.length}`);
lines.push(`- Duplicate transitions: ${parity.duplicateTransitions.length}`);
lines.push('');

for (const domain of domains) {
  lines.push(`## ${domain}`);
  lines.push('');
  lines.push(
    '| Command | Event | Classification | Email | Template family | Source status | Trigger owner | Emission | Producer |',
  );
  lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const r of rows.filter((x) => x.domain === domain)) {
    lines.push(
      `| \`${r.command}\` | ${r.eventCode ?? '—'} | ${r.classification} | ${
        r.emailApplicable ? r.emailPolicy : 'no email'
      } | ${r.templateFamily ?? '—'} | ${r.sourceStatus} | ${r.triggerOwner} | ${
        r.emissionMechanism
      } | ${r.producerState} |`,
    );
  }
  lines.push('');
}

const out = resolve(process.cwd(), 'docs/bn/BENEFITS_OMNI_COMMS_CATALOGUE.md');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${lines.join('\n')}\n`, 'utf8');
console.log(`Wrote ${out} (${rows.length} rows).`);
