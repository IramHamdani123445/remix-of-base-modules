/**
 * BN Mortality — Domain DTOs (browser-facing).
 *
 * Shape returned by the secure query boundary. Sensitive fields are
 * stripped for non-admin callers.
 */

export interface BnMortalityEventSummaryDto {
  readonly id: string;
  readonly eventReference: string;
  readonly status: string;
  readonly deceasedFullName: string | null;
  readonly deathDate: string | null;
  readonly slaDueAt: string | null;
  readonly assignedTo: string | null;
}

export interface BnMortalityEventListItemDto {
  readonly id: string;
  readonly event_reference: string;
  readonly status: string;
  readonly source: string;
  readonly deceased_full_name: string | null;
  readonly death_date: string | null;
  readonly reported_at: string | null;
  readonly assigned_to: string | null;
  readonly sla_due_at: string | null;
  readonly row_version: number;
  readonly updated_at: string | null;
}

export interface BnMortalityDashboardDto {
  readonly totals: {
    readonly all: number;
    readonly byStatus: Record<string, number>;
    readonly totalOpen: number;
    readonly openNonTerminal: number;
    readonly unassigned: number;
    readonly verificationPending: number;
    readonly provisionallyHeld: number;
    readonly conflicts: number;
    readonly impactReview: number;
    readonly approvalPending: number;
    readonly followOnProcessing: number;
    readonly overdue: number;
    readonly closedThisMonth: number;
  };
  readonly recent: readonly {
    readonly id: string;
    readonly event_reference: string;
    readonly status: string;
    readonly deceased_full_name: string | null;
    readonly death_date: string | null;
    readonly reported_at: string | null;
    readonly assigned_to: string | null;
    readonly sla_due_at: string | null;
  }[];
  readonly generatedAt: string;
}


export interface BnMortalityEventDetailDto {
  readonly id: string;
  readonly eventReference: string;
  readonly status: string;
  readonly source: string;
  readonly deceased: {
    readonly fullName: string | null;
    readonly dateOfBirth: string | null;
    readonly gender: string | null;
    readonly nationalIdMasked: string | null;
  };
  readonly death: {
    readonly date: string | null;
    readonly time: string | null;
    readonly place: string | null;
    readonly cause: string | null;
  };
  readonly matched: {
    readonly ipId: string | number | null;
    readonly confidence: string | null;
    readonly matchedAt: string | null;
  };
  readonly verification: {
    readonly source: string | null;
    readonly reference: string | null;
    readonly confidence: string | null;
    readonly verifiedAt: string | null;
  };
  readonly assignedTo: string | null;
  readonly slaDueAt: string | null;
  readonly rowVersion: number;
  readonly reportedAt: string | null;
  readonly submittedForVerificationAt: string | null;
  readonly confirmedAt: string | null;
  readonly completedAt: string | null;
  readonly closedAt: string | null;
  readonly reversedAt: string | null;
  readonly correlationId: string | null;
  readonly createdAt: string | null;
  readonly updatedAt: string | null;
  readonly sourcePayload?: unknown | null;
  readonly externalReferenceRaw?: string | null;
  readonly diagnostics?: unknown | null;
}

export interface BnMortalityPersonMatchDto {
  readonly ipId: string;
  readonly fullName: string;
  readonly nationalIdMasked: string | null;
  readonly dateOfBirth: string | null;
  readonly gender: string | null;
  readonly confidenceInternals: unknown | null;
}

export interface BnMortalityAwardImpactDto {
  readonly id: string | null;
  readonly eventId?: string;
  readonly awardId: string | null;
  readonly claimId: string | null;
  readonly awardReference: string | null;
  readonly action:
    | 'NONE'
    | 'HOLD'
    | 'TERMINATE'
    | 'PRORATE'
    | 'PAD_RECOVERY'
    | string;
  readonly impactDecision: string | null;
  readonly impactStatus: string | null;
  readonly approvalState: 'PENDING' | 'APPROVED' | string | null;
  readonly currentAwardStatus: string | null;
  readonly originalAwardStatus: string | null;
  readonly originalAwardAmountMinor: number | null;
  readonly paymentFrequency: string | null;
  readonly holdRequired: boolean;
  readonly holdStatus: string | null;
  readonly holdDate: string | null;
  readonly holdServicingReference: string | null;
  readonly releaseServicingReference: string | null;
  readonly terminationRequired: boolean;
  readonly terminationStatus: string | null;
  readonly terminationEffectiveDate: string | null;
  readonly terminationServicingReference: string | null;
  readonly futureScheduleCount: number;
  readonly beneficiaryLink: boolean;
  readonly lastValidPaymentDate: string | null;
  readonly estimatedPadMinor: number;
  readonly currencyCode: string | null;
  readonly integrationStatus: string;
  readonly integrationFailure: {
    readonly code: string;
    readonly summary: string;
  } | null;
  readonly integrationAttemptedAt: string | null;
  readonly appliedAt: string | null;
  readonly overpaymentId: string | null;
  readonly overpaymentReference: string | null;
  readonly award360Route: string | null;

}

export interface MortalityHistoryEntry {
  readonly id: string;
  readonly eventId: string;
  readonly commandName: string;
  readonly fromStatus: string | null;
  readonly toStatus: string | null;
  readonly actorUserId: string | null;
  readonly actorUserCode: string | null;
  readonly occurredAt: string;
  readonly correlationId: string | null;
  readonly reasonCode: string | null;
  readonly justification: string | null;
}

export interface MortalityEvidenceLink {
  readonly id: string;
  readonly documentType: string | null;
  readonly title: string | null;
  readonly fileReference: string | null;
  readonly generatedAt: string | null;
  readonly generatedBy: string | null;
  readonly status: string | null;
}

export interface MortalityCommunicationEntry {
  readonly id: string;
  readonly eventCode: string | null;
  readonly moduleCode: string | null;
  readonly status: string | null;
  readonly recipientSummary: string | null;
  readonly sentAt: string | null;
  readonly createdAt: string | null;
}

export interface MortalityReferralEntry {
  readonly id: string;
  readonly eventId: string;
  readonly referralType: string;
  readonly targetModule: string | null;
  readonly targetRefType: string | null;
  readonly targetRefId: string | null;
  readonly targetReference: string | null;
  readonly status: string;
  readonly raisedAt: string | null;
  readonly raisedBy: string | null;
  readonly correlationId: string | null;
  readonly acceptedAt: string | null;
  readonly completedAt: string | null;
  readonly failureReason: string | null;
}

export interface MortalityRegistrationImpactPreviewDto {
  readonly matchedIpId: string | null;
  readonly deathDate: string;
  readonly source: string | null;
  readonly externalReference: string | null;
  readonly awards: ReadonlyArray<{
    readonly id: string;
    readonly awardId: string;
    readonly awardReference: string | null;
    readonly currentAwardStatus: string | null;
    readonly awardAmount: number | null;
    readonly frequency: string | null;
    readonly startDate: string | null;
    readonly endDate: string | null;
    readonly likelyAction: 'NONE' | 'HOLD' | 'TERMINATE' | 'PAD_RECOVERY' | 'PRORATE';
    readonly flags: readonly string[];
  }>;
  readonly warnings: ReadonlyArray<{
    readonly code: string;
    readonly message: string;
    readonly severity: 'INFO' | 'WARN' | 'CRIT';
  }>;
  readonly duplicates: ReadonlyArray<{
    readonly id: string;
    readonly eventReference: string;
    readonly status: string;
    readonly deathDate: string | null;
  }>;
  readonly generatedAt: string;
}

/** BN-MORT-M3 — Canonical evidence register entry (`bn_mortality_evidence`). */
export interface MortalityEvidenceRegisterEntry {
  readonly id: string;
  readonly eventId: string;
  readonly evidenceType: string;
  readonly dmsDocumentId: string | null;
  readonly dmsReference: string | null;
  readonly receivedAt: string | null;
  readonly status: 'REQUESTED' | 'ATTACHED' | 'RECEIVED' | 'REJECTED' | string;
  readonly notes: string | null;
  readonly correlationId: string | null;
  readonly createdAt: string;
  readonly createdBy: string | null;
}

/** BN-MORT-M3 — Required follow-on action gating closure. */
export interface MortalityRequiredActionEntry {
  readonly id: string;
  readonly eventId: string;
  readonly actionCode: string;
  readonly isMandatory: boolean;
  readonly status: 'OPEN' | 'SATISFIED' | 'WAIVED' | 'CANCELLED' | string;
  readonly handoffId: string | null;
  readonly resolvedAt: string | null;
  readonly resolvedBy: string | null;
  readonly createdAt: string;
  readonly blocksClosure: boolean;
}

/** BN-MORT-M5 — Governed cross-module handoff raised from a mortality event. */
export interface MortalityHandoffEntry {
  readonly handoffId: string;
  readonly sourceModule: string;
  readonly sourceRecordId: string;
  readonly targetModule: string;
  readonly handoffType: string;
  readonly reasonCode: string | null;
  readonly status: string;
  readonly awardId: string | null;
  readonly claimId: string | null;
  readonly targetRecordId: string | null;
  readonly targetReference: string | null;
  readonly correlationId: string | null;
  readonly createdAt: string;
  readonly createdBy: string | null;
  readonly acceptedAt: string | null;
  readonly acceptedBy: string | null;
  readonly updatedAt: string;
  readonly rowVersion: number;
  readonly isOutstanding: boolean;
}

/** BN-MORT-M3 — Per-event operational indicators for the worklist. */
export interface MortalityWorklistIndicator {
  readonly eventId: string;
  readonly openMandatoryActions: number;
  readonly outstandingHandoffs: number;
  readonly failedHandoffs: number;
  readonly evidenceCount: number;
  readonly impactCount: number;
  readonly awaitingApprovalImpacts: number;
  readonly activeHolds: number;
  readonly padExposureMinor: number;
  readonly currencyCode: string | null;
}

/** BN-MORT-M4 — Mortality posture for a single award, rendered in Award 360. */
export interface MortalityAwardSnapshotDto {
  readonly awardId: string;
  readonly hasMortalityEvent: boolean;
  readonly event: {
    readonly id: string;
    readonly eventReference: string | null;
    readonly status: string;
    readonly deathDate: string | null;
    readonly deceasedFullName: string | null;
    readonly reportedAt: string | null;
    readonly confirmedAt: string | null;
    readonly route: string;
  } | null;
  readonly impact: {
    readonly id: string;
    readonly action: string | null;
    readonly impactStatus: string | null;
    readonly approvalState: string | null;
    readonly holdStatus: string | null;
    readonly terminationStatus: string | null;
    readonly estimatedPadMinor: number;
    readonly currencyCode: string;
    readonly overpaymentReference: string | null;
    readonly lastValidPaymentDate: string | null;
    readonly updatedAt: string | null;
  } | null;
}
