export interface BnCommContext {
  productVersionId?: string;
  workflowStepId?: string;
  reasonCode?: string;
  reasonDescription?: string;
  appealDeadline?: string;
  userCode?: string;
  currentUserId?: string;
  currentUserEmail?: string;
  currentUserName?: string;
  extra?: Record<string, unknown>;
}