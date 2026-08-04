/**
 * AW360-WAVE-1-C1 Slice B / B.1a — table-aware Supabase mock and recorder.
 *
 * Every Award 360 loader executed against this recorder is validated against
 * `AWARD360_SCHEMA_CONTRACT`. Unknown tables, unknown columns, `select('*')`,
 * unparseable selects, wrong-scope filters, disallowed order columns, and
 * disallowed containment operations all raise diagnostics — this is how
 * schema drift becomes a test failure instead of a runtime 500.
 *
 * Slice B.1a additions:
 *   • Loader / scenario tagging via `runAs()` — every recorded query
 *     carries its owning loader and scenario id.
 *   • Configurable per-table / per-query error injection.
 *   • Composite (`allOf`) and alternative (`anyOf`) scope rules with
 *     support for fixed expected values.
 *   • Additional query-builder verbs: `or`, `filter`, `match`, `range`,
 *     `limit`. Unsupported verbs raise a loud diagnostic.
 */
import {
  AWARD360_SCHEMA_CONTRACT,
  type Award360TableName,
  type Award360TableContract,
  type Award360ScopeRule,
} from '@/services/bn/awards/award360SchemaContract';

export interface RecordedAwardQuery {
  loaderName: string | null;
  scenarioId: string | null;
  /**
   * AW360-WAVE-1-C1 Slice B.1a Sub-batch B2-a §1 — internal execution id
   * assigned by `runAs()` when the builder is constructed. Two concurrent
   * `runAs()` invocations therefore never share the same execution id
   * even if they use identical (loader, scenario) tags, which keeps the
   * occurrence counter deterministic under `Promise.all`.
   */
  executionId: number;
  /** 1-indexed position of this query within (executionId, table). */
  occurrence: number;
  table: string;
  selectedColumns: string[];
  filters: Array<{ method: string; column: string; value?: unknown }>;
  orderColumns: string[];
  containmentColumns: string[];
  range?: [number, number];
  limit?: number;
  head: boolean;
  countMode?: string;
}

export interface AwardTableError {
  code?: string;
  message: string;
}

/**
 * AW360-WAVE-1-C1 Slice B.1a Batch 2 §9 — deterministic per-query error
 * injection. Matches by loader/scenario/table and an occurrence index
 * scoped to (loader, scenario, table) so two queries against the same
 * table (e.g. `bn_communication_log` claim_id vs. context) can fail
 * independently without changing production code.
 */
export interface ScenarioErrorRule {
  loaderName?: string;
  scenarioId?: string;
  table: string;
  /** 1-indexed match — the Nth query against the table for this loader/scenario. */
  occurrence?: number;
  error: AwardTableError;
}

/**
 * AW360-WAVE-1-C1 Sub-batch B2-b.3a §1 — deterministic per-query
 * successful response injection. Mirrors `ScenarioErrorRule` shape but
 * carries a successful `data` payload instead of an error, so a single
 * scenario can distinguish "primary bn_award returned award X" from
 * "related-awards bn_award returned []" without production changes.
 *
 * Resolution precedence at query time:
 *   1. scenario response matching (loader?, scenario?, table, occurrence?)
 *   2. general `responses[table]`
 *   3. default empty response
 */
export interface ScenarioResponseRule {
  loaderName?: string;
  scenarioId?: string;
  table: string;
  /** 1-indexed match — the Nth query against the table within (loader, scenario). */
  occurrence?: number;
  data: unknown;
}

export interface RecordedScenarioExecution {
  executionId: number;
  loaderName: string;
  scenarioId: string;
  /** Distinct tables observed within this execution, in first-seen order. */
  tables: readonly string[];
  queryCount: number;
  outcome: 'resolved' | 'rejected';
}

export interface AwardQueryRecorderOptions {
  /** Response payloads keyed by table name. */
  responses?: Record<string, unknown>;
  /** When true, unknown tables record but do not throw. Default false. */
  allowUnknownTables?: boolean;
  /**
   * Per-table error injection. When set, every query against the table
   * resolves with `{ data: null, error }` (or `{ data: [], error }` for
   * list terminals) instead of the configured response.
   */
  errors?: Record<string, AwardTableError>;
  /** Deterministic per-query error injection (§9). */
  scenarioErrors?: ScenarioErrorRule[];
  /** B2-b.3a §1 — deterministic per-query successful response injection. */
  scenarioResponses?: ScenarioResponseRule[];
  /** B2-b.1b — evidence sink, invoked once per `runAs()` completion. */
  onExecutionComplete?: (evidence: RecordedScenarioExecution) => void;
}

function isKnownTable(t: string): t is Award360TableName {
  return t in AWARD360_SCHEMA_CONTRACT;
}

function contractFor(t: string): Award360TableContract | null {
  return isKnownTable(t) ? AWARD360_SCHEMA_CONTRACT[t] : null;
}

function parseSelect(table: string, raw: string): string[] {
  const trimmed = raw.trim();
  if (trimmed === '' || trimmed === '*') {
    throw new Error(`[${table}] select('*') is forbidden in Award 360 — pass explicit columns.`);
  }
  if (/[()]/.test(trimmed)) {
    throw new Error(`[${table}] Unparseable select — nested relationship syntax is not supported by the Award 360 schema contract. Original: ${JSON.stringify(raw)}`);
  }
  return trimmed
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function assertColumn(table: string, column: string, op: string) {
  const contract = contractFor(table);
  if (!contract) throw new Error(`[${table}] ${op} against unknown table (not in Award 360 schema contract).`);
  if (!contract.allowedColumns.includes(column)) {
    throw new Error(
      `[${table}] ${op} references unknown column "${column}". Allowed: ${contract.allowedColumns.join(', ')}`,
    );
  }
}

// ─── scope rule evaluation ────────────────────────────────────────────────
function ruleSatisfied(rule: Award360ScopeRule, record: RecordedAwardQuery): boolean {
  if (rule.kind === 'allOf') return rule.rules.every((r) => ruleSatisfied(r, record));
  if (rule.kind === 'anyOf') return rule.rules.some((r) => ruleSatisfied(r, record));
  // filter
  return record.filters.some((f) => {
    if (f.column !== rule.column) return false;
    if (rule.method && f.method !== rule.method) return false;
    if (Object.prototype.hasOwnProperty.call(rule, 'expectedValue')) {
      return f.value === rule.expectedValue;
    }
    return true;
  });
}

function describeRule(rule: Award360ScopeRule): string {
  if (rule.kind === 'allOf') return `allOf(${rule.rules.map(describeRule).join(' & ')})`;
  if (rule.kind === 'anyOf') return `anyOf(${rule.rules.map(describeRule).join(' | ')})`;
  const val =
    Object.prototype.hasOwnProperty.call(rule, 'expectedValue')
      ? `=${JSON.stringify(rule.expectedValue)}`
      : '';
  return `${rule.method ?? 'any'}(${rule.column})${val}`;
}

function resolveScopeRule(
  contract: Award360TableContract,
  loaderName: string | null,
): Award360ScopeRule | null {
  // AW360-WAVE-1-C1 Sub-batch B2-b.1a §3 — loader-specific scope precedence.
  if (loaderName && contract.scopeRuleByLoader?.[loaderName]) {
    return contract.scopeRuleByLoader[loaderName];
  }
  if (contract.scopeRule) return contract.scopeRule;
  if (contract.requiredScope) {
    return { kind: 'filter', column: contract.requiredScope.column };
  }
  return null;
}

/** Secured query RPC → the table it reads on the server. */
const RPC_BACKING_TABLE: Record<string, string> = {
  bn_life_certificate_award_list_v1: 'bn_life_certificate',
};

// ─── recorder ─────────────────────────────────────────────────────────────
export class AwardQueryRecorder {
  readonly queries: RecordedAwardQuery[] = [];
  /**
   * B2-b.1b — accumulated `runAs()` evidence. Preserved across `reset()`
   * so a `beforeEach` that clears queries between tests does not erase
   * certification evidence. Call `resetEvidence()` explicitly to clear.
   */
  readonly scenarioExecutions: RecordedScenarioExecution[] = [];
  private currentLoader: string | null = null;
  private currentScenario: string | null = null;
  private currentExecutionId = 0;
  private nextExecutionId = 0;

  constructor(readonly opts: AwardQueryRecorderOptions = {}) {}

  reset() {
    this.queries.length = 0;
    this.currentLoader = null;
    this.currentScenario = null;
    this.currentExecutionId = 0;
    this.nextExecutionId = 0;
  }

  /** Clear execution evidence — not called by ordinary per-test reset. */
  resetEvidence() {
    this.scenarioExecutions.length = 0;
  }

  /**
   * Tag every query issued during `fn()` with the loader + scenario + a
   * fresh execution id. The execution id is scoped to THIS `runAs()`
   * call, so two concurrent calls (Promise.all) do not share occurrence
   * counters even when their (loader, scenario) tags collide.
   */
  async runAs<T>(loaderName: string, scenarioId: string, fn: () => Promise<T>): Promise<T> {
    const prevL = this.currentLoader;
    const prevS = this.currentScenario;
    const prevE = this.currentExecutionId;
    this.currentLoader = loaderName;
    this.currentScenario = scenarioId;
    const executionId = ++this.nextExecutionId;
    this.currentExecutionId = executionId;
    let outcome: 'resolved' | 'rejected' = 'resolved';
    try {
      return await fn();
    } catch (e) {
      outcome = 'rejected';
      throw e;
    } finally {
      // Derive tables from immutable executionId (concurrency-safe).
      const observed = this.queries.filter((q) => q.executionId === executionId);
      const tables: string[] = [];
      for (const q of observed) if (!tables.includes(q.table)) tables.push(q.table);
      const evidence: RecordedScenarioExecution = {
        executionId,
        loaderName,
        scenarioId,
        tables,
        queryCount: observed.length,
        outcome,
      };
      this.scenarioExecutions.push(evidence);
      try {
        this.opts.onExecutionComplete?.(evidence);
      } catch {
        // Evidence sinks must not break the recorder.
      }
      this.currentLoader = prevL;
      this.currentScenario = prevS;
      this.currentExecutionId = prevE;
    }
  }

  queriesFor(loaderName: string, scenarioId?: string): RecordedAwardQuery[] {
    return this.queries.filter(
      (q) => q.loaderName === loaderName && (!scenarioId || q.scenarioId === scenarioId),
    );
  }

  client() {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const recorder = this;
    return {
      /**
       * Secured query RPCs read a locked-down table on the server. The
       * recorder attributes the call to the table the RPC reads so
       * manifest `expectedTables` evidence stays truthful, and response /
       * error injection continues to key off that table name.
       */
      rpc(name: string, args: Record<string, unknown>) {
        const table = RPC_BACKING_TABLE[name];
        if (!table) {
          throw new Error(`[${name}] RPC is not registered in the Award 360 recorder.`);
        }
        const executionId = recorder.currentExecutionId;
        const occurrence =
          recorder.queries.filter((q) => q.executionId === executionId && q.table === table).length + 1;
        const record: RecordedAwardQuery = {
          loaderName: recorder.currentLoader,
          scenarioId: recorder.currentScenario,
          executionId,
          occurrence,
          table,
          selectedColumns: [],
          filters: Object.entries(args).map(([column, value]) => ({ method: 'rpc', column, value })),
          orderColumns: [],
          containmentColumns: [],
          head: false,
        };
        recorder.queries.push(record);

        for (const r of recorder.opts.scenarioErrors ?? []) {
          if (r.table !== table) continue;
          if (r.loaderName && r.loaderName !== record.loaderName) continue;
          if (r.scenarioId && r.scenarioId !== record.scenarioId) continue;
          if (r.occurrence !== undefined && r.occurrence !== record.occurrence) continue;
          return Promise.resolve({ data: null, error: r.error });
        }
        const err = recorder.opts.errors?.[table];
        if (err) return Promise.resolve({ data: null, error: err });

        for (const r of recorder.opts.scenarioResponses ?? []) {
          if (r.table !== table) continue;
          if (r.loaderName && r.loaderName !== record.loaderName) continue;
          if (r.scenarioId && r.scenarioId !== record.scenarioId) continue;
          if (r.occurrence !== undefined && r.occurrence !== record.occurrence) continue;
          return Promise.resolve({ data: Array.isArray(r.data) ? r.data : r.data ? [r.data] : [], error: null });
        }
        const raw = recorder.opts.responses?.[table] ?? [];
        return Promise.resolve({ data: Array.isArray(raw) ? raw : raw ? [raw] : [], error: null });
      },
      from(table: string) {
        if (!isKnownTable(table) && !recorder.opts.allowUnknownTables) {
          throw new Error(`[${table}] table is not registered in AWARD360_SCHEMA_CONTRACT.`);
        }
        const executionId = recorder.currentExecutionId;
        const priorSame = recorder.queries.filter(
          (q) => q.executionId === executionId && q.table === table,
        ).length;
        const occurrence = priorSame + 1;
        const record: RecordedAwardQuery = {
          loaderName: recorder.currentLoader,
          scenarioId: recorder.currentScenario,
          executionId,
          occurrence,
          table,
          selectedColumns: [],
          filters: [],
          orderColumns: [],
          containmentColumns: [],
          head: false,
        };
        recorder.queries.push(record);

        const resolveInjected = (): AwardTableError | null => {
          const rules = recorder.opts.scenarioErrors ?? [];
          for (const r of rules) {
            if (r.table !== table) continue;
            if (r.loaderName && r.loaderName !== record.loaderName) continue;
            if (r.scenarioId && r.scenarioId !== record.scenarioId) continue;
            if (r.occurrence !== undefined && r.occurrence !== record.occurrence) continue;
            return r.error;
          }
          return recorder.opts.errors?.[table] ?? null;
        };

        // AW360 B2-b.3a §1 — deterministic per-query successful response.
        const HAS_NO_RESPONSE = Symbol('no-response');
        const resolveScenarioResponse = (): unknown | typeof HAS_NO_RESPONSE => {
          const rules = recorder.opts.scenarioResponses ?? [];
          for (const r of rules) {
            if (r.table !== table) continue;
            if (r.loaderName && r.loaderName !== record.loaderName) continue;
            if (r.scenarioId && r.scenarioId !== record.scenarioId) continue;
            if (r.occurrence !== undefined && r.occurrence !== record.occurrence) continue;
            return r.data;
          }
          return HAS_NO_RESPONSE;
        };

        const respond = () => {
          const injected = resolveInjected();
          if (injected) {
            return Promise.resolve({ data: [], error: injected, count: null });
          }
          const scenarioResp = resolveScenarioResponse();
          const raw = scenarioResp === HAS_NO_RESPONSE
            ? recorder.opts.responses?.[table] ?? []
            : scenarioResp;
          const data = Array.isArray(raw) ? raw : raw ? [raw] : [];
          const count = data.length;
          return Promise.resolve({ data, error: null, count });
        };
        const respondSingle = () => {
          const injected = resolveInjected();
          if (injected) {
            return Promise.resolve({ data: null, error: injected });
          }
          const scenarioResp = resolveScenarioResponse();
          const raw = scenarioResp === HAS_NO_RESPONSE
            ? recorder.opts.responses?.[table] ?? null
            : scenarioResp;
          const data = Array.isArray(raw) ? raw[0] ?? null : raw;
          return Promise.resolve({ data, error: null });
        };

        const unsupported = (op: string) => {
          throw new Error(
            `[${table}] unsupported query operation "${op}" in Award 360 recorder — extend the recorder or repair the loader.` +
              (record.loaderName ? ` (loader=${record.loaderName})` : ''),
          );
        };

        const builder: any = {
          select(cols?: string, opts?: { count?: string; head?: boolean }) {
            // AW360-WAVE-1-C1 Slice B.1a Batch 2 §1 — reject every form of
            // ".select()" that would otherwise resolve to a wildcard: no
            // argument, empty string, whitespace, and explicit '*'.
            if (cols === undefined) {
              throw new Error(`[${table}] .select() called without explicit columns is forbidden in Award 360 — pass an explicit column list.`);
            }
            record.selectedColumns = parseSelect(table, cols);
            record.selectedColumns.forEach((c) => assertColumn(table, c, 'select'));
            if (opts?.head) record.head = true;
            if (opts?.count) record.countMode = opts.count;
            return builder;
          },
          eq(col: string, val: unknown) { assertColumn(table, col, 'eq'); record.filters.push({ method: 'eq', column: col, value: val }); return builder; },
          neq(col: string, val: unknown) { assertColumn(table, col, 'neq'); record.filters.push({ method: 'neq', column: col, value: val }); return builder; },
          in(col: string, val: unknown) { assertColumn(table, col, 'in'); record.filters.push({ method: 'in', column: col, value: val }); return builder; },
          is(col: string, val: unknown) { assertColumn(table, col, 'is'); record.filters.push({ method: 'is', column: col, value: val }); return builder; },
          not(col: string, _op: string, val: unknown) { assertColumn(table, col, 'not'); record.filters.push({ method: 'not', column: col, value: val }); return builder; },
          lt(col: string, val: unknown) { assertColumn(table, col, 'lt'); record.filters.push({ method: 'lt', column: col, value: val }); return builder; },
          lte(col: string, val: unknown) { assertColumn(table, col, 'lte'); record.filters.push({ method: 'lte', column: col, value: val }); return builder; },
          gt(col: string, val: unknown) { assertColumn(table, col, 'gt'); record.filters.push({ method: 'gt', column: col, value: val }); return builder; },
          gte(col: string, val: unknown) { assertColumn(table, col, 'gte'); record.filters.push({ method: 'gte', column: col, value: val }); return builder; },
          filter(col: string, _op: string, val: unknown) { assertColumn(table, col, 'filter'); record.filters.push({ method: 'filter', column: col, value: val }); return builder; },
          ilike(col: string, val: unknown) { assertColumn(table, col, 'ilike'); record.filters.push({ method: 'ilike', column: col, value: val }); return builder; },
          like(col: string, val: unknown) { assertColumn(table, col, 'like'); record.filters.push({ method: 'like', column: col, value: val }); return builder; },
          match(obj: Record<string, unknown>) {
            for (const [col, val] of Object.entries(obj)) {
              assertColumn(table, col, 'match');
              record.filters.push({ method: 'match', column: col, value: val });
            }
            return builder;
          },
          or(_expr: string) {
            // `.or()` is intentionally NOT supported for Award 360 loaders —
            // the contract cannot introspect the free-form filter string.
            unsupported('or');
          },
          contains(col: string, val: unknown) {
            const contract = contractFor(table);
            const allowed = contract?.allowedContainmentColumns ?? [];
            if (!contract || !contract.allowedColumns.includes(col)) {
              throw new Error(`[${table}] contains references unknown column "${col}".`);
            }
            if (allowed.length === 0 || !allowed.includes(col)) {
              throw new Error(`[${table}] contains("${col}") is not an allowed containment column (allowed: ${allowed.length ? allowed.join(', ') : '<none>'}).`);
            }
            record.containmentColumns.push(col);
            record.filters.push({ method: 'contains', column: col, value: val });
            return builder;
          },
          order(col: string, _o?: unknown) {
            const contract = contractFor(table);
            if (!contract || !contract.allowedColumns.includes(col)) {
              throw new Error(`[${table}] order references unknown column "${col}".`);
            }
            if (contract.allowedOrderColumns && !contract.allowedOrderColumns.includes(col)) {
              // B2-b.1b §1 — surface loader + scenario in every rejected-order diagnostic.
              const loaderTag = record.loaderName
                ? ` (loader=${record.loaderName}, scenario=${record.scenarioId})`
                : '';
              throw new Error(
                `[${table}] order("${col}") is not allowed${loaderTag}. Allowed order columns: ${contract.allowedOrderColumns.join(', ')}`,
              );
            }
            record.orderColumns.push(col);
            return builder;
          },
          range(from: number, to: number) { record.range = [from, to]; return builder; },
          limit(n: number) { record.limit = n; return builder; },
          maybeSingle: () => { recorder.assertScopeSatisfied(record); return respondSingle(); },
          single: () => { recorder.assertScopeSatisfied(record); return respondSingle(); },
          then: (onFulfilled: any, onRejected?: any) => {
            recorder.assertScopeSatisfied(record);
            return respond().then(onFulfilled, onRejected);
          },
        };
        return builder;
      },
    };
  }

  /**
   * Enforce required scope at query completion. When the table has a
   * `scopeRule`, that rule is evaluated; otherwise a simple filter on
   * `requiredScope.column` is required.
   */
  private assertScopeSatisfied(record: RecordedAwardQuery) {
    const contract = contractFor(record.table);
    if (!contract) return;
    const rule = resolveScopeRule(contract, record.loaderName);
    if (!rule) return;
    if (ruleSatisfied(rule, record)) return;
    // For simple filter rules we preserve the historical Slice B.1 error
    // wording (`required scope filter on "<col>"`); composite rules use a
    // richer description so failures are self-explanatory.
    const detail =
      rule.kind === 'filter'
        ? `required scope filter on "${rule.column}"` +
          (Object.prototype.hasOwnProperty.call(rule, 'expectedValue')
            ? ` = ${JSON.stringify(rule.expectedValue)}`
            : '')
        : `required scope: ${describeRule(rule)}`;
    const loaderTag = record.loaderName
      ? ` (loader=${record.loaderName}, scenario=${record.scenarioId})`
      : '';
    const filterTrace = record.filters.length
      ? record.filters.map((f) => `${f.method}(${f.column}=${JSON.stringify(f.value)})`).join(', ')
      : '<none>';
    throw new Error(
      `[${record.table}] query completed without ${detail}${loaderTag}. Filters actually issued: ${filterTrace}`,
    );
  }
}
