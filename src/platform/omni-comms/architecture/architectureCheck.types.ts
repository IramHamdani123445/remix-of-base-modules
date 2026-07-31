/**
 * Omni-Comms — Architecture check shared types.
 *
 * Pure, deterministic types shared by the ten rule modules, the baseline
 * validator, and the orchestrator. No I/O, no runtime data.
 */

export type ArchitectureRuleSeverity = 'error' | 'warning';

export type ArchitectureRuleId =
  | 'OMNI_LEGACY_IMPORT'
  | 'OMNI_LEGACY_TABLE_REFERENCE'
  | 'OMNI_PROVIDER_IMPORT_BOUNDARY'
  | 'OMNI_REACT_RUNTIME_WRITE'
  | 'OMNI_MIGRATION_OBJECT_REGISTRY'
  | 'OMNI_ROUTE_REGISTRY'
  | 'OMNI_INTEGRATION_REGISTRY'
  | 'OMNI_QUEUE_REGISTRY'
  | 'OMNI_SEND_FACADE_BOUNDARY'
  | 'OMNI_PERMANENT_NAME_POLICY'
  | 'OMNI_RESOLVER_RUNTIME_BOUNDARY'
  | 'OMNI_HEALTH_DIAGNOSTIC_BOUNDARY'
  | 'OMNI_SETUP_WIZARD_BOUNDARY'
  | 'OMNI_CONTROLLED_DRY_RUN_BOUNDARY'
  | 'OMNI_TEMPLATE_LAYOUT_BOUNDARY'
  | 'OMNI_REFERENCE_SEED_BOUNDARY';

export type BaselineStatus =
  | 'not_baselined'
  | 'existing_baseline'
  | 'stale_baseline';

export interface ArchitectureViolation {
  ruleId: ArchitectureRuleId;
  severity: ArchitectureRuleSeverity;
  filePath: string;
  evidence?: string;
  message: string;
  remediation: string;
  baselineStatus: BaselineStatus;
}

export interface ArchitectureCheckSummary {
  passed: boolean;
  checkedFiles: number;
  violations: ArchitectureViolation[];
  activeBaselineEntries: number;
  staleBaselineEntries: number;
}

export interface ArchitectureBaselineEntry {
  ruleId: ArchitectureRuleId;
  filePath: string;
  evidence: string;
  reason: string;
}

/** Raw scanned file used by every check. `content` is UTF-8 text. */
export interface ScannedFile {
  /** Repo-relative POSIX path (e.g. `src/foo/bar.ts`). */
  filePath: string;
  content: string;
}

/** Snapshot of the repository the checks operate on. */
export interface RepositoryScan {
  /** All source files considered (TS/TSX/JS/JSX/SQL/YAML/JSON/TOML/MD). */
  files: ScannedFile[];
  /** Route-registration source (typically AppRoutes.tsx). */
  routeSource: ScannedFile | null;
  /** Migration `.sql` files under supabase/migrations. */
  migrations: ScannedFile[];
  /** Directory names directly under supabase/functions. */
  edgeFunctionDirs: string[];
  /** Optional dependency map from package.json. */
  dependencies: Record<string, string>;
}
