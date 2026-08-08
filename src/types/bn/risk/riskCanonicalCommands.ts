/**
 * BN Risk — Canonical command catalogue (Slice 1).
 *
 * The 18 canonical commands specified by the Fraud / Error / Risk epic.
 * Legacy `BN_RISK_*` commands remain in the registry for compatibility;
 * these canonical commands use distinct verb suffixes (e.g. TRIAGE_SIGNAL,
 * PLACE_PAYMENT_HOLD, CLOSE_ASSESSMENT) so both catalogues coexist without
 * collision.
 *
 * Every benefit-affecting action requires maker-checker. Score alone can
 * never terminate or hold a benefit — an APPROVE_CONTROL command is
 * mandatory.
 */
import type { BnGapCapability } from '@/services/bn/commands/benefitsCapabilityRegistry';

export type BnRiskCanonicalCommandName =
  | 'BN_RISK_GENERATE_SIGNAL'
  | 'BN_RISK_REGISTER_MANUAL_SIGNAL'
  | 'BN_RISK_TRIAGE_SIGNAL'
  | 'BN_RISK_LINK_SIGNALS'
  | 'BN_RISK_DISMISS_SIGNAL'
  | 'BN_RISK_CREATE_ASSESSMENT'
  | 'BN_RISK_ADD_FACTOR'
  | 'BN_RISK_REQUEST_EVIDENCE'
  | 'BN_RISK_RECOMMEND_CONTROL'
  | 'BN_RISK_APPROVE_CONTROL'
  | 'BN_RISK_PLACE_PAYMENT_HOLD'
  | 'BN_RISK_REQUEST_ENH_VERIFICATION'
  | 'BN_RISK_REFER_TO_LEGAL'
  | 'BN_RISK_REFER_TO_INVESTIGATION'
  | 'BN_RISK_RECORD_OUTCOME'
  | 'BN_RISK_CLOSE_ASSESSMENT'
  | 'BN_RISK_REOPEN_ASSESSMENT'
  | 'BN_RISK_UPDATE_RULE_FEEDBACK';

export interface BnRiskCanonicalCommandSpec {
  readonly command: BnRiskCanonicalCommandName;
  readonly capability: BnGapCapability;
  readonly requiresMakerChecker: boolean;
  readonly transactional: boolean;
  readonly requiresJustification: boolean;
  readonly implemented: boolean;
  /** Governed SQL boundary that owns the command. Browser code may only reach
   *  the command through the Risk service that calls this RPC. */
  readonly boundaryRpc: string;
  /** Risk service façade module (relative to `src/`) permitted to call it. */
  readonly service: string;
}

export const BN_RISK_CANONICAL_COMMANDS: readonly BnRiskCanonicalCommandSpec[] = [
  { command: 'BN_RISK_GENERATE_SIGNAL',           capability: 'bn_risk_management:write',           requiresMakerChecker: false, transactional: false, requiresJustification: false, implemented: true, boundaryRpc: 'bn_risk_execute_command_v1',           service: 'services/bn/risk/riskCommandService.ts' },
  { command: 'BN_RISK_REGISTER_MANUAL_SIGNAL',    capability: 'bn_risk_management:write',           requiresMakerChecker: false, transactional: false, requiresJustification: true,  implemented: true, boundaryRpc: 'bn_risk_execute_command_v1',           service: 'services/bn/risk/riskCommandService.ts' },
  { command: 'BN_RISK_TRIAGE_SIGNAL',             capability: 'bn_risk_management:write',           requiresMakerChecker: false, transactional: false, requiresJustification: false, implemented: true, boundaryRpc: 'bn_risk_execute_command_v1',           service: 'services/bn/risk/riskCommandService.ts' },
  { command: 'BN_RISK_LINK_SIGNALS',              capability: 'bn_risk_management:write',           requiresMakerChecker: false, transactional: false, requiresJustification: false, implemented: true, boundaryRpc: 'bn_risk_execute_command_v1',           service: 'services/bn/risk/riskCommandService.ts' },
  { command: 'BN_RISK_DISMISS_SIGNAL',            capability: 'bn_risk_management:decide',          requiresMakerChecker: false, transactional: false, requiresJustification: true,  implemented: true, boundaryRpc: 'bn_risk_execute_command_v1',           service: 'services/bn/risk/riskCommandService.ts' },
  { command: 'BN_RISK_CREATE_ASSESSMENT',         capability: 'bn_risk_management:write',           requiresMakerChecker: false, transactional: false, requiresJustification: false, implemented: true, boundaryRpc: 'bn_risk_assessment_command_v1',        service: 'services/bn/risk/riskAssessmentService.ts' },
  { command: 'BN_RISK_ADD_FACTOR',                capability: 'bn_risk_management:write',           requiresMakerChecker: false, transactional: false, requiresJustification: false, implemented: true, boundaryRpc: 'bn_risk_assessment_command_v1',        service: 'services/bn/risk/riskAssessmentService.ts' },
  { command: 'BN_RISK_REQUEST_EVIDENCE',          capability: 'bn_risk_management:write',           requiresMakerChecker: false, transactional: false, requiresJustification: false, implemented: true, boundaryRpc: 'bn_risk_assessment_command_v1',        service: 'services/bn/risk/riskAssessmentService.ts' },
  { command: 'BN_RISK_RECOMMEND_CONTROL',         capability: 'bn_risk_management:write',           requiresMakerChecker: false, transactional: false, requiresJustification: true,  implemented: true, boundaryRpc: 'bn_risk_control_command_v1',           service: 'services/bn/risk/riskControlService.ts' },
  { command: 'BN_RISK_APPROVE_CONTROL',           capability: 'bn_risk_management:approve_control', requiresMakerChecker: true,  transactional: true,  requiresJustification: true,  implemented: true, boundaryRpc: 'bn_risk_control_command_v1',           service: 'services/bn/risk/riskControlService.ts' },
  { command: 'BN_RISK_PLACE_PAYMENT_HOLD',        capability: 'bn_risk_management:approve_control', requiresMakerChecker: true,  transactional: true,  requiresJustification: true,  implemented: true, boundaryRpc: 'bn_risk_control_execution_command_v1', service: 'services/bn/risk/riskControlExecutionService.ts' },
  { command: 'BN_RISK_REQUEST_ENH_VERIFICATION',  capability: 'bn_risk_management:write',           requiresMakerChecker: false, transactional: false, requiresJustification: false, implemented: true, boundaryRpc: 'bn_risk_control_execution_command_v1', service: 'services/bn/risk/riskControlExecutionService.ts' },
  { command: 'BN_RISK_REFER_TO_LEGAL',            capability: 'bn_risk_management:refer',           requiresMakerChecker: true,  transactional: false, requiresJustification: true,  implemented: true, boundaryRpc: 'bn_risk_control_execution_command_v1', service: 'services/bn/risk/riskControlExecutionService.ts' },
  { command: 'BN_RISK_REFER_TO_INVESTIGATION',    capability: 'bn_risk_management:refer',           requiresMakerChecker: true,  transactional: false, requiresJustification: true,  implemented: true, boundaryRpc: 'bn_risk_control_execution_command_v1', service: 'services/bn/risk/riskControlExecutionService.ts' },
  { command: 'BN_RISK_RECORD_OUTCOME',            capability: 'bn_risk_management:decide',          requiresMakerChecker: false, transactional: false, requiresJustification: false, implemented: true, boundaryRpc: 'bn_risk_outcome_command_v1',           service: 'services/bn/risk/riskOutcomeService.ts' },
  { command: 'BN_RISK_CLOSE_ASSESSMENT',          capability: 'bn_risk_management:decide',          requiresMakerChecker: false, transactional: false, requiresJustification: false, implemented: true, boundaryRpc: 'bn_risk_outcome_command_v1',           service: 'services/bn/risk/riskOutcomeService.ts' },
  { command: 'BN_RISK_REOPEN_ASSESSMENT',         capability: 'bn_risk_management:admin',           requiresMakerChecker: false, transactional: false, requiresJustification: true,  implemented: true, boundaryRpc: 'bn_risk_outcome_command_v1',           service: 'services/bn/risk/riskOutcomeService.ts' },
  { command: 'BN_RISK_UPDATE_RULE_FEEDBACK',      capability: 'bn_risk_management:rule_admin',      requiresMakerChecker: false, transactional: false, requiresJustification: false, implemented: true, boundaryRpc: 'bn_risk_rule_feedback_command_v1',     service: 'services/bn/risk/riskFeedbackService.ts' },
] as const;


export function getRiskCanonicalCommandSpec(
  command: BnRiskCanonicalCommandName,
): BnRiskCanonicalCommandSpec {
  const spec = BN_RISK_CANONICAL_COMMANDS.find((c) => c.command === command);
  if (!spec) throw new Error(`Unknown canonical BN_RISK command: ${command}`);
  return spec;
}
