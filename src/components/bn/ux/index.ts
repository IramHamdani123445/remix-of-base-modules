/**
 * Shared Benefits operational UX pattern.
 *
 * MODULE → FIND WORK → OPEN RECORD → UNDERSTAND CURRENT STAGE →
 * SEE NEXT ACTION → COMPLETE ACTION → MOVE FORWARD
 *
 * These components carry no business logic: stage state, action availability
 * and counts are always supplied by authoritative module backends.
 */
export { BnModuleSectionNav } from './BnModuleSectionNav';
export type { BnModuleSectionNavItem } from './BnModuleSectionNav';
export { BnPhaseSectionNav } from './BnPhaseSectionNav';
export type { BnPhase, BnPhaseSection } from './BnPhaseSectionNav';
export { BnWorkflowRail } from './BnWorkflowRail';
export type { BnWorkflowStage, BnWorkflowStageState } from './BnWorkflowRail';
export { BnNextActionCard, BN_ACTION_UNCONFIRMED_MESSAGE } from './BnNextActionCard';
export type { BnNextAction } from './BnNextActionCard';
export { BnRecordWorkspaceHeader } from './BnRecordWorkspaceHeader';
export type { BnRecordFact } from './BnRecordWorkspaceHeader';
export { BnActivityDrawer } from './BnActivityDrawer';
export { BnQueueSummaryCards } from './BnQueueSummaryCards';
export type { BnQueueSummaryItem } from './BnQueueSummaryCards';
export { useBnWorkspaceSection } from './useBnWorkspaceSection';
