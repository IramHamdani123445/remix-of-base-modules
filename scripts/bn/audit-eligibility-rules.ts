/**
 * BUG-31 — audit the eligibility rule set of EVERY active product version.
 *
 * BUG-31 was raised against one product, but the defects it describes are not
 * product-specific: rules with no field mapping, duplicate rules expressing the
 * same requirement, and a declared data source that contradicts the field the
 * rule actually reads. This script checks all of them across the whole
 * catalogue so no product is fixed in isolation.
 *
 * Once BUG-29 is in place an unmapped rule blocks claims instead of silently
 * passing them, so an unmapped rule on an ACTIVE version means that product
 * rejects everyone. That is reported as an ERROR and fails the run.
 *
 *   npx tsx scripts/bn/audit-eligibility-rules.ts            # human report
 *   npx tsx scripts/bn/audit-eligibility-rules.ts --json     # machine readable
 *   npx tsx scripts/bn/audit-eligibility-rules.ts --all      # include DRAFT versions
 *
 * Exit code 1 when any ACTIVE version carries an ERROR finding.
 */
import { readFileSync } from 'node:fs';
import {
  resolveRuleFieldKey,
  lookupField,
  isInformationalRule,
  requirementKey,
  type EvaluableRule,
} from '../../src/services/bn/eligibility/ruleFieldMapping';

type Severity = 'ERROR' | 'WARN';

interface Finding {
  severity: Severity;
  code: string;
  ruleCodes: string[];
  detail: string;
}

interface RuleRow extends EvaluableRule {
  id: string;
  is_active: boolean;
  data_source: string | null;
  product_version_id: string;
}

// ── environment ────────────────────────────────────────────────────────

function readEnv(): { url: string; key: string } {
  const fromProcess = {
    url: process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL,
    key: process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_PUBLISHABLE_KEY,
  };
  if (fromProcess.url && fromProcess.key) return { url: fromProcess.url, key: fromProcess.key };

  const text = readFileSync('.env', 'utf8');
  const pick = (name: string) =>
    text.split(/\r?\n/).find((l) => l.startsWith(`${name}=`))?.slice(name.length + 1).trim()
      .replace(/^["']|["']$/g, '');
  const url = pick('VITE_SUPABASE_URL');
  const key = pick('VITE_SUPABASE_PUBLISHABLE_KEY');
  if (!url || !key) throw new Error('VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY not found');
  return { url, key };
}

const { url: SUPABASE_URL, key: SUPABASE_KEY } = readEnv();

async function rest<T>(path: string): Promise<T> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
  });
  const body = await res.json();
  if (!res.ok || (body && (body as any).code)) {
    throw new Error(`GET ${path} → ${JSON.stringify(body)}`);
  }
  return body as T;
}

// ── the checks ─────────────────────────────────────────────────────────

/**
 * A declared data_source that names a different table than the field's own
 * source is the "mismatched source" defect: BUG-31's "500 contributions
 * credited" read a contribution count but declared an annual wages total.
 */
const FIELD_SOURCE_HINTS: Record<string, string[]> = {
  'contribution.total_weeks': ['ip_wages', 'bn_get_contribution_summary'],
  'contribution.paid_weeks': ['ip_wages', 'bn_get_contribution_summary'],
  'contribution.total_wages': ['ip_wages', 'bn_get_contribution_summary'],
  'contribution.avg_weekly_wage': ['ip_wages', 'bn_get_contribution_summary'],
  'person.age_at_claim_date': ['ip_master'],
  'person.status': ['ip_master'],
  'person.deceased': ['ip_master'],
  'employer.status': ['er_master'],
};

function auditVersion(rules: RuleRow[]): Finding[] {
  const findings: Finding[] = [];
  const active = rules.filter((r) => r.is_active !== false);

  if (active.length === 0) {
    findings.push({
      severity: 'ERROR',
      code: 'NO_RULES',
      ruleCodes: [],
      detail: 'Version has no active eligibility rules — eligibility can never be determined (BUG-30).',
    });
    return findings;
  }

  // 1. every rule must resolve to a known field
  for (const rule of active) {
    if (isInformationalRule(rule)) continue;
    const { key, rawKey, source } = resolveRuleFieldKey(rule);
    if (!key) {
      findings.push({
        severity: 'ERROR',
        code: 'UNMAPPED_FIELD',
        ruleCodes: [rule.rule_code],
        detail: rawKey
          ? `field "${rawKey}" is in neither the field registry nor the fact registry — rule blocks every claim`
          : 'rule carries no field mapping at all — rule blocks every claim',
      });
    } else if (source === 'definition_fact' || source === 'alias') {
      findings.push({
        severity: 'WARN',
        code: 'LEGACY_KEY',
        ruleCodes: [rule.rule_code],
        detail: `field read from rule_definition.${source === 'alias' ? 'fact (via alias)' : 'fact'} "${rawKey}" → ${key}. Move it to the fact_key column.`,
      });
    }
  }

  // 2. duplicates — two rules asserting the identical requirement.
  //    The same requirementKey() the evaluator uses, so the audit reports
  //    exactly what the evaluator will collapse at runtime.
  const byRequirement = new Map<string, string[]>();
  for (const rule of active) {
    const rk = requirementKey(rule);
    if (!rk) continue;
    byRequirement.set(rk, [...(byRequirement.get(rk) ?? []), rule.rule_code]);
  }
  for (const [rk, codes] of byRequirement) {
    if (codes.length > 1) {
      findings.push({
        severity: 'WARN',
        code: 'DUPLICATE_RULE',
        ruleCodes: codes,
        detail: `${codes.length} rules assert the same requirement (${rk.split('|')[0]} ${rk.split('|')[1]} ${rk.split('|')[2]}). Keep one.`,
      });
    }
  }

  // 3. declared data_source contradicts the field the rule reads
  for (const rule of active) {
    if (!rule.data_source) continue;
    const { key } = resolveRuleFieldKey(rule);
    if (!key) continue;
    const expected = FIELD_SOURCE_HINTS[key];
    if (!expected) continue;
    const declared = rule.data_source.toLowerCase();
    if (!expected.some((e) => declared.includes(e))) {
      findings.push({
        severity: 'WARN',
        code: 'SOURCE_MISMATCH',
        ruleCodes: [rule.rule_code],
        detail: `declares data_source "${rule.data_source}" but reads ${key}, which comes from ${expected.join(' / ')}.`,
      });
    }
  }

  return findings;
}

// ── main ───────────────────────────────────────────────────────────────

interface VersionRow {
  id: string;
  version_number: number;
  status: string;
  bn_product: { benefit_code: string; benefit_name: string; status: string };
}

async function main() {
  const asJson = process.argv.includes('--json');
  const includeDrafts = process.argv.includes('--all');

  const statusFilter = includeDrafts ? '' : '&status=eq.ACTIVE';
  // Explicit order + limit: without them PostgREST returns an unordered,
  // silently capped page, so the audit would report a different set each run.
  const versions = await rest<VersionRow[]>(
    `bn_product_version?select=id,version_number,status,bn_product!inner(benefit_code,benefit_name,status)${statusFilter}` +
    `&order=id&limit=1000`,
  );

  const report: {
    product: string;
    productName: string;
    version: number;
    versionStatus: string;
    ruleCount: number;
    mapped: number;
    findings: Finding[];
  }[] = [];

  for (const v of versions) {
    const rules = await rest<RuleRow[]>(
      `bn_eligibility_rule?select=id,rule_code,rule_name,rule_group,is_active,fact_key,fail_action,data_source,rule_definition,product_version_id&product_version_id=eq.${v.id}`,
    );
    const active = rules.filter((r) => r.is_active !== false);
    report.push({
      product: v.bn_product.benefit_code,
      productName: v.bn_product.benefit_name,
      version: v.version_number,
      versionStatus: v.status,
      ruleCount: active.length,
      mapped: active.filter((r) => resolveRuleFieldKey(r).key !== null).length,
      findings: auditVersion(rules),
    });
  }

  report.sort((a, b) => a.product.localeCompare(b.product) || a.version - b.version);

  if (asJson) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    const errorVersions = report.filter((r) => r.findings.some((f) => f.severity === 'ERROR'));
    console.log('\nBN eligibility rule audit');
    console.log('='.repeat(78));
    console.log(
      `${'PRODUCT'.padEnd(20)} ${'VER'.padEnd(6)} ${'RULES'.padEnd(6)} ${'MAPPED'.padEnd(7)} FINDINGS`,
    );
    console.log('-'.repeat(78));
    for (const r of report) {
      const errs = r.findings.filter((f) => f.severity === 'ERROR').length;
      const warns = r.findings.filter((f) => f.severity === 'WARN').length;
      const flag = errs > 0 ? 'BLOCKS CLAIMS' : warns > 0 ? 'warnings' : 'ok';
      console.log(
        `${r.product.padEnd(20)} v${String(r.version).padEnd(5)} ${String(r.ruleCount).padEnd(6)} ` +
        `${`${r.mapped}/${r.ruleCount}`.padEnd(7)} ${errs} error / ${warns} warn  ${flag}`,
      );
    }

    for (const r of report.filter((x) => x.findings.length > 0)) {
      console.log(`\n${r.product} v${r.version} — ${r.productName} (${r.versionStatus})`);
      for (const f of r.findings) {
        const codes = f.ruleCodes.length ? ` [${f.ruleCodes.join(', ')}]` : '';
        console.log(`  ${f.severity === 'ERROR' ? 'ERROR' : ' warn'} ${f.code}${codes}`);
        console.log(`        ${f.detail}`);
      }
    }

    const totalRules = report.reduce((n, r) => n + r.ruleCount, 0);
    const totalMapped = report.reduce((n, r) => n + r.mapped, 0);
    console.log('\n' + '='.repeat(78));
    console.log(`${report.length} version(s), ${totalRules} active rule(s), ${totalMapped} mapped, ${totalRules - totalMapped} unmapped`);
    console.log(`${errorVersions.length} version(s) would block every claim:`);
    for (const r of errorVersions) console.log(`  - ${r.product} v${r.version}`);
  }

  const failed = report.some(
    (r) => r.versionStatus === 'ACTIVE' && r.findings.some((f) => f.severity === 'ERROR'),
  );
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
