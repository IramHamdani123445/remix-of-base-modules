// ============================================
// INSPECTION VISIT & EVIDENCE TYPES
// ============================================

export enum InspectionVisitStatus {
  PLANNED = 'PLANNED',
  NOT_STARTED = 'NOT_STARTED',
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
  RESCHEDULED = 'RESCHEDULED',
  NOT_DONE = 'NOT_DONE',
  ABORTED = 'ABORTED'
}

export enum ItemType {
  EMPLOYER_VISIT = 'EMPLOYER_VISIT',
  SCOUTING = 'SCOUTING'
}

export enum EvidenceType {
  PHOTO = 'PHOTO',
  DOCUMENT = 'DOCUMENT',
  AUDIO = 'AUDIO',
  VIDEO = 'VIDEO',
  OTHER = 'OTHER'
}

export enum FindingType {
  COMPLIANT = 'COMPLIANT',
  MINOR_ISSUE = 'MINOR_ISSUE',
  MAJOR_ISSUE = 'MAJOR_ISSUE',
  POSSIBLE_VIOLATION = 'POSSIBLE_VIOLATION',
  INFORMATION_ONLY = 'INFORMATION_ONLY'
}

export interface WeeklyPlanItem {
  id: string;
  inspectorUserId: string;
  inspectorName: string;
  itemType: ItemType;
  employerId?: string;
  employerName?: string;
  territory: 'St Kitts' | 'Nevis';
  plannedDate: string;
  visitDate?: string; // Backward compatibility
  plannedStartTime?: string;
  plannedEndTime?: string;
  duration?: string; // Backward compatibility
  purpose?: string; // Backward compatibility
  // For SCOUTING
  areaName?: string;
  focusNotes?: string;
  // Status
  status: InspectionVisitStatus;
  rescheduleReason?: string;
  rescheduledTo?: string;
  notDoneReason?: string;
  createdAt: string;
  updatedAt: string;
}

export interface InspectionVisit {
  id: string;
  weeklyPlanItemId: string;
  employerId?: string;
  employerName?: string;
  inspectorUserId: string;
  inspectorName: string;
  territory: 'St Kitts' | 'Nevis';
  visitDate?: string; // Backward compatibility
  checkInTime?: string;
  checkInLocation?: string;
  checkInGPSLat?: number; // Backward compatibility
  checkInGPSLng?: number; // Backward compatibility
  checkOutTime?: string;
  checkOutLocation?: string;
  checkOutGPSLat?: number; // Backward compatibility
  checkOutGPSLng?: number; // Backward compatibility
  visitStatus: InspectionVisitStatus;
  visitNotes?: string; // Backward compatibility
  notes?: string;
  inspectorId?: string; // Backward compatibility
  status?: InspectionVisitStatus; // Backward compatibility
  createdAt: string;
  updatedAt: string;
}

export interface InspectionEvidence {
  id: string;
  inspectionVisitId: string;
  employerId: string; // Denormalized for reporting
  visitId?: string; // Backward compatibility
  documentId?: string;
  evidenceType: EvidenceType;
  type?: EvidenceType; // Backward compatibility
  fileName: string;
  fileUrl: string;
  fileSize: number;
  description?: string;
  capturedAt: string;
  capturedByUserId: string;
  capturedByName?: string;
  capturedBy?: string; // Backward compatibility
  gpsLat?: number;
  gpsLng?: number;
}

export interface InspectionFinding {
  id: string;
  inspectionVisitId: string;
  employerId: string;
  visitId?: string; // Backward compatibility
  findingType: FindingType;
  category?: string; // Backward compatibility
  title: string;
  description: string;
  severity: 'Low' | 'Medium' | 'High' | 'Critical';
  recommendedAction?: string;
  inspectorNotes?: string; // Backward compatibility
  evidenceIds?: string[];
  isViolationCreated: boolean;
  violationId?: string;
  /** Classification of the finding (see findingDispositionService). */
  disposition?: 'PENDING_REVIEW' | 'INFORMATIONAL' | 'FLAG_FOR_REVIEW' | 'VIOLATION_CANDIDATE' | 'CONVERTED';
  reviewNotes?: string;
  reviewedBy?: string;
  createdAt: string;
  createdByUserId: string;
  createdByName?: string;
  createdBy?: string; // Backward compatibility
}

export interface WeeklyReportSummary {
  weekStartDate: string;
  weekEndDate: string;
  inspectorId: string;
  inspectorName: string;
  totalPlannedVisits: number;
  completedVisits: number;
  rescheduledVisits: number;
  notDoneVisits: number;
  totalEvidence: number;
  totalFindings: number;
  totalViolations: number;
  submittedAt?: string;
  status: 'DRAFT' | 'SUBMITTED' | 'APPROVED';
}

export interface CreateWeeklyPlanItemRequest {
  itemType: ItemType;
  employerId?: string;
  territory: 'St Kitts' | 'Nevis';
  plannedDate: string;
  plannedStartTime?: string;
  plannedEndTime?: string;
  areaName?: string;
  focusNotes?: string;
}

export interface CheckInRequest {
  location?: string;
}

export interface CheckOutRequest {
  location?: string;
  notes?: string;
}

export interface CreateEvidenceRequest {
  evidenceType: EvidenceType;
  file: File;
  description?: string;
}

export interface CreateFindingRequest {
  findingType: FindingType;
  title: string;
  description: string;
  severity: 'Low' | 'Medium' | 'High' | 'Critical';
  recommendedAction?: string;
}
