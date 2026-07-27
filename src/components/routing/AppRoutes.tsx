import { Routes, Route, Navigate, useParams } from 'react-router-dom';

const LegalAdvancedMatterRedirect = () => {
  const { id } = useParams();
  return <Navigate to={`/legal/lg/cases/${id ?? ''}`} replace />;
};

// Legacy /legal/cases/:id (SSBCaseView, mock-context) — redirect to canonical
// LgCaseDetail on the real lg_case tables.
const LegacyLegalCaseRedirect = () => {
  const { id } = useParams();
  return <Navigate to={`/legal/lg/cases/${id ?? ''}`} replace />;
};

const Employer360LegacyRedirect = () => {
  const { employerId } = useParams();
  return <Navigate to={`/compliance/field/employer-360/${employerId ?? ''}`} replace />;
};
import { BnFeatureGate } from '@/lib/bn/featureToggles';
import { BnModuleRouteGate } from '@/components/bn/access/BnModuleRouteGate';

import { PermissionWrapper } from '@/components/ui/permission-wrapper';
import { LoginScreen } from '@/components/auth/LoginScreen';
import { InspectorLayout } from '@/components/inspector/InspectorLayout';
import { ProtectedLayout } from '@/components/layout/ProtectedLayout';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';
import { CommHubAdminRoute } from '@/components/auth/CommHubAdminRoute';
import { useLegalAuth } from '@/contexts/LegalAuthContext';
import React, { Suspense, lazy } from 'react';
import { AuditFeatureGate } from '@/components/audit/AuditFeatureGate';
import { ComplianceFeatureGate } from '@/components/compliance/ComplianceFeatureGate';
import LegalRouteGuard from '@/components/legal/LegalRouteGuard';
// ComplianceRouteGuard retired — global ComplianceAccessGate (in ProtectedLayout) handles permission gating for /compliance/*; ComplianceFeatureGate handles feature-flag gating.
import { useComplianceFeatureFlagsBootstrap } from '@/hooks/compliance/useComplianceFeatureFlags';
const FeatureToggleDiagnosticsPage = lazy(() => import('@/pages/compliance/admin/FeatureToggleDiagnosticsPage'));
const ClaimantPortal = lazy(() => import('@/portals/claimant/ClaimantPortal'));
const EmployerPortal = lazy(() => import('@/portals/employer/EmployerPortal'));
const DoctorPortal = lazy(() => import('@/portals/doctor/DoctorPortal'));
const PortalHub = lazy(() => import('@/portals/PortalHub'));
const ExternalTaskLanding = lazy(() => import('@/portals/ExternalTaskLanding'));

// Public website
const PublicLayout = lazy(() => import('@/pages/public/PublicLayout'));
const PublicHome = lazy(() => import('@/pages/public/Home'));
const UatDownloadsPublic = lazy(() => import('@/pages/public/UatDownloadsPublic'));
const RegisterWizard = lazy(() => import('@/pages/public/register/RegisterWizard'));
const ExternalPortalApprovals = lazy(() => import('@/pages/admin/ExternalPortalApprovals'));
const PublicCatalogValidation = lazy(() => import('@/pages/admin/PublicCatalogValidation'));
// NumberingRulesAdmin now rendered inside NumberingAdmin (Rules tab).
const NumberingAdmin = lazy(() => import('@/pages/admin/NumberingAdmin'));
const AuditLogAdmin = lazy(() => import('@/pages/admin/AuditLogAdmin'));
const DepartmentsAdmin = lazy(() => import('@/pages/admin/DepartmentsAdmin'));
import {
  PublicServices, PublicBenefits, PublicContributions, PublicEmployers,
  PublicMedicalProviders, PublicContact, PublicHelp, PublicLogin,
} from '@/pages/public/ContentPages';

const InspectorLogin = lazy(() => import('@/pages/inspector/InspectorLogin').then((m) => ({ default: m.InspectorLogin })));
const InspectorDashboard = lazy(() => import('@/pages/inspector/InspectorDashboard').then((m) => ({ default: m.InspectorDashboard })));
const InspectorWeeklyPlan = lazy(() => import('@/pages/inspector/InspectorWeeklyPlan').then((m) => ({ default: m.InspectorWeeklyPlan })));
const InspectorActivities = lazy(() => import('@/pages/inspector/InspectorActivities').then((m) => ({ default: m.InspectorActivities })));
const InspectorViolations = lazy(() => import('@/pages/inspector/InspectorViolations').then((m) => ({ default: m.InspectorViolations })));
const InspectorReports = lazy(() => import('@/pages/inspector/InspectorReports').then((m) => ({ default: m.InspectorReports })));
const RecordViolationForm = lazy(() => import('@/pages/inspector/RecordViolationForm').then((m) => ({ default: m.RecordViolationForm })));

// DB Diagram
const DbDiagramPage = lazy(() => import('@/pages/db-diagram/DbDiagramPage'));

// Embedded satellite micro-frontends (iframe + postMessage bridge)
const SatelliteFrame = lazy(() => import('@/components/integrations/SatelliteFrame'));
import { isAuditRemoteEnabled, isComplianceRemoteEnabled } from '@/lib/embed/satelliteRouting';

// Page imports
const Index = lazy(() => import('@/pages/dashboard/Index'));
const NotFound = lazy(() => import('@/pages/NotFound'));
const Unauthorized = lazy(() => import('@/pages/Unauthorized'));
const ViewInsuredPerson = lazy(() => import('@/pages/insuredPersons/ViewInsuredPerson'));
const EditInsuredPerson = lazy(() => import('@/pages/insuredPersons/EditInsuredPerson'));

// CRD Module
const CardManagement = lazy(() => import('@/pages/crd/CardManagement'));
const CRDPrintedSpoiledCardsReport = lazy(() => import('@/pages/crd/reports/PrintedSpoiledCardsReport'));

// Compliance Module
const ViolationsManagement = lazy(() => import('@/pages/compliance/violations/ViolationsManagement'));
const ViolationDetails = lazy(() => import('@/pages/compliance/violations/ViolationDetails'));
const ComingSoonStub = lazy(() => import('@/pages/compliance/ComingSoon'));

const InspectorPlans = lazy(() => import('@/pages/compliance/audit-planning/InspectorPlans'));
const PaymentArrangements = lazy(() => import('@/pages/compliance/arrangements/PaymentArrangements'));
const NewArrangementPage = lazy(() => import('@/pages/compliance/arrangements/NewArrangementPage'));
const ArrangementPendingApprovalPage = lazy(() => import('@/pages/compliance/arrangements/ArrangementPendingApprovalPage'));
const ActiveArrangementsPage = lazy(() => import('@/pages/compliance/arrangements/ActiveArrangementsPage'));
const InstallmentsDuePage = lazy(() => import('@/pages/compliance/arrangements/InstallmentsDuePage'));
const PaymentAllocationPage = lazy(() => import('@/pages/compliance/arrangements/PaymentAllocationPage'));
const FieldOperations = lazy(() => import('@/pages/compliance/inspections/FieldOperations'));
const NoticesManagement = lazy(() => import('@/pages/compliance/legal/NoticesManagement'));
const EmployerStatements = lazy(() => import('@/pages/compliance/employers/EmployerStatements'));
const ComplianceSettings = lazy(() => import('@/pages/compliance/settings/ComplianceSettings'));
const ComplianceScheduleSettings = lazy(() => import('@/pages/compliance/admin/ScheduleSettings'));

const CompletionGateSettings = lazy(() => import('@/pages/compliance/settings/CompletionGateSettings'));
const ComplianceDashboard = lazy(() => import('@/pages/compliance/dashboards/ComplianceDashboard'));
const ComplianceReports = lazy(() => import('@/pages/compliance/reports/ComplianceReports'));
const CaseAnalytics = lazy(() => import('@/pages/compliance/reports/CaseAnalytics'));
const InspectorPerformance = lazy(() => import('@/pages/compliance/reports/InspectorPerformance'));
const C3Compliance = lazy(() => import('@/pages/compliance/reports/C3Compliance'));
const ArrearsReports = lazy(() => import('@/pages/compliance/reports/ArrearsReports'));
const ComplianceAuditReports = lazy(() => import('@/pages/compliance/reports/AuditReports'));
const ArrangementReports = lazy(() => import('@/pages/compliance/reports/ArrangementReports'));
const LegalEscalationReports = lazy(() => import('@/pages/compliance/reports/LegalEscalationReports'));
const ViolationsByStatusReport = lazy(() => import('@/pages/compliance/reports/violations/ViolationsByStatus'));
const ViolationsByTypeReport = lazy(() => import('@/pages/compliance/reports/violations/ViolationsByType'));
const ViolationResolutionTimeReport = lazy(() => import('@/pages/compliance/reports/violations/ViolationResolutionTime'));
const ViolationsByZoneReport = lazy(() => import('@/pages/compliance/reports/violations/ViolationsByZone'));
const VariantReport = lazy(() => import('@/pages/compliance/reports/shared/VariantReport'));
const RiskSamplingSettings = lazy(() => import('@/pages/compliance/sampling/RiskSamplingSettings'));
const SamplingDashboard = lazy(() => import('@/pages/compliance/sampling/SamplingDashboard'));
const MonthlyAuditCandidates = lazy(() => import('@/pages/compliance/sampling/MonthlyAuditCandidates'));
const MyUpcomingAudits = lazy(() => import('@/pages/compliance/sampling/MyUpcomingAudits'));
const EmployerRiskProfile = lazy(() => import('@/pages/compliance/sampling/EmployerRiskProfile'));
const LegalEscalationPolicy = lazy(() => import('@/pages/compliance/settings/LegalEscalationPolicy'));
const LegalRecommendationQueue = lazy(() => import('@/pages/compliance/legal/LegalRecommendationQueue'));
const LegalReferralWizard = lazy(() => import('@/pages/compliance/legal/LegalReferralWizard'));
const ComplianceLegalReferralWizard = lazy(() => import('@/pages/compliance/legal/ComplianceLegalReferralWizard'));
const BenefitsLegalReferralWizard = lazy(() => import('@/pages/bn/legal/BenefitsLegalReferralWizard'));
const ComplianceLegalReferralLauncher = lazy(() => import('@/pages/compliance/legal/ComplianceLegalReferralLauncher'));
const BenefitsLegalReferralLauncher = lazy(() => import('@/pages/bn/legal/BenefitsLegalReferralLauncher'));
const BenefitsLegalReferrals = lazy(() => import('@/pages/bn/legal/BenefitsLegalReferrals'));
const ComplianceLegalReferrals = lazy(() => import('@/pages/compliance/legal/ComplianceLegalReferrals'));
const LegalReferralsWorkbench = lazy(() => import('@/pages/legal/LegalReferralsWorkbench'));
const RiskRulePolicy = lazy(() => import('@/pages/compliance/settings/RiskRulePolicy'));

// New Compliance & Enforcement pages
const WorkbenchLanding = lazy(() => import('@/pages/compliance/workbench/WorkbenchLanding'));
const ComplianceMyWorkQueue = lazy(() => import('@/pages/compliance/MyWorkQueue'));
const ComplianceManagerDashboard = lazy(() => import('@/pages/compliance/dashboards/ManagerDashboard'));
const ComplianceInspectorDashboard = lazy(() => import('@/pages/compliance/dashboards/InspectorDashboard'));
const ComplianceLegalDashboard = lazy(() => import('@/pages/compliance/dashboards/LegalDashboard'));
const ComplianceCaseManagement = lazy(() => import('@/pages/compliance/cases/CaseManagement'));
const ComplianceCaseQueue = lazy(() => import('@/pages/compliance/cases/CaseQueue'));
const ComplianceCaseDetailView = lazy(() => import('@/pages/compliance/cases/CaseDetailView'));

const ComplianceInspectionManagement = lazy(() => import('@/pages/compliance/inspections/InspectionManagement'));
const ComplianceBreachMonitoring = lazy(() => import('@/pages/compliance/arrangements/BreachMonitoring'));
const ComplianceLegalQueue = lazy(() => import('@/pages/compliance/legal/LegalQueue'));
const ComplianceLegalProceedings = lazy(() => import('@/pages/compliance/legal/LegalProceedingsPage'));
const ComplianceWaivers = lazy(() => import('@/pages/compliance/legal/WaiversOverrides'));
const ComplianceJobConfiguration = lazy(() => import('@/pages/compliance/automation/JobConfiguration'));
const ComplianceJobHistory = lazy(() => import('@/pages/compliance/automation/JobHistory'));
const ComplianceRuleEngine = lazy(() => import('@/pages/compliance/settings/RuleEngine'));
const ComplianceViolationTypes = lazy(() => import('@/pages/compliance/settings/ViolationTypes'));
const ComplianceNumberTemplates = lazy(() => import('@/pages/compliance/settings/NumberTemplates'));
const ComplianceRiskScoringConfig = lazy(() => import('@/pages/compliance/settings/RiskScoringConfig'));
const ComplianceTemplates = lazy(() => import('@/pages/compliance/settings/ComplianceTemplates'));
const AuditCommunicationTemplatesPage = lazy(() => import('@/pages/compliance/admin/AuditCommunicationTemplatesPage'));
const AuditCommunicationTemplateEditorPage = lazy(() => import('@/pages/compliance/admin/AuditCommunicationTemplateEditorPage'));
const OnlineResponseConfigPage = lazy(() => import('@/pages/compliance/admin/OnlineResponseConfigPage'));
const PlaceholderPage = lazy(() => import('@/pages/compliance/PlaceholderPage'));
const ComplianceFeatureTogglesPage = lazy(() => import('@/pages/compliance/admin/FeatureTogglesPage'));
const ComplianceNoticeRegister = lazy(() => import('@/pages/compliance/notices/NoticeRegister'));
const ComplianceGenerateNotice = lazy(() => import('@/pages/compliance/notices/GenerateNoticePage'));
const ComplianceNoticesPendingApproval = lazy(() => import('@/pages/compliance/notices/PendingApprovalPage'));
const ComplianceNoticeDeliveryTracking = lazy(() => import('@/pages/compliance/notices/DeliveryTrackingPage'));
const ComplianceEmployerResponses = lazy(() => import('@/pages/compliance/notices/EmployerResponsesPage'));
const ComplianceCommunicationHistory = lazy(() => import('@/pages/compliance/notices/CommunicationHistoryPage'));
const ComplianceSetupWizard = lazy(() => import('@/pages/compliance/admin/SetupWizard'));
const ComplianceCaseFamiliesPage = lazy(() => import('@/pages/compliance/admin/CaseFamiliesPage'));
const ComplianceWorkflowMappingPage = lazy(() => import('@/pages/compliance/admin/WorkflowMappingPage'));
const ComplianceWaiverRulesPage = lazy(() => import('@/pages/compliance/admin/WaiverRulesPage'));
const ComplianceLegalHandoffRulesPage = lazy(() => import('@/pages/compliance/admin/LegalHandoffRulesPage'));
const ComplianceHelpAdmin = lazy(() => import('@/pages/compliance/admin/ComplianceHelpAdmin'));
const CompliancePaymentArrangementRulesPage = lazy(() => import('@/pages/compliance/admin/PaymentArrangementRulesPage'));
const ComplianceRiskOperations = lazy(() => import('@/pages/compliance/admin/RiskOperations'));
const WeeklyPlanBuilder = lazy(() => import('@/pages/compliance/audit-planning/WeeklyPlanBuilder'));
const WeeklyPlanBuilderV2 = lazy(() => import('@/pages/compliance/audit-planning/WeeklyPlanBuilderV2'));
const WeeklyPlanBuilderV3 = lazy(() => import('@/pages/compliance/audit-planning/WeeklyPlanBuilderV3'));
const PlannerApprovalInbox = lazy(() => import('@/pages/compliance/audit-planning/PlannerApprovalInbox'));
const PlannerApprovalDecidePage = lazy(() => import('@/pages/compliance/audit-planning/PlannerApprovalDecidePage'));
const RevisionsPending = lazy(() => import('@/pages/compliance/audit-planning/RevisionsPending'));
const PlanRevisionReview = lazy(() => import('@/pages/compliance/audit-planning/PlanRevisionReview'));
const MyPlans = lazy(() => import('@/pages/compliance/audit-planning/MyPlans'));
const AllWeeklyReports = lazy(() => import('@/pages/compliance/audit-planning/AllWeeklyReports'));
const FieldExecution = lazy(() => import('@/pages/compliance/audit-planning/FieldExecution'));
const WeeklyReports = lazy(() => import('@/pages/compliance/audit-planning/WeeklyReports'));
const CompliancePendingReview = lazy(() => import('@/pages/compliance/audit-planning/PendingReview'));
const WeeklyPlanReview = lazy(() => import('@/pages/compliance/audit-planning/WeeklyPlanReview').then((m) => ({ default: m.WeeklyPlanReview })));
const PlanExecutionDashboard = lazy(() => import('@/pages/compliance/audit-planning/PlanExecutionDashboard'));
const AuditVisitWorkspace = lazy(() => import('@/pages/compliance/audit-planning/AuditVisitWorkspace'));
const EmployerAuditReportViewer = lazy(() => import('@/pages/compliance/audit-planning/EmployerAuditReportViewer'));
const AuditReportPrintPage = lazy(() => import('@/pages/compliance/audit-planning/AuditReportPrintPage'));
const AuditReportAcknowledgePage = lazy(() => import('@/pages/public/AuditReportAcknowledgePage'));
const WeeklyReportReview = lazy(() => import('@/pages/compliance/audit-planning/WeeklyReportReview'));
const WeeklyReportSubmission = lazy(() => import('@/pages/compliance/violations/WeeklyReportSubmission'));
const ManualViolationEntry = lazy(() => import('@/pages/compliance/violations/ManualViolationEntry'));
const EmployerFindings = lazy(() => import('@/pages/compliance/employers/EmployerFindings'));
const EmployerVisitWorkspace = lazy(() => import('@/pages/compliance/employers/EmployerVisitWorkspace'));
const EmployerStatementDetail = lazy(() => import('@/pages/compliance/employers/EmployerStatementDetail'));
const Employer360 = lazy(() => import('@/pages/compliance/employers/Employer360'));
const Employer360Search = lazy(() => import('@/pages/compliance/employers/Employer360Search'));
const ComplianceRuleSimulator = lazy(() => import('@/pages/compliance/tools/RuleSimulator'));
const ComplianceRiskSimulator = lazy(() => import('@/pages/compliance/tools/RiskSimulator'));

// Compliance Operations, Geography, Staff
const AssignmentQueues = lazy(() => import('@/pages/compliance/operations/AssignmentQueues'));
const ReviewQueue = lazy(() => import('@/pages/compliance/operations/ReviewQueue'));
const Reassignment = lazy(() => import('@/pages/compliance/operations/Reassignment'));
const ZoneManagement = lazy(() => import('@/pages/compliance/geography/ZoneManagement'));
const OfficeZoneMapping = lazy(() => import('@/pages/compliance/geography/OfficeZoneMapping'));
const VillageZoneMapping = lazy(() => import('@/pages/compliance/geography/VillageZoneMapping'));
const OfficerManagement = lazy(() => import('@/pages/compliance/staff/OfficerManagement'));
const QueueMembers = lazy(() => import('@/pages/compliance/staff/QueueMembers'));
const SupervisorHierarchy = lazy(() => import('@/pages/compliance/staff/SupervisorHierarchy'));
const LegacyInspectorLinking = lazy(() => import('@/pages/compliance/staff/LegacyInspectorLinking'));
const AssignmentRoutingRules = lazy(() => import('@/pages/compliance/settings/AssignmentRoutingRules'));

const LevySchemesList = lazy(() => import('@/pages/c3/settings/levy/LevySchemesList'));
const LevySchemeDetail = lazy(() => import('@/pages/c3/settings/levy/LevySchemeDetail'));
const LevySimulator = lazy(() => import('@/pages/c3/settings/levy/LevySimulator'));
const SSSchemesList = lazy(() => import('@/pages/c3/settings/ss/SSSchemesList'));
const SSSchemeDetail = lazy(() => import('@/pages/c3/settings/ss/SSSchemeDetail'));
const SSSimulator = lazy(() => import('@/pages/c3/settings/ss/SSSimulator'));
const SeveranceSchemesList = lazy(() => import('@/pages/c3/settings/severance/SeveranceSchemesList'));
const SeveranceSchemeDetail = lazy(() => import('@/pages/c3/settings/severance/SeveranceSchemeDetail'));
const SeveranceSimulator = lazy(() => import('@/pages/c3/settings/severance/SeveranceSimulator'));
const InjurySchemesList = lazy(() => import('@/pages/c3/settings/injury/InjurySchemesList'));
const InjurySchemeDetail = lazy(() => import('@/pages/c3/settings/injury/InjurySchemeDetail'));
const InjurySimulator = lazy(() => import('@/pages/c3/settings/injury/InjurySimulator'));
const C3FormatsList = lazy(() => import('@/pages/c3/settings/c3file/C3FormatsList'));
const C3FormatDetail = lazy(() => import('@/pages/c3/settings/c3file/C3FormatDetail'));

// CyberSource & Reconciliation
const CyberSourceSettings = lazy(() => import('@/pages/c3Management/CyberSourceSettings'));
const ReconciliationPage = lazy(() => import('@/pages/c3Management/ReconciliationPage'));
const SettingsConfiguration = lazy(() => import('@/pages/c3Management/SettingsConfiguration'));
const EmailTemplates = lazy(() => import('@/pages/c3Management/EmailTemplates'));

// C3 Details Screens
const C3ContributionList = lazy(() => import('@/pages/c3Management/c3Details/C3ContributionList'));
const NwDirectorList = lazy(() => import('@/pages/c3Management/c3Details/NwDirectorList'));
const SelfEmployedContributionList = lazy(() => import('@/pages/c3Management/c3Details/SelfEmployedContributionList'));
const OfflinePaymentPage = lazy(() => import('@/pages/c3Management/c3Details/OfflinePaymentPage'));

const EmployerRegistration = lazy(() => import('@/pages/employersManagement/EmployerRegistration'));
const EmployerApproval = lazy(() => import('@/pages/employersManagement/EmployerApproval'));
const EmployerDirectory = lazy(() => import('@/pages/employersManagement/EmployerDirectory'));
const EmployerLedger = lazy(() => import('@/pages/employer/EmployerLedger'));
const LedgerRecalcWizard = lazy(() => import('@/pages/employer/LedgerRecalcWizard'));
const PaymentAllocationRules = lazy(() => import('@/pages/admin/PaymentAllocationRules'));
const ContributionEntry = lazy(() => import('@/pages/employersManagement/ContributionEntry'));
const ComplianceMonitoring = lazy(() => import('@/pages/compliance/dashboards/ComplianceMonitoring'));
const ContributionTracking = lazy(() => import('@/pages/employersManagement/ContributionTracking'));

// Insured Persons - New consolidated page
const IPManagement = lazy(() => import('@/pages/insuredPersons/IPManagement'));
const PersonIPManagement = lazy(() => import('@/pages/insuredPersons/PersonIPManagement'));

// Quick Actions Pages
const WagesHistory = lazy(() => import('@/pages/insuredPersons/WagesHistory'));
const ClaimHistory = lazy(() => import('@/pages/insuredPersons/ClaimHistory'));
const BenefitEligibility = lazy(() => import('@/pages/insuredPersons/BenefitEligibility'));
const PendingReviews = lazy(() => import('@/pages/insuredPersons/PendingReviews'));

// Service Request Pages
const ServiceRequestNew = lazy(() => import('@/pages/person/ServiceRequestNew'));
const ServiceRequestList = lazy(() => import('@/pages/person/ServiceRequestList'));
const ServiceRequestDetail = lazy(() => import('@/pages/person/ServiceRequestDetail'));
const PendingVerification = lazy(() => import('@/pages/person/PendingVerification'));
const InsuredPersonProfile = lazy(() => import('@/pages/person/InsuredPersonProfile'));

// Insured Persons Reports
const IPEntryVerificationReport = lazy(() => import('@/pages/person/reports/IPEntryVerificationReport'));
const Age62WithoutClaimReport = lazy(() => import('@/pages/person/reports/Age62WithoutClaimReport'));
const OnlineRenewalUpdateReport = lazy(() => import('@/pages/person/reports/OnlineRenewalUpdateReport'));
const RegistrationPaymentsReport = lazy(() => import('@/pages/person/reports/RegistrationPaymentsReport'));
const ContributionStatementPaymentReport = lazy(() => import('@/pages/person/reports/ContributionStatementPaymentReport'));
const PensionLettersPaymentReport = lazy(() => import('@/pages/person/reports/PensionLettersPaymentReport'));
const NonNationalWorkersSSNReport = lazy(() => import('@/pages/person/reports/NonNationalWorkersSSNReport'));
const NewRegistrantsByOfficerReport = lazy(() => import('@/pages/person/reports/NewRegistrantsByOfficerReport'));
const EmployerRegistrationByOfficerReport = lazy(() => import('@/pages/person/reports/EmployerRegistrationByOfficerReport'));
const LifeCertificatesReport = lazy(() => import('@/pages/person/reports/LifeCertificatesReport'));
const SelfEmployedByOfficerReport = lazy(() => import('@/pages/person/reports/SelfEmployedByOfficerReport'));
const ClaimsEnteredByOfficerReport = lazy(() => import('@/pages/person/reports/ClaimsEnteredByOfficerReport'));
const SelfEmployedWithoutLicenseReport = lazy(() => import('@/pages/person/reports/SelfEmployedWithoutLicenseReport'));
const ClaimsToBenefitsReport = lazy(() => import('@/pages/person/reports/ClaimsToBenefitsReport'));
const CRMActivityReport = lazy(() => import('@/pages/person/reports/CRMActivityReport'));
const C3EntryVerificationReport = lazy(() => import('@/pages/person/reports/C3EntryVerificationReport'));
const PendingC3Report = lazy(() => import('@/pages/person/reports/PendingC3Report'));
const MissingSSNReport = lazy(() => import('@/pages/person/reports/MissingSSNReport'));
const C3LineItemChangesReport = lazy(() => import('@/pages/person/reports/C3LineItemChangesReport'));
const ElectronicC3UploadsReport = lazy(() => import('@/pages/person/reports/ElectronicC3UploadsReport'));
const EmployerNotificationsReport = lazy(() => import('@/pages/person/reports/EmployerNotificationsReport'));
const HighWageMultiEmployerReport = lazy(() => import('@/pages/person/reports/HighWageMultiEmployerReport'));
const ScanningActivityReport = lazy(() => import('@/pages/person/reports/ScanningActivityReport'));
const OutstandingDiscrepanciesReport = lazy(() => import('@/pages/person/reports/OutstandingDiscrepanciesReport'));
const LongTermClaimsReport = lazy(() => import('@/pages/person/reports/LongTermClaimsReport'));
const AuditSampleReport = lazy(() => import('@/pages/person/reports/AuditSampleReport'));
const RefundsToCRUReport = lazy(() => import('@/pages/person/reports/RefundsToCRUReport'));
const AuditSampleIPReport = lazy(() => import('@/pages/person/reports/AuditSampleIPReport'));

// Finance Settings Pages
const FeeConfigurationDetail = lazy(() => import('@/pages/finance/settings/FeeConfigurationDetail'));
const FeeConfigurationList = lazy(() => import('@/pages/finance/settings/FeeConfigurationList'));
const ServiceTypeManagement = lazy(() => import('@/pages/finance/settings/ServiceTypeManagement'));
const PaymentArrangementsPage = lazy(() => import('@/pages/finance/PaymentArrangements'));
const ArrangementDetail = lazy(() => import('@/pages/finance/ArrangementDetail'));
const VerificationSettings = lazy(() => import('@/pages/finance/settings/VerificationSettings'));
const MultiCurrencySettings = lazy(() => import('@/pages/finance/settings/MultiCurrencySettings'));

// Benefits: legacy /benefits/* routes redirect to /bn/* module


// Compliance & Audit (ComplianceDashboard already imported above)
const EmployerComplianceManagement = lazy(() => import('@/pages/compliance/employers/EmployerComplianceManagement'));
const LegalProceedings = lazy(() => import('@/pages/compliance/legal/LegalProceedings'));
const AuditManagement = lazy(() => import('@/pages/compliance/audit-planning/AuditManagement'));
const PenaltyManagement = lazy(() => import('@/pages/compliance/cases/PenaltyManagement'));
const ComplianceAnalytics = lazy(() => import('@/pages/compliance/dashboards/ComplianceAnalytics'));
const EmployerHierarchy = lazy(() => import('@/pages/compliance/employers/EmployerHierarchy'));
const EmployerFinancialStatement = lazy(() => import('@/pages/compliance/employers/EmployerFinancialStatement'));
const EmployerComplianceJobs = lazy(() => import('@/pages/compliance/automation/EmployerComplianceJobs'));
const C3LedgerSync = lazy(() => import('@/pages/compliance/settings/C3LedgerSync'));
const LedgerAdministration = lazy(() => import('@/pages/compliance/settings/LedgerAdministration'));
const LedgerOperationsDashboard = lazy(() => import('@/pages/compliance/settings/LedgerOperationsDashboard'));
const LedgerPostingAdmin = lazy(() => import('@/pages/compliance/settings/LedgerPostingAdmin'));
const LedgerHelpCenter = lazy(() => import('@/pages/compliance/settings/LedgerHelpCenter'));
const PaymentLedgerSync = lazy(() => import('@/pages/compliance/settings/PaymentLedgerSync'));
const TrendReports = lazy(() => import('@/pages/compliance/reports/TrendReports'));

// Compliance — wired leaf routes (added to close menu/route gap)
const InspectionEvidencePage = lazy(() => import('@/pages/compliance/inspections/InspectionEvidencePage'));
const ConvertFindingToViolationPage = lazy(() => import('@/pages/compliance/inspections/ConvertFindingToViolationPage'));
const VerificationQueue = lazy(() => import('@/pages/compliance/violations/VerificationQueue'));
const RuleDetectedViolations = lazy(() => import('@/pages/compliance/violations/RuleDetectedViolations'));
const DuplicateReview = lazy(() => import('@/pages/compliance/violations/DuplicateReview'));
const ViolationHistory = lazy(() => import('@/pages/compliance/violations/ViolationHistory'));
const ComplianceCaseIntake = lazy(() => import('@/pages/compliance/cases/CaseIntake'));
const AssignedCases = lazy(() => import('@/pages/compliance/cases/AssignedCases'));
const CaseMergeReviewPage = lazy(() => import('@/pages/compliance/cases/CaseMergeReviewPage'));
const ReopenRequestsPage = lazy(() => import('@/pages/compliance/cases/ReopenRequestsPage'));
const CaseClosurePage = lazy(() => import('@/pages/compliance/cases/CaseClosurePage'));
const LegalPackPreparationPage = lazy(() => import('@/pages/compliance/legal/LegalPackPreparationPage'));
const ApprovedEscalationsPage = lazy(() => import('@/pages/compliance/legal/ApprovedEscalationsPage'));
const ReturnedFromLegalPage = lazy(() => import('@/pages/compliance/legal/ReturnedFromLegalPage'));
const RiskScoreDetailsPage = lazy(() => import('@/pages/compliance/risk/RiskScoreDetailsPage'));
const RepeatDefaultersPage = lazy(() => import('@/pages/compliance/risk/RepeatDefaultersPage'));
const HighRiskEmployersPage = lazy(() => import('@/pages/compliance/risk/HighRiskEmployersPage'));
const WatchlistPage = lazy(() => import('@/pages/compliance/risk/WatchlistPage'));
const AutomationJobReports = lazy(() => import('@/pages/compliance/reports/AutomationJobReports'));

// Legal Module
const LegalAuth = lazy(() => import('@/pages/legal/LegalAuth'));
const LegalHearingCalendar = lazy(() => import('@/pages/legal/LegalHearingCalendar'));
const LegalReferenceData = lazy(() => import('@/pages/legal/LegalReferenceData'));
const LegalReferenceLegacyValues = lazy(() => import('@/pages/legal/LegalReferenceLegacyValues'));
const LegalOrderRegistry = lazy(() => import('@/pages/legal/LegalOrderRegistry'));
const LegalDocumentCenter = lazy(() => import('@/pages/legal/DocumentCenter'));
const SSBCaseListPage = lazy(() => import('@/pages/legal/SSBCaseList'));
const SSBCaseIntake = lazy(() => import('@/pages/legal/SSBCaseIntake'));
const SSBCaseViewPage = lazy(() => import('@/pages/legal/SSBCaseView'));
const SSBLegalReports = lazy(() => import('@/pages/legal/SSBLegalReports'));
const SSBLegalDashboard = lazy(() => import('@/pages/legal/SSBLegalDashboard'));

// Audit Module — Simplified Department Function Audit
const AuditDashboard = lazy(() => import('@/pages/audit/AuditDashboard'));
const AuditPlansNew = lazy(() => import('@/pages/audit/AuditPlansNew'));
const AuditPlanDetail = lazy(() => import('@/pages/audit/AuditPlanDetail'));
const AuditReports = lazy(() => import('@/pages/audit/AuditReports'));
const AuditReportBuilder = lazy(() => import('@/pages/audit/AuditReportBuilder'));
const DepartmentMaster = lazy(() => import('@/pages/audit/DepartmentMaster'));
const FunctionMaster = lazy(() => import('@/pages/audit/FunctionMaster'));
const DepartmentView = lazy(() => import('@/pages/audit/DepartmentView'));
const RiskAssessment = lazy(() => import('@/pages/audit/RiskAssessment'));
const EntitySummary = lazy(() => import('@/pages/audit/EntitySummary'));
const RiskMatrix = lazy(() => import('@/pages/audit/RiskMatrix'));
const AuditEngagements = lazy(() => import('@/pages/audit/AuditEngagements'));
const EngagementDetail = lazy(() => import('@/pages/audit/EngagementDetail'));
const PlanApproval = lazy(() => import('@/pages/audit/PlanApproval'));
const AuditConfig = lazy(() => import('@/pages/audit/AuditConfig'));
const RiskSettings = lazy(() => import('@/pages/audit/RiskSettings'));
const DocumentTemplateSettings = lazy(() => import('@/pages/audit/DocumentTemplateSettings'));
const ComplianceReportTemplates = lazy(() => import('@/pages/compliance/admin/ComplianceReportTemplates'));
const AuditQueries = lazy(() => import('@/pages/audit/AuditQueries'));

const RiskRegister = lazy(() => import('@/pages/audit/RiskRegister'));
const AuditorProfiles = lazy(() => import('@/pages/audit/AuditorProfiles'));
const WorkloadCapacity = lazy(() => import('@/pages/audit/WorkloadCapacity'));
const TimeTracking = lazy(() => import('@/pages/audit/TimeTracking'));

const AuditorLeaveManagement = lazy(() => import('@/pages/audit/AuditorLeaveManagement'));

// Reports
const ReportsHub = lazy(() => import('@/pages/reports/ReportsHub'));
const EmployerStatement = lazy(() => import('@/pages/reports/EmployerStatement'));

// System Administration
const WebUsers = lazy(() => import('@/pages/users/WebUsers'));

const CentralScheduler = lazy(() => import('@/pages/admin/CentralScheduler'));
const UserManagement = lazy(() => import('@/pages/systemAdmin/UserManagement'));
const BackupRecovery = lazy(() => import('@/pages/systemAdmin/BackupRecovery'));
const SystemLogs = lazy(() => import('@/pages/systemAdmin/SystemLogs'));
const SessionHealth = lazy(() => import('@/pages/systemAdmin/SessionHealth'));
const EmployeeList = lazy(() => import('@/pages/systemAdmin/EmployeeList'));
const OrgUnitList = lazy(() => import('@/pages/systemAdmin/OrgUnitList'));
const PositionList = lazy(() => import('@/pages/systemAdmin/PositionList'));
const RoleList = lazy(() => import('@/pages/systemAdmin/RoleList'));
// System Administration Routes - Approval Matrix modules added
const DelegationList = lazy(() => import('@/pages/systemAdmin/DelegationList'));
const ApprovalMatrixPayment = lazy(() => import('@/pages/systemAdmin/ApprovalMatrixPayment'));
const ApprovalMatrixFeeWaiver = lazy(() => import('@/pages/systemAdmin/ApprovalMatrixFeeWaiver'));
const ApprovalMatrixJournal = lazy(() => import('@/pages/systemAdmin/ApprovalMatrixJournal'));
const ApprovalMatrixRefund = lazy(() => import('@/pages/systemAdmin/ApprovalMatrixRefund'));
const ApprovalMatrixWriteOff = lazy(() => import('@/pages/systemAdmin/ApprovalMatrixWriteOff'));
const WorkflowSchemeList = lazy(() => import('@/pages/systemAdmin/WorkflowSchemeList'));
const NotificationLog = lazy(() => import('@/pages/systemAdmin/NotificationLog'));
const NotificationTemplates = lazy(() => import('@/pages/systemAdmin/NotificationTemplates'));
const NotificationChannelSettings = lazy(() => import('@/pages/systemAdmin/NotificationChannelSettings'));
// ReferenceSequencesAdmin now rendered inside NumberingAdmin (Sequences tab).
const WorkflowManagement = lazy(() => import('@/pages/workflow/WorkflowManagement'));

// Enterprise Admin Module
const UserManagementAdmin = lazy(() => import('@/pages/admin/UserManagementAdmin'));
// RolePermissionManagement now rendered inside RolesAdmin (Permissions tab).

const NotificationManagement = lazy(() => import('@/pages/admin/NotificationManagement'));
// OfficeManagement is now rendered via OfficesAdmin (tabbed). Direct lazy import removed.
const OfficeIPManagement = lazy(() => import('@/pages/admin/OfficeIPManagement'));
const OfficesAdmin = lazy(() => import('@/pages/admin/OfficesAdmin'));
// DepartmentManagement now rendered inside DepartmentsAdmin (Departments tab).
const ModuleManagement = lazy(() => import('@/pages/admin/ModuleManagement'));
const DesignationManagement = lazy(() => import('@/pages/admin/DesignationManagement'));
const DesignationHierarchy = lazy(() => import('@/pages/admin/DesignationHierarchy'));
const DesignationsAdmin = lazy(() => import('@/pages/admin/DesignationsAdmin'));
// RoleHierarchy now rendered inside RolesAdmin (Hierarchy tab).
const UserNotificationPreferences = lazy(() => import('@/pages/admin/UserNotificationPreferences'));
const DataMigration = lazy(() => import('@/pages/admin/DataMigration'));
const ReleaseManagement = lazy(() => import('@/pages/admin/ReleaseManagement'));
const UpdateUserPassword = lazy(() => import('@/pages/admin/users/UpdateUserPassword'));
const ModuleButtonBindings = lazy(() => import('@/pages/admin/ModuleButtonBindings'));
const ApiKeysManagement = lazy(() => import('@/pages/admin/ApiKeysManagement'));
const ExternalPortalSettings = lazy(() => import('@/pages/admin/ExternalPortalSettings'));
const ApiTestDashboard = lazy(() => import('@/pages/admin/api-test-console/ApiTestDashboard'));
const ApiKeysConsole = lazy(() => import('@/pages/admin/api-test-console/ApiKeysConsole'));
const EnvironmentsConsole = lazy(() => import('@/pages/admin/api-test-console/EnvironmentsConsole'));
const AuthTestLab = lazy(() => import('@/pages/admin/api-test-console/AuthTestLab'));
const EndpointExplorer = lazy(() => import('@/pages/admin/api-test-console/EndpointExplorer'));
const ComplianceRunner = lazy(() => import('@/pages/admin/api-test-console/ComplianceRunner'));
const SavedCasesConsole = lazy(() => import('@/pages/admin/api-test-console/SavedCasesConsole'));
const SuitesConsole = lazy(() => import('@/pages/admin/api-test-console/SuitesConsole'));
const ExecutionLogs = lazy(() => import('@/pages/admin/api-test-console/ExecutionLogs'));
const PublicApiManagement = lazy(() => import('@/pages/admin/PublicApiManagement'));
const DocumentConfigurationPage = lazy(() => import('@/pages/admin/DocumentConfigurationPage'));
const ExternalApiManagement = lazy(() => import('@/pages/admin/ExternalApiManagement'));
const ExternalApiDocs = lazy(() => import('@/pages/external/ExternalApiDocs'));
const PublicApiDocs = lazy(() => import('@/pages/public/PublicApiDocs'));

const WorkflowList = lazy(() => import('@/pages/admin/workflows/WorkflowList'));
const WorkflowForm = lazy(() => import('@/pages/admin/workflows/WorkflowForm'));
const WorkflowTriggers = lazy(() => import('@/pages/admin/workflows/WorkflowTriggers'));
const WorkflowLogs = lazy(() => import('@/pages/admin/workflows/WorkflowLogs'));
const WorkflowAnalytics = lazy(() => import('@/pages/admin/workflows/WorkflowAnalytics'));
const WorkflowSecuritySettings = lazy(() => import('@/pages/admin/workflows/WorkflowSecuritySettings'));
const SecuredWorkflowApprovals = lazy(() => import('@/pages/admin/workflows/SecuredWorkflowApprovals'));
const WorkflowInstanceList = lazy(() => import('@/pages/admin/workflows/WorkflowInstanceList'));
const WorkflowRoleAssignment = lazy(() => import('@/pages/admin/workflows/WorkflowRoleAssignment'));
const WorkflowInstanceDetail = lazy(() => import('@/pages/admin/workflows/WorkflowInstanceDetail'));
const MyWorkflowTasks = lazy(() => import('@/pages/workflow/MyWorkflowTasks'));
const WorkflowInbox = lazy(() => import('@/pages/admin/WorkflowInbox'));
const MigrationControlCentre = lazy(() => import('@/pages/admin/MigrationControlCentre'));
const PlatformServiceCatalogue = lazy(() => import('@/pages/admin/PlatformServiceCatalogue'));
const ReleaseReadinessDashboard = lazy(() => import('@/pages/admin/ReleaseReadinessDashboard'));
const EmployerRegistry = lazy(() => import('@/pages/admin/EmployerRegistry'));
const EmployerRegistryDetail = lazy(() => import('@/pages/admin/EmployerRegistryDetail'));
const ApplicationsReview = lazy(() => import('@/pages/workflow/ApplicationsReview'));

// Sample Application
const SampleApplicationList = lazy(() => import('@/pages/sample-application/SampleApplicationList'));
const SampleApplicationForm = lazy(() => import('@/pages/sample-application/SampleApplicationForm'));
const SampleApplicationView = lazy(() => import('@/pages/sample-application/SampleApplicationView'));

// Data Access Control
const DataScopeRules = lazy(() => import('@/pages/admin/data-access/DataScopeRules'));
const FieldSecurity = lazy(() => import('@/pages/admin/data-access/FieldSecurity'));
const RoleDataPolicies = lazy(() => import('@/pages/admin/data-access/RoleDataPolicies'));
const UserDataOverrides = lazy(() => import('@/pages/admin/data-access/UserDataOverrides'));
const PolicyTestConsole = lazy(() => import('@/pages/admin/data-access/PolicyTestConsole'));

// System Cleanup
const SystemCleanupDashboard = lazy(() => import('@/pages/admin/system-cleanup/SystemCleanupDashboard'));
const ActiveModulesInventory = lazy(() => import('@/pages/admin/system-cleanup/ActiveModulesInventory'));
const DependencyScan = lazy(() => import('@/pages/admin/system-cleanup/DependencyScan'));
const CleanupReview = lazy(() => import('@/pages/admin/system-cleanup/CleanupReview'));
const RollbackScreen = lazy(() => import('@/pages/admin/system-cleanup/RollbackScreen'));

// Online Applications Module
const ApiConfiguration = lazy(() => import('@/pages/admin/settings/ApiConfiguration'));
const GlobalSettings = lazy(() => import('@/pages/systemAdmin/GlobalSettings'));
const DateCultureConsistency = lazy(() => import('@/pages/admin/DateCultureConsistency'));
// C3CalculationConfigPage and C3PeriodConfigPage now consolidated under C3ConfigurationPage tabs.
const C3ConfigurationPage = lazy(() => import('@/pages/admin/C3ConfigurationPage'));
const InsuredPersonApplications = lazy(() => import('@/pages/online-applications/InsuredPersonApplications'));
const ApplicationDetailPage = lazy(() => import('@/pages/online-applications/ApplicationDetailPage'));
const EmployerApplications = lazy(() => import('@/pages/online-applications/EmployerApplications'));
const EmployerApplicationDetailPage = lazy(() => import('@/pages/online-applications/EmployerApplicationDetailPage'));
const DoctorApplications = lazy(() => import('@/pages/online-applications/DoctorApplications'));

// QA Framework
const QADashboard = lazy(() => import('@/pages/admin/qa/QADashboard'));
const KnowledgeRepository = lazy(() => import('@/pages/admin/qa/KnowledgeRepository'));
const QAChangeRequests = lazy(() => import('@/pages/admin/qa/QAChangeRequests'));
const DoctorApplicationDetailPage = lazy(() => import('@/pages/online-applications/DoctorApplicationDetailPage'));

// IP Registration Module
const IPRegistrationList = lazy(() => import('@/pages/ip-registration/IPRegistrationList'));
const IPRegistrationForm = lazy(() => import('@/pages/ip-registration/IPRegistrationForm'));
const ExternalApplicationsScreen = lazy(() => import('@/pages/ip-registration/ExternalApplicationsScreen'));

// Employer Registration Module
const EmployerRegistrationList = lazy(() => import('@/pages/employer-registration/EmployerRegistrationList'));
const EmployerRegistrationForm = lazy(() => import('@/pages/employer-registration/EmployerRegistrationForm'));

// Enterprise Admin - User Management (Separate Screens)
const UserList = lazy(() => import('@/pages/admin/users/UserList'));
const PlatformAdmin = lazy(() => import('@/pages/admin/PlatformAdmin'));
const RouteRegistryAdmin = lazy(() => import('@/pages/admin/RouteRegistryAdmin'));
const TableRegistryAdmin = lazy(() => import('@/pages/admin/TableRegistryAdmin'));
const LegacyMappingAdmin = lazy(() => import('@/pages/admin/LegacyMappingAdmin'));
const PermissionRegistryAdmin = lazy(() => import('@/pages/admin/PermissionRegistryAdmin'));
const LegacyMappingDetailAdmin = lazy(() => import('@/pages/admin/LegacyMappingDetailAdmin'));
const ConfigurationCentre = lazy(() => import('@/pages/admin/ConfigurationCentre'));
const SsbSetupPage = lazy(() => import('@/pages/admin/SsbSetupPage'));
const ConfigurationGovernancePage = lazy(() => import('@/pages/admin/ConfigurationGovernancePage'));
const PlatformReadinessCentre = lazy(() => import('@/pages/admin/PlatformReadinessCentre'));
const EnterpriseConsumptionRegistryPage = lazy(() => import('@/pages/admin/EnterpriseConsumptionRegistryPage'));
const EnterpriseServiceCatalogue = lazy(() => import('@/pages/admin/EnterpriseServiceCatalogue'));
const GeographyDomainPage = lazy(() => import('@/pages/admin/GeographyDomainPage'));
const IdentityDomainPage = lazy(() => import('@/pages/admin/IdentityDomainPage'));
const FinancialReferenceDomainPage = lazy(() => import('@/pages/admin/FinancialReferenceDomainPage'));
const LegalReferenceDomainPage = lazy(() => import('@/pages/admin/LegalReferenceDomainPage'));
const ParticipantDomainPage = lazy(() => import('@/pages/admin/ParticipantDomainPage'));
const CommunicationDomainPage = lazy(() => import('@/pages/admin/CommunicationDomainPage'));
const ReferenceFramework = lazy(() => import('@/pages/admin/ReferenceFramework'));
const UserCreate = lazy(() => import('@/pages/admin/users/UserCreate'));
const UserView = lazy(() => import('@/pages/admin/users/UserView'));
const UserEdit = lazy(() => import('@/pages/admin/users/UserEdit'));
const UserRoles = lazy(() => import('@/pages/admin/users/UserRoles'));
const UserProfileManageAdmin = lazy(() => import('@/pages/admin/UserProfileManageAdmin'));
const SeedTestUsers = lazy(() => import('@/pages/admin/SeedTestUsers'));

// Enterprise Admin - Role Management
// AdminRoleList, RolePermissionManagement and RoleHierarchy now render via RolesAdmin (tabbed).
const RolesAdmin = lazy(() => import('@/pages/admin/RolesAdmin'));

// Enterprise Admin - Security Settings
const PasswordPolicySettings = lazy(() => import('@/pages/admin/security/PasswordPolicySettings'));
const MFASettings = lazy(() => import('@/pages/admin/security/MFASettings'));
const SecurityPolicySettingsPage = lazy(() => import('@/pages/admin/security/SecurityPolicySettings'));
const IPAccessRulesManagement = lazy(() => import('@/pages/admin/security/IPAccessRulesManagement'));
const Maintenance = lazy(() => import('@/pages/Maintenance'));

// Profile Pages
const ProfileChangePassword = lazy(() => import('@/pages/profile/ChangePassword'));
const NotificationPreferences = lazy(() => import('@/pages/profile/NotificationPreferences'));
const ActiveSessions = lazy(() => import('@/pages/profile/ActiveSessions'));
const MyProfile = lazy(() => import('@/pages/profile/MyProfile'));

// Notification Pages
const NotificationCenter = lazy(() => import('@/pages/notifications/NotificationCenter'));
const ProviderSettings = lazy(() => import('@/pages/admin/notifications/ProviderSettings'));
const EmailCampaigns = lazy(() => import('@/pages/admin/EmailCampaigns'));
const EmailLogs = lazy(() => import('@/pages/admin/EmailLogs'));

// System Monitoring & Logs
const TechnicalLogs = lazy(() => import('@/pages/system-logs/TechnicalLogs'));
const ErrorLogs = lazy(() => import('@/pages/system-logs/ErrorLogs'));
const BusinessEvents = lazy(() => import('@/pages/system-logs/BusinessEvents'));
const AuditTrail = lazy(() => import('@/pages/system-logs/AuditTrail'));
const SecurityLogs = lazy(() => import('@/pages/system-logs/SecurityLogs'));
const LoginSecurityLogs = lazy(() => import('@/pages/system-logs/LoginSecurityLogs'));
const IntegrationLogs = lazy(() => import('@/pages/system-logs/IntegrationLogs'));
const PerformanceMonitor = lazy(() => import('@/pages/system-logs/PerformanceMonitor'));
const SystemWorkflowLogs = lazy(() => import('@/pages/system-logs/WorkflowLogs'));
const AdminNotificationLogs = lazy(() => import('@/pages/admin/NotificationLogs'));
// AdminNotificationTemplates and NotificationTemplateManager now render via NotificationTemplatesAdmin (tabbed).
const NotificationTemplatesAdmin = lazy(() => import('@/pages/admin/NotificationTemplatesAdmin'));
const TemplateAssignmentsPage = lazy(() => import('@/pages/admin/configuration/TemplateAssignmentsPage'));

const SicknessBenefit = lazy(() => import('@/pages/nbenefit/short-term/SicknessBenefit'));
const MaternityBenefit = lazy(() => import('@/pages/nbenefit/short-term/MaternityBenefit'));
const EmploymentInjuryBenefit = lazy(() => import('@/pages/nbenefit/short-term/EmploymentInjuryBenefit'));
const FuneralGrantBenefit = lazy(() => import('@/pages/nbenefit/short-term/FuneralGrantBenefit'));
const AgeBenefit = lazy(() => import('@/pages/nbenefit/long-term/AgeBenefit'));
const ClaimApprovalEnhanced = lazy(() => import('@/pages/nbenefit/ClaimApprovalEnhanced'));
const BenefitRulesList = lazy(() => import('@/pages/nbenefit/_legacy/BenefitRulesList'));
const BenefitRuleEditor = lazy(() => import('@/pages/nbenefit/_legacy/BenefitRuleEditor'));
// Removed: MedicalRulesConfig (legacy). Use /bn/config/medical/* instead.
const BeneficiaryRegistry = lazy(() => import('@/pages/nbenefit/long-term/BeneficiaryRegistry'));
const BeneficiaryDetail = lazy(() => import('@/pages/nbenefit/long-term/BeneficiaryDetail'));
const LifeCertificateManagement = lazy(() => import('@/pages/nbenefit/long-term/LifeCertificateManagement'));
const CreatePayRun = lazy(() => import('@/pages/finance/accounts-payable/CreatePayRun'));
const PayRunList = lazy(() => import('@/pages/finance/accounts-payable/PayRunList'));
const GeneratePayments = lazy(() => import('@/pages/finance/accounts-payable/GeneratePayments'));
const PaymentInquiry = lazy(() => import('@/pages/finance/accounts-payable/PaymentInquiry'));
const BenefitFinanceMapping = lazy(() => import('@/pages/finance/settings/BenefitFinanceMapping'));
const LifeCertificateConfig = lazy(() => import('@/pages/nbenefit/config/LifeCertificateConfig'));

// Meetings Module
const ManageMeetingsPage = lazy(() => import('@/pages/meetings/ManageMeetingsPage'));
const StartMeetingPage = lazy(() => import('@/pages/meetings/StartMeetingPage'));

// Accounts Payable Module
const APPendingPayables = lazy(() => import('@/pages/finance/accounts-payable/PendingPayables'));
const APCreateBatch = lazy(() => import('@/pages/finance/accounts-payable/CreateAPBatch'));
const APBatchList = lazy(() => import('@/pages/finance/accounts-payable/APBatchList'));
const APBatchDetail = lazy(() => import('@/pages/finance/accounts-payable/APBatchDetail'));
const APAccountsVerification = lazy(() => import('@/pages/finance/accounts-payable/AccountsVerification'));
const APBenefitsVerification = lazy(() => import('@/pages/finance/accounts-payable/BenefitsVerification'));
const APCheckPrinting = lazy(() => import('@/pages/finance/accounts-payable/CheckPrinting'));
const APDirectDepositGeneration = lazy(() => import('@/pages/finance/accounts-payable/DirectDepositGeneration'));
const APPostingHistory = lazy(() => import('@/pages/finance/accounts-payable/APPostingHistory'));
const APCorrections = lazy(() => import('@/pages/finance/accounts-payable/APCorrections'));
const APReports = lazy(() => import('@/pages/finance/accounts-payable/APReports'));
const APVerificationExceptions = lazy(() => import('@/pages/finance/accounts-payable/APVerificationExceptions'));
const InvalidityBenefit = lazy(() => import('@/pages/nbenefit/long-term/InvalidityBenefit'));
const CorrespondenceDashboard = lazy(() => import('@/pages/correspondence/CorrespondenceDashboard'));
const IncomingCommunications = lazy(() => import('@/pages/correspondence/IncomingCommunications'));
const OutgoingCommunications = lazy(() => import('@/pages/correspondence/OutgoingCommunications'));
const SearchHistory = lazy(() => import('@/pages/correspondence/SearchHistory'));
const Archive = lazy(() => import('@/pages/correspondence/Archive'));
const ModuleTemplates = lazy(() => import('@/pages/templates/ModuleTemplates'));
const AssistanceBenefit = lazy(() => import('@/pages/nbenefit/long-term/AssistanceBenefit'));
const SurvivorsBenefit = lazy(() => import('@/pages/nbenefit/long-term/SurvivorsBenefit'));
const AssistancePension = lazy(() => import('@/pages/nbenefit/non-contributory/AssistancePension'));
const InvalidityAssistance = lazy(() => import('@/pages/nbenefit/non-contributory/InvalidityAssistance'));
const RegistrySearch = lazy(() => import('@/pages/nbenefit/shared/RegistrySearch'));
const CommonEligibilityRules = lazy(() => import('@/pages/nbenefit/shared/CommonEligibilityRules'));
const CalculationEngines = lazy(() => import('@/pages/nbenefit/shared/CalculationEngines'));
const DocumentTemplates = lazy(() => import('@/pages/nbenefit/shared/DocumentTemplates'));
const BenefitWorkflows = lazy(() => import('@/pages/nbenefit/shared/BenefitWorkflows'));
const BenefitApplicationFormPage = lazy(() => import('@/pages/nbenefit/BenefitApplicationFormPage'));
const PublicBenefitApplication = lazy(() => import('@/pages/public/bn/PublicBenefitApplication'));

// Medical Module
const DoctorApplicationsList = lazy(() => import('@/pages/medical/DoctorApplicationsList'));
const DoctorApplicationDetail = lazy(() => import('@/pages/medical/DoctorApplicationDetail'));
const NewManualApplication = lazy(() => import('@/pages/medical/NewManualApplication'));
const DoctorRegistry = lazy(() => import('@/pages/medical/DoctorRegistry'));
const ClaimsByDoctors = lazy(() => import('@/pages/medical/ClaimsByDoctors'));

const ManageEmployers = lazy(() => import('@/pages/employersManagement/ManageEmployers'));
const EmployersDashboard = lazy(() => import('@/pages/employersManagement/EmployersDashboard'));

// New pages for missing routes
const AddEmployer = lazy(() => import('@/pages/employersManagement/AddEmployer'));
const EmployersReports = lazy(() => import('@/pages/reports/EmployersReports'));


const ManageSelfEmployed = lazy(() => import('@/pages/selfEmployed/ManageSelfEmployed'));
const AddSelfEmployed = lazy(() => import('@/pages/selfEmployed/AddSelfEmployed'));
const SelfEmployedReports = lazy(() => import('@/pages/selfEmployed/SelfEmployedReports'));
const InsuredPersonGuide = lazy(() => import('@/pages/insuredPersons/InsuredPersonGuide'));
const EmployerRules = lazy(() => import('@/pages/employersManagement/EmployerRules'));
const ApprovalWorkflow = lazy(() => import('@/pages/registration/ApprovalWorkflow'));
const DocumentationRequirements = lazy(() => import('@/pages/registration/DocumentationRequirements'));
const UserProfile = lazy(() => import('@/pages/users/UserProfile'));
const ChangePassword = lazy(() => import('@/pages/users/ChangePassword'));
const ManageRoles = lazy(() => import('@/pages/users/ManageRoles'));
const SystemSettings = lazy(() => import('@/pages/systemAdmin/SystemSettings'));
const SecuritySettings = lazy(() => import('@/pages/systemAdmin/SecuritySettings'));
const PersonRegistration = lazy(() => import('@/pages/insuredPersons/PersonRegistration'));
const RegisterPersonTabs = lazy(() => import('@/pages/insuredPersons/RegisterPersonTabs'));
const PendingVerificationPage = lazy(() => import('@/pages/insuredPersons/PendingVerificationPage'));

// C3 Management
const C3Dashboard = lazy(() => import('@/pages/c3Management/C3Dashboard'));
const C3Management = lazy(() => import('@/pages/c3Management/C3Management'));
const C3InputForm = lazy(() => import('@/pages/c3Management/C3InputForm'));
const C3Simulation = lazy(() => import('@/pages/c3Management/C3Simulation'));


const C3Reports = lazy(() => import('@/pages/c3Management/C3Reports'));
const C3Verification = lazy(() => import('@/pages/c3Management/C3Verification'));
const ElectronicC3Config = lazy(() => import('@/pages/c3Management/ElectronicC3Config'));
const ViewC3Record = lazy(() => import('@/pages/c3Management/ViewC3Record'));
const EditC3Record = lazy(() => import('@/pages/c3Management/EditC3Record'));

// C3 Wizard Admin - Employer Management
const WizEmployerList = lazy(() => import('@/pages/c3Management/employers/WizEmployerList'));
const WizEmployerDetailsEdit = lazy(() => import('@/pages/c3Management/employers/WizEmployerDetailsEdit'));
const WizCompanyUsers = lazy(() => import('@/pages/c3Management/employers/WizCompanyUsers'));
const WizEmployeeList = lazy(() => import('@/pages/c3Management/employers/WizEmployeeList'));

// C3 Wizard Admin - Self-Employed Management
const WizSelfEmployedList = lazy(() => import('@/pages/c3Management/selfEmployed/WizSelfEmployedList'));
const WizSelfEmployedDetailsEdit = lazy(() => import('@/pages/c3Management/selfEmployed/WizSelfEmployedDetailsEdit'));
const WizSelfEmployedUserEdit = lazy(() => import('@/pages/c3Management/selfEmployed/WizSelfEmployedUserEdit'));

// C3 Wizard Admin - Manage Users Module
const WizEmployerUsers = lazy(() => import('@/pages/c3Management/manageUsers/WizEmployerUsers'));
const WizSelfEmployedUsers = lazy(() => import('@/pages/c3Management/manageUsers/WizSelfEmployedUsers'));
const WizRolePermission = lazy(() => import('@/pages/c3Management/manageUsers/WizRolePermission'));
const WizRoleMaster = lazy(() => import('@/pages/c3Management/manageUsers/WizRoleMaster'));

// C3 Wizard Admin - Payment Details
const WizPaymentDetails = lazy(() => import('@/pages/c3Management/payments/WizPaymentDetails'));

// C3 Wizard Admin - Reports
const WizEmployerHistory = lazy(() => import('@/pages/c3Management/reports/WizEmployerHistory'));
const WizSelfEmployedHistory = lazy(() => import('@/pages/c3Management/reports/WizSelfEmployedHistory'));
const WizPaymentsHistory = lazy(() => import('@/pages/c3Management/reports/WizPaymentsHistory'));
const WizReconciliationHistory = lazy(() => import('@/pages/c3Management/reports/WizReconciliationHistory'));
const WizUsersHistory = lazy(() => import('@/pages/c3Management/reports/WizUsersHistory'));
const ViewEmployer = lazy(() => import('@/pages/employersManagement/ViewEmployer').then((m) => ({ default: m.ViewEmployer })));
const EditEmployer = lazy(() => import('@/pages/employersManagement/EditEmployer').then((m) => ({ default: m.EditEmployer })));

// Test pages
const TestDataEntry = lazy(() => import('@/pages/test/TestDataEntry'));

// Legal Module pages
const NewLegalModule = lazy(() => import('@/pages/legal/NewLegalModule'));
const CaseIntake = lazy(() => import('@/pages/legal/CaseIntake'));
const IntakeDetail = lazy(() => import('@/pages/legal/IntakeDetail'));
const IntakeValidationReport = lazy(() => import('@/pages/legal/admin/IntakeValidationReport'));
const CaseTracking = lazy(() => import('@/pages/legal/CaseTracking'));
const CaseDetailView = lazy(() => import('@/pages/legal/CaseDetailView'));
const CaseEditView = lazy(() => import('@/pages/legal/CaseEditView'));
const LegalDashboard = lazy(() => import('@/pages/legal/LegalDashboard'));
const LgDashboard = lazy(() => import('@/pages/legal/LgDashboard'));
const UatDocumentsPage = lazy(() => import('@/pages/legal/uat/UatDocumentsPage'));
const LegalDocumentsWorkspace = lazy(() => import('@/pages/legal/lg/LegalDocumentsWorkspace'));
const ContractReviewDashboard = lazy(() => import('@/pages/legal/contract-review/ContractReviewDashboard'));
const ContractReviewIntake = lazy(() => import('@/pages/legal/contract-review/ContractReviewIntake'));
const ContractReviewDetail = lazy(() => import('@/pages/legal/contract-review/ContractReviewDetail'));
const MyContractReviews = lazy(() => import('@/pages/legal/contract-review/MyContractReviews'));
const AdviceWorkbench = lazy(() => import('@/pages/legal/contract-review/AdviceWorkbench'));
const LegalServicesHub = lazy(() => import('@/pages/legal/LegalServicesHub'));
const LegalOpsDashboard = lazy(() => import('@/pages/legal/LegalOpsDashboard'));
const LgHearingCalendar = lazy(() => import('@/pages/legal/LgHearingCalendar'));
const LgHearingWorkbench = lazy(() => import('@/pages/legal/LgHearingWorkbench'));
const LgHearingWorkspace = lazy(() => import('@/pages/legal/LgHearingWorkspace'));
const LgCaseDetail = lazy(() => import('@/pages/legal/LgCaseDetail'));
const LgCaseList = lazy(() => import('@/pages/legal/LgCaseList'));
const LgTasksList = lazy(() => import('@/pages/legal/LgTasksList'));
const LgRecoveryWorkbench = lazy(() => import('@/pages/legal/LgRecoveryWorkbench'));
const LgPostJudgmentWorkspace = lazy(() => import('@/pages/legal/LgPostJudgmentWorkspace'));
const LgLegalRecoveryDashboard = lazy(() => import('@/pages/legal/LgLegalRecoveryDashboard'));
const LgJudgmentComplianceWorkbench = lazy(() => import('@/pages/legal/post-judgment/LgJudgmentComplianceWorkbench'));
const LgConsentOrdersWorkbench = lazy(() => import('@/pages/legal/post-judgment/LgConsentOrdersWorkbench'));
const LgLegalSettlementsWorkbench = lazy(() => import('@/pages/legal/post-judgment/LgLegalSettlementsWorkbench'));
const LgCourtFilingsWorkbench = lazy(() => import('@/pages/legal/post-judgment/LgCourtFilingsWorkbench'));
const LgExternalCounselWorkbench = lazy(() => import('@/pages/legal/post-judgment/LgExternalCounselWorkbench'));
const LgLegalCostRecoveryWorkbench = lazy(() => import('@/pages/legal/post-judgment/LgLegalCostRecoveryWorkbench'));
const LgJudicialOrdersWorkbench = lazy(() => import('@/pages/legal/LgJudicialOrdersWorkbench'));
const LgOrderDetail = lazy(() => import('@/pages/legal/LgOrderDetail'));
const LgIntakeWorkbench = lazy(() => import('@/pages/legal/LgIntakeWorkbench'));
const LgIntakeWorkspace = lazy(() => import('@/pages/legal/LgIntakeWorkspace'));
// LegalWorkbench legacy page — @deprecated; route redirects to /legal/lg/dashboard.
const LegalUnifiedWorkbench = lazy(() => import('@/pages/legal/LegalUnifiedWorkbench'));
const DelinquentCases = lazy(() => import('@/pages/legal/DelinquentCases'));
// Legacy standalone Orders/Enforcement/PaymentPlans pages are deprecated
// and no longer routed. Redirects handled elsewhere point at LgJudicialOrdersWorkbench.
// Imports removed to prevent accidental re-registration. See
// docs/legal/LEGAL_LEGACY_RETIREMENT_AUDIT.md.
const CasesByStageReport = lazy(() => import('@/pages/legal/reports/CasesByStageReport'));
const RecoveryAnalysis = lazy(() => import('@/pages/legal/reports/RecoveryAnalysis'));
const AgingReceivables = lazy(() => import('@/pages/legal/reports/AgingReceivables'));
const CourtCostsFees = lazy(() => import('@/pages/legal/reports/CourtCostsFees'));
const PerformanceMetrics = lazy(() => import('@/pages/legal/reports/PerformanceMetrics'));
const PendingHearings = lazy(() => import('@/pages/legal/reports/PendingHearings'));
const LegalReportsCentre = lazy(() => import('@/pages/legal/reports/LegalReportsCentre'));
const LegalReportRunner = lazy(() => import('@/pages/legal/reports/LegalReportRunner'));
const ExecutiveKpiDashboard = lazy(() => import('@/pages/legal/reports/ExecutiveKpiDashboard'));
const LegalAnalyticsDashboard = lazy(() => import('@/pages/legal/reports/LegalAnalyticsDashboard'));
const LegalDashboardPersonalization = lazy(() => import('@/pages/legal/reports/LegalDashboardPersonalization'));
const ExecutiveCommandCentre = lazy(() => import('@/pages/legal/reports/ExecutiveCommandCentre'));
const DataQualityDashboard = lazy(() => import('@/pages/legal/reports/DataQualityDashboard'));
const ExportCentre = lazy(() => import('@/pages/legal/reports/ExportCentre'));
const PerformanceMonitoring = lazy(() => import('@/pages/legal/reports/PerformanceMonitoring'));
const ReportAudit = lazy(() => import('@/pages/legal/reports/ReportAudit'));
const SharedDashboards = lazy(() => import('@/pages/legal/reports/SharedDashboards'));
const ReportCertificationPage = lazy(() => import('@/pages/legal/reports/ReportCertification'));


const LgReportsHub = lazy(() => import('@/pages/legal/reports/lg/LgReportsHub'));
const LgCasesByStageReport = lazy(() => import('@/pages/legal/reports/lg/LgCasesByStageReport'));
const LgCasesByOfficerReport = lazy(() => import('@/pages/legal/reports/lg/LgCasesByOfficerReport'));
const LgCasesByTerritoryReport = lazy(() => import('@/pages/legal/reports/lg/LgCasesByTerritoryReport'));
const LgAgeingReport = lazy(() => import('@/pages/legal/reports/lg/LgAgeingReport'));
const LgOverdueHearingsReport = lazy(() => import('@/pages/legal/reports/lg/LgOverdueHearingsReport'));
const LgSlaBreachReport = lazy(() => import('@/pages/legal/reports/lg/LgSlaBreachReport'));
const LgRecoveryReport = lazy(() => import('@/pages/legal/reports/lg/LgRecoveryReport'));
const LgJudgmentOrderReport = lazy(() => import('@/pages/legal/reports/lg/LgJudgmentOrderReport'));
const LgReferralSourceReport = lazy(() => import('@/pages/legal/reports/lg/LgReferralSourceReport'));
const LgClosedCasesReport = lazy(() => import('@/pages/legal/reports/lg/LgClosedCasesReport'));
const LgPendingActionReport = lazy(() => import('@/pages/legal/reports/lg/LgPendingActionReport'));
const CourtsJudges = lazy(() => import('@/pages/legal/settings/CourtsJudges'));
const HearingTypes = lazy(() => import('@/pages/legal/settings/HearingTypes'));
const CaseStatuses = lazy(() => import('@/pages/legal/settings/CaseStatuses'));
const LegalRoles = lazy(() => import('@/pages/legal/settings/LegalRoles'));
const FeeMappings = lazy(() => import('@/pages/legal/settings/FeeMappings'));
const TerritorySettings = lazy(() => import('@/pages/legal/settings/TerritorySettings'));

// Legal Advanced Module (feature-flag gated)
const LegalAdvancedLayout = lazy(() => import('@/components/legal-advanced/LegalAdvancedLayout').then(m => ({ default: m.LegalAdvancedLayout })));
const LegalAdvancedGate = lazy(() => import('@/components/legal-advanced/LegalAdvancedGate').then(m => ({ default: m.LegalAdvancedGate })));
const LADashboard = lazy(() => import('@/pages/legal-advanced/LADashboard'));
const LAMatterList = lazy(() => import('@/pages/legal-advanced/LAMatterList'));
const LAMatterIntake = lazy(() => import('@/pages/legal-advanced/LAMatterIntake'));
const LAMatterDetail = lazy(() => import('@/pages/legal-advanced/LAMatterDetail'));
const LAWorkbaskets = lazy(() => import('@/pages/legal-advanced/LAWorkbaskets'));
const LASettings = lazy(() => import('@/pages/legal-advanced/LASettings'));
const LAPlaceholder = lazy(() => import('@/pages/legal-advanced/LAPlaceholder'));

const MiscellaneousPayments = lazy(() => import('@/pages/cashier/MiscellaneousPayments'));
const C3Payments = lazy(() => import('@/pages/cashier/C3Payments'));
const EFTEntry = lazy(() => import('@/pages/cashier/EFTEntry'));
const CashDetails = lazy(() => import('@/pages/cashier/CashDetails'));
const FundsTransfer = lazy(() => import('@/pages/cashier/FundsTransfer'));
const Receipt = lazy(() => import('@/pages/cashier/Receipt'));
const CheckManagement = lazy(() => import('@/pages/cashier/CheckManagement'));
const PaymentAnalytics = lazy(() => import('@/pages/cashier/PaymentAnalytics'));
const CashierReports = lazy(() => import('@/pages/cashier/CashierReports'));
const CreateInvoice = lazy(() => import('@/pages/cashier/CreateInvoice'));
const SearchPayInvoices = lazy(() => import('@/pages/cashier/SearchPayInvoices'));
const BatchClosing = lazy(() => import('@/pages/cashier/BatchClosing'));
const CardMachineChangeRequests = lazy(() => import('@/pages/cashier/CardMachineChangeRequests'));
const CashierBatchManagement = lazy(() => import('@/pages/cashier/BatchManagement'));
const PaymentModuleConfig = lazy(() => import('@/pages/cashier/PaymentModuleConfig'));
const HeadCashierOfficeAssignment = lazy(() => import('@/pages/cashier/HeadCashierOfficeAssignment'));
const HeadCashierAssignment = lazy(() => import('@/pages/cashier/HeadCashierAssignment'));
const CardMachineManagement = lazy(() => import('@/pages/cashier/CardMachineManagement'));
const DailyInvoiceReport = lazy(() => import('@/pages/cashier/DailyInvoiceReport'));
const ChartAccountsMapping = lazy(() => import('@/pages/cashier/ChartAccountsMapping'));
const PaymentTypesMapping = lazy(() => import('@/pages/cashier/PaymentTypesMapping'));
const SageSynchronization = lazy(() => import('@/pages/cashier/SageSynchronization'));
const CurrentAccountsSetup = lazy(() => import('@/pages/cashier/CurrentAccountsSetup'));
const BankReconciliationAccounts = lazy(() => import('@/pages/cashier/BankReconciliationAccounts'));
const GLPostingSummary = lazy(() => import('@/pages/cashier/GLPostingSummary'));
const ContributionReceipts = lazy(() => import('@/pages/cashier/ContributionReceipts'));
const RentReceipts = lazy(() => import('@/pages/cashier/RentReceipts'));
const LoanReceipts = lazy(() => import('@/pages/cashier/LoanReceipts'));
const ServiceReceipts = lazy(() => import('@/pages/cashier/ServiceReceipts'));
const NoticeGeneration = lazy(() => import('@/pages/legal/NoticeGeneration'));
const LgNoticeRegister = lazy(() => import('@/pages/legal/LgNoticeRegister'));

const AppealSubmission = lazy(() => import('@/pages/legal/AppealSubmission'));
const EnforcementPenalty = lazy(() => import('@/pages/legal/EnforcementPenalty'));
const LegalEvidenceManagement = lazy(() => import('@/pages/legal/EvidenceManagement'));
const LegalReports = lazy(() => import('@/pages/legal/LegalReports'));
const LegalReportsAnalytics = lazy(() => import('@/pages/legal/ReportsAnalytics'));
const LegalAdminConfig = lazy(() => import('@/pages/legal/AdminConfig'));
const LgFeeConfig = lazy(() => import('@/pages/legal/LgFeeConfig'));
const LgPolicyConfig = lazy(() => import('@/pages/legal/LgPolicyConfig'));
const LegalAdminWorkflowManagement = lazy(() => import('@/pages/legal/admin/LegalAdminWorkflowManagement'));

const LgFeeWaiverPolicyConfig = lazy(() => import('@/pages/legal/LgFeeWaiverPolicyConfig'));
const LegalTemplateManagement = lazy(() => import('@/pages/legal/LegalTemplateManagement'));
const LegalTemplateEditor = lazy(() => import('@/pages/legal/admin/LegalTemplateEditor'));
const LegalCaseAssignmentLiveNotice = lazy(() => import('@/pages/legal/admin/LegalCaseAssignmentLiveNotice'));
const LegalAdminCodeSets = lazy(() => import('@/pages/legal/admin/LegalAdminCodeSets'));
const LegalAdminComplainant = lazy(() => import('@/pages/legal/admin/LegalAdminComplainant'));
const LegalAdminTeams = lazy(() => import('@/pages/legal/admin/LegalAdminTeams'));
const LegalAdminStaff = lazy(() => import('@/pages/legal/admin/LegalAdminStaff'));
const LegalAdminRouting = lazy(() => import('@/pages/legal/admin/LegalAdminRouting'));
const LegalReferenceLibrary = lazy(() => import('@/pages/legal/admin/LegalReferenceLibrary'));
const LegalReferenceVerification = lazy(() => import('@/pages/legal/admin/LegalReferenceVerification'));
const LegalStageTemplateMapping = lazy(() => import('@/pages/legal/admin/LegalStageTemplateMapping'));
const LegalStageReferenceMapping = lazy(() => import('@/pages/legal/admin/LegalStageReferenceMapping'));
const LegalStageDocumentRules = lazy(() => import('@/pages/legal/admin/LegalStageDocumentRules'));
const LegalAdminPlaceholder = lazy(() => import('@/pages/legal/admin/LegalAdminPlaceholder'));
const LegalAdminDepartmentProfile = lazy(() => import('@/pages/legal/admin/LegalAdminDepartmentProfile'));
const CommunicationAssetsAdmin = lazy(() => import('@/pages/admin/communication/CommunicationAssetsAdmin'));
const OrganizationProfilePage = lazy(() => import('@/pages/admin/organization/OrganizationProfilePage'));
const CalendarHolidaysPage = lazy(() => import('@/pages/admin/CalendarHolidaysPage'));
const OfficeLocationsPage = lazy(() => import('@/pages/admin/OfficeLocationsPage'));

const OrganizationManagementAdmin = lazy(() => import('@/pages/admin/OrganizationManagementAdmin'));
const OrganizationManagementShell = lazy(() => import('@/pages/admin/OrganizationManagementShell'));
const OrganizationManualShell = lazy(() => import('@/pages/admin/help/OrganizationManualShell'));
const OrganizationManualPage = lazy(() => import('@/pages/admin/help/manual/ManualPage'));
const TemplateManagementShell = lazy(() => import('@/pages/admin/TemplateManagementShell'));
const CommunicationHubShell = lazy(() => import('@/pages/admin/communicationHub/CommunicationHubShell'));
const CommHubRequestsPage = lazy(() => import('@/pages/admin/communicationHub/CommunicationRequestsPage'));
const CommHubRequestDetailPage = lazy(() => import('@/pages/admin/communicationHub/CommunicationRequestDetailPage'));
const CommHubDeliveryMonitorPage = lazy(() => import('@/pages/admin/communicationHub/placeholders/DeliveryMonitorPage'));
const CommHubRetryQueuePage = lazy(() => import('@/pages/admin/communicationHub/placeholders/RetryQueuePage'));
const CommHubPrintQueuePage = lazy(() => import('@/pages/admin/communicationHub/placeholders/PrintQueuePage'));
const CommHubDispatchRegisterPage = lazy(() => import('@/pages/admin/communicationHub/placeholders/DispatchRegisterPage'));
const CommHubLifecycleLogPage = lazy(() => import('@/pages/admin/communicationHub/placeholders/LifecycleLogPage'));
const CommHubControlCenterPage = lazy(() => import('@/pages/admin/communicationHub/controlCenter/ControlCenterPage'));
const CommHubSafetySwitchboardPage = lazy(() => import('@/pages/admin/communicationHub/safety/SafetySwitchboardPage'));
const CommHubRecipientControlPage = lazy(() => import('@/pages/admin/communicationHub/recipientControl/RecipientControlCenterPage'));
const CommHubRecipientPolicySettingsPage = lazy(() => import('@/pages/admin/communicationHub/recipientControl/RecipientPolicySettingsPage'));
const CommHubDesignPage = lazy(() => import('@/pages/admin/communicationHub/CommunicationHubDesignPage'));
const CommHubSenderProfilesPage = lazy(() => import('@/pages/admin/communicationHub/SenderProfilesPage'));
const CommHubSenderVerificationPage = lazy(() => import('@/pages/admin/communicationHub/SenderVerificationPage'));
const CommHubOnboardingPage = lazy(() => import('@/pages/admin/communicationHub/CommunicationHubOnboardingPage'));
const CommHubEventTemplateWizardPage = lazy(() => import('@/pages/admin/communicationHub/onboarding/EventTemplateWizardPage'));
const CommHubModuleAdapterTestsPage = lazy(() => import('@/pages/admin/communicationHub/onboarding/ModuleAdapterTestsPage'));
const CommHubPilotsPage = lazy(() => import('@/pages/admin/communicationHub/CommunicationHubPilotsPage'));
const CommHubGoLivePage = lazy(() => import('@/pages/admin/communicationHub/goLive/GoLivePage'));
const CommHubSimpleOperationsPage = lazy(() => import('@/pages/admin/communicationHub/goLive/SimpleOperationsPage'));
const CommHubWorkspaceLayout = lazy(() => import('@/pages/admin/communicationHub/goLive/CommunicationHubWorkspaceLayout'));
const CommHubReadinessCenterPage = lazy(() => import('@/pages/admin/communicationHub/goLive/ReadinessCenterPage'));
const CommHubRevalidationWorkspacePage = lazy(() => import('@/pages/admin/communicationHub/goLive/RevalidationWorkspacePage'));
const CommHubAuditEvidenceWorkspacePage = lazy(() => import('@/pages/admin/communicationHub/goLive/AuditEvidenceWorkspacePage'));
const CommHubTestDiagnosticsPage = lazy(() => import('@/pages/admin/communicationHub/CommunicationTestDiagnosticsPage'));
const CommHubControlledLiveTestPage = lazy(() => import('@/pages/admin/communicationHub/testing/ControlledLiveTestPage'));
const CommHubGovernancePage = lazy(() => import('@/pages/admin/communicationHub/CommunicationHubGovernancePage'));
const CommHubAllEventsLiveReadinessPage = lazy(() => import('@/pages/admin/communicationHub/liveReadiness/AllEventsLiveReadinessPage'));
const CommHubProductionReadinessPage = lazy(() => import('@/pages/admin/communicationHub/productionReadiness/ProductionReadinessPage'));
const CommHubSendPoliciesPage = lazy(() => import('@/pages/admin/communicationHub/sendPolicy/CommHubSendPoliciesPage'));
const CommHubAutomationSettingsPage = lazy(() => import('@/pages/admin/communicationHub/CommHubAutomationSettingsPage'));
const CommHubTraceCenterPage = lazy(() => import('@/pages/admin/communicationHub/traces/TraceCenterPage'));
const CommHubTraceDetailPage = lazy(() => import('@/pages/admin/communicationHub/traces/TraceDetailPage'));
const OrganizationDirectLeaf = lazy(() => import('@/pages/admin/organization/OrganizationDirectLeaf'));
// OrgLocationsPage is rendered inside OfficesAdmin's "Locations" tab; route lazy import removed.
// OrgDepartmentProfilesPage now rendered inside DepartmentsAdmin (Profiles tab).
const OrgUsageValidationPage = lazy(() => import('@/pages/admin/organization/UsageValidationPage'));
const OrgMediaLibraryPage = lazy(() => import('@/pages/admin/organization/MediaLibraryPage'));
const OrgLetterheadsPage = lazy(() => import('@/pages/admin/organization/LetterheadsPage'));
// OrgNotificationTemplatesPage now rendered inside NotificationTemplatesAdmin (Org tab).
const OrgPortalBrandingPage = lazy(() => import('@/pages/admin/organization/PortalBrandingPage'));
const OrgDocumentAssetsPage = lazy(() => import('@/pages/admin/organization/DocumentAssetsPage'));
// OrgDepartmentMappingPage now rendered inside DepartmentsAdmin (Mapping tab).
const OrgTextBlocksPage = lazy(() => import('@/pages/admin/organization/TextBlocksPage'));
// OrgModuleRegistryPage deprecated: /admin/organization/modules redirects to /admin/modules.
const EnterpriseHealthPage = lazy(() => import('@/pages/admin/organization/EnterpriseHealthPage'));
const LegalAdminValidationReport = lazy(() => import('@/pages/legal/admin/LegalAdminValidationReport'));
const LegalAdminReferralIntegrity = lazy(() => import('@/pages/legal/admin/LegalAdminReferralIntegrity'));
const LegalAdminCaseIntegrity = lazy(() => import('@/pages/legal/admin/LegalAdminCaseIntegrity'));
const LegalAdminAssignmentIntegrity = lazy(() => import('@/pages/legal/admin/LegalAdminAssignmentIntegrity'));
const LegalMatterWorkspaceIntegrity = lazy(() => import('@/pages/legal/admin/LegalMatterWorkspaceIntegrity'));
const LegalAdminSlaRules = lazy(() => import('@/pages/legal/admin/LegalAdminSlaRules'));
const LegalCourtAdmin = lazy(() => import('@/pages/legal/admin/LegalCourtAdmin'));
const LgSlaPoliciesAdmin = lazy(() => import('@/pages/legal/admin/LgSlaPoliciesAdmin'));
const LgNotificationRulesAdmin = lazy(() => import('@/pages/legal/admin/LgNotificationRulesAdmin'));
const LgTemplateRegistryAdmin = lazy(() => import('@/pages/legal/admin/LgTemplateRegistryAdmin'));
// EPIC-06D — Recovery Assignment
const LgRecoveryAssignmentWorkbench = lazy(() => import('@/pages/legal/recovery/LgRecoveryAssignmentWorkbench'));
const LgRecoveryAssignmentWorkspace = lazy(() => import('@/pages/legal/recovery/LgRecoveryAssignmentWorkspace'));
const LgRecoveryCampaignsList = lazy(() => import('@/pages/legal/recovery/LgRecoveryCampaignsList'));
const LgRecoveryStrategyTypesAdmin = lazy(() => import('@/pages/legal/admin/LgRecoveryStrategyTypesAdmin'));
const LgRecoveryCampaignTypesAdmin = lazy(() => import('@/pages/legal/admin/LgRecoveryCampaignTypesAdmin'));
const LgRecoveryWorkloadRulesAdmin = lazy(() => import('@/pages/legal/admin/LgRecoveryWorkloadRulesAdmin'));
const LegalAdminHub = lazy(() => import('@/pages/legal/LegalAdminHub'));
const CoreDmsAdmin = lazy(() => import('@/pages/admin/CoreDmsAdmin'));
const DmsApiTest = lazy(() => import('@/pages/admin/DmsApiTest'));
const LgCaseCreateWizard = lazy(() => import('@/pages/legal/LgCaseCreateWizard'));
const LgCaseEdit = lazy(() => import('@/pages/legal/LgCaseEdit'));
// CoreTemplateAdmin now rendered inside NotificationTemplatesAdmin (Core tab).
const CaseWorkflow = lazy(() => import('@/pages/legal/settings/CaseWorkflow'));

// LegalFinal Module pages
// LegalFinal prototype — deprecated. Routes below redirect to Legal V1 canonical
// screens; lazy imports removed so bundles don't ship the prototype code.
// Files remain under src/pages/legalFinal/ pending deletion next release cycle.

// BeMA Compliance Pages (lazy loaded)

// Notification Pages
const NotificationDashboard = lazy(() => import('@/pages/notifications/NotificationDashboard'));
// TemplateManagement deprecated: /notifications/templates redirects to /admin/notification-templates.
const ActionMapping = lazy(() => import('@/pages/notifications/ActionMapping'));
const DeliveryManagement = lazy(() => import('@/pages/notifications/DeliveryManagement'));
const UserPreferences = lazy(() => import('@/pages/notifications/UserPreferences'));
// NotificationCenter already imported above
const ReportsAnalytics = lazy(() => import('@/pages/notifications/ReportsAnalytics'));
const Administration = lazy(() => import('@/pages/notifications/Administration'));

// NewBenefit Pages
const ContributorDashboard = lazy(() => import('@/pages/newBenefit/ContributorDashboard').then((m) => ({ default: m.ContributorDashboard })));
const ApplyForBenefits = lazy(() => import('@/pages/newBenefit/ApplyForBenefits').then((m) => ({ default: m.ApplyForBenefits })));
const BenefitApplicationForm = lazy(() => import('@/pages/newBenefit/BenefitApplicationForm').then((m) => ({ default: m.BenefitApplicationForm })));
const NewReferralForm = lazy(() => import('@/pages/newBenefit/NewReferralForm').then((m) => ({ default: m.NewReferralForm })));
const NewVerificationRequest = lazy(() => import('@/pages/newBenefit/NewVerificationRequest').then((m) => ({ default: m.NewVerificationRequest })));
const EmploymentVerificationDetail = lazy(() => import('@/pages/newBenefit/EmploymentVerificationDetail').then((m) => ({ default: m.EmploymentVerificationDetail })));
const MyClaims = lazy(() => import('@/pages/newBenefit/MyClaims').then((m) => ({ default: m.MyClaims })));
const ContributorReports = lazy(() => import('@/pages/newBenefit/ContributorReports').then((m) => ({ default: m.ContributorReports })));
const ContributorInbox = lazy(() => import('@/pages/newBenefit/ContributorInbox').then((m) => ({ default: m.ContributorInbox })));
const WorklistsHome = lazy(() => import('@/pages/newBenefit/WorklistsHome').then((m) => ({ default: m.WorklistsHome })));
const Claim360View = lazy(() => import('@/pages/newBenefit/Claim360View').then((m) => ({ default: m.Claim360View })));
const IntakeConsole = lazy(() => import('@/pages/newBenefit/IntakeConsole').then((m) => ({ default: m.IntakeConsole })));
const MedicalBoardHub = lazy(() => import('@/pages/newBenefit/MedicalBoardHub').then((m) => ({ default: m.MedicalBoardHub })));
const EmployerHub = lazy(() => import('@/pages/newBenefit/EmployerHub').then((m) => ({ default: m.EmployerHub })));
const PensionAdministration = lazy(() => import('@/pages/newBenefit/PensionAdministration').then((m) => ({ default: m.PensionAdministration })));
const PaymentsModule = lazy(() => import('@/pages/newBenefit/PaymentsModule').then((m) => ({ default: m.PaymentsModule })));
const LettersCommunications = lazy(() => import('@/pages/newBenefit/LettersCommunications'));
const AdminConfig = lazy(() => import('@/pages/newBenefit/AdminConfig'));
const AuditorView = lazy(() => import('@/pages/newBenefit/AuditorView'));

// Benefit Management Module (bn_)
const BenefitsDashboard = lazy(() => import('@/pages/bn/dashboard/BenefitsDashboard'));
const BnProductCatalog = lazy(() => import('@/pages/bn/config/ProductCatalog'));
const BnProductEditor = lazy(() => import('@/pages/bn/config/ProductEditor'));
const BnClaimWorklist = lazy(() => import('@/pages/bn/claims/ClaimWorklist'));
const BnClaim360 = lazy(() => import('@/pages/bn/claims/Claim360'));
const BnClaimWorkbench = lazy(() => import('@/pages/bn/claims/ClaimWorkbench'));
const BnCalculationEngine = lazy(() => import('@/pages/bn/engine/CalculationEngine'));
const BnBenefitDetermination = lazy(() => import('@/pages/bn/claims/BenefitDetermination'));
const BnClaimRegistration = lazy(() => import('@/pages/bn/intake/ClaimRegistration'));
const BnApprovalConsole = lazy(() => import('@/pages/bn/approval/ApprovalConsole'));
const BnApprovalWorkbasketsConsole = lazy(() => import('@/pages/bn/approval/ApprovalWorkbasketsConsole'));
const BnProductApprovalConsole = lazy(() => import('@/pages/bn/config/ProductApprovalConsole'));
const BnApprovalQueue = lazy(() => import('@/pages/bn/approval/ApprovalQueue'));
const BnAdjudicationWorkspace = lazy(() => import('@/pages/bn/approval/AdjudicationWorkspace'));
const BnEligibilityReview = lazy(() => import('@/pages/bn/claims/EligibilityReview'));
const BnCalculationWorkspace = lazy(() => import('@/pages/bn/engine/CalculationWorkspace'));
const BnDeterminationRecommendation = lazy(() => import('@/pages/bn/claims/DeterminationRecommendation'));
const BnEntitlementManagement = lazy(() => import('@/pages/bn/entitlement/EntitlementManagement'));
const BnPensionerRegister = lazy(() => import('@/pages/bn/awards/PensionerRegister'));
const BnAward360 = lazy(() => import('@/pages/bn/awards/Award360'));
const BnSurvivorAwards = lazy(() => import('@/pages/bn/awards/SurvivorAwards'));
const BnAwardAdjustments = lazy(() => import('@/pages/bn/awards/AwardAdjustments'));
const BnPayablesQueue = lazy(() => import('@/pages/bn/payables/PayablesQueue'));
const BnPaymentSchedule = lazy(() => import('@/pages/bn/schedule/PaymentScheduleManagement'));
const BnBatchOperations = lazy(() => import('@/pages/bn/batch/BatchOperations'));
const BnPaymentIssue = lazy(() => import('@/pages/bn/issue/PaymentIssue'));
const BnPostIssueReview = lazy(() => import('@/pages/bn/postissue/PostIssueReview'));
const BnChequeStock = lazy(() => import('@/pages/bn/admin/ChequeStock'));
const BnPaymentProfiles = lazy(() => import('@/pages/bn/admin/PaymentProfiles'));
const BnPaymentMasters = lazy(() => import('@/pages/bn/admin/PaymentMasters'));
const BnDiagnostics = lazy(() => import('@/pages/bn/admin/BenefitsDiagnostics'));
const BnSqlEditor = lazy(() => import('@/pages/bn/admin/BenefitsSqlEditor'));
const BnHistoricalInquiry = lazy(() => import('@/pages/bn/history/HistoricalInquiry'));
const BnClaimQueue = lazy(() => import('@/pages/bn/claims/ClaimQueue'));
const BnReasonCodes = lazy(() => import('@/pages/bn/config/ReasonCodes'));
const BnTransitionMatrix = lazy(() => import('@/pages/bn/config/TransitionMatrix'));
const BnWorkbasketConfig = lazy(() => import('@/pages/bn/config/WorkbasketConfig'));
const BnRoleBundles = lazy(() => import('@/pages/bn/config/RoleBundles'));
const BnDelegations = lazy(() => import('@/pages/bn/config/Delegations'));
const BnMyWorkbench = lazy(() => import('@/pages/bn/workbench/MyBenefitsWorkbench'));
const BnEscalationConfig = lazy(() => import('@/pages/bn/config/EscalationConfig'));
const BnWorkflowTemplateEditor = lazy(() => import('@/pages/bn/config/WorkflowTemplateEditor'));
const BnServiceDocTypes = lazy(() => import('@/pages/bn/config/ServiceDocTypes'));
const BnCountryPackPage = lazy(() => import('@/pages/bn/config/country/CountryPackPage'));
const BnCountryMaster = lazy(() => import('@/pages/bn/config/country/CountryMaster'));
const BnCountryIdRules = lazy(() => import('@/pages/bn/config/country/CountryIdRules'));
const BnCountryAddressModel = lazy(() => import('@/pages/bn/config/country/CountryAddressModel'));
const BnCountryParticipantTypes = lazy(() => import('@/pages/bn/config/country/CountryParticipantTypes'));
const BnCountryPaymentConfig = lazy(() => import('@/pages/bn/config/country/CountryPaymentConfig'));
const BnCountryLegalRefs = lazy(() => import('@/pages/bn/config/country/CountryLegalRefs'));
const BnRuleConfiguration = lazy(() => import('@/pages/bn/config/RuleConfiguration'));
const BnRuleCatalogue = lazy(() => import('@/pages/bn/config/RuleCatalogue'));
const BnRulesAdministration = lazy(() => import('@/pages/bn/config/RulesAdministration'));
const BnFormulaConfiguration = lazy(() => import('@/pages/bn/config/FormulaConfiguration'));
const BnCalculationSetup = lazy(() => import('@/pages/bn/config/CalculationSetup'));
const BnCalculationReadiness = lazy(() => import('@/pages/bn/config/CalculationReadiness'));
const BnDerivedFactRegistry = lazy(() => import('@/pages/bn/config/DerivedFactRegistry'));
const BnProductParameterRegistry = lazy(() => import('@/pages/bn/config/ProductParameterRegistry'));
const BnGridDemo = lazy(() => import('@/pages/bn/_GridDemo'));
const BnDocumentSetup = lazy(() => import('@/pages/bn/config/DocumentSetup'));
const BnScreenMetadataSetup = lazy(() => import('@/pages/bn/config/ScreenMetadataSetup'));
const BnBenefitConfigurationValidation = lazy(() => import('@/pages/bn/config/BenefitConfigurationValidation'));
const BnBenefitCommunicationTemplates = lazy(() => import('@/pages/bn/config/BenefitCommunicationTemplates'));
const BnReferenceDataAdmin = lazy(() => import('@/pages/bn/config/ReferenceDataAdmin'));
// Medical Benefit Setup
const BnMedicalSetupHome = lazy(() => import('@/pages/bn/config/medical/MedicalSetupHome'));
const BnMedicalProceduresCatalog = lazy(() => import('@/pages/bn/config/medical/MedicalProceduresCatalog'));
const BnFacilityAvailabilityMatrix = lazy(() => import('@/pages/bn/config/medical/FacilityAvailabilityMatrix'));
const BnReferralRulesPage = lazy(() => import('@/pages/bn/config/medical/ReferralRulesPage'));
const BnReimbursementLimitsPage = lazy(() => import('@/pages/bn/config/medical/ReimbursementLimitsPage'));
const BnExpenseTypeConfiguration = lazy(() => import('@/pages/bn/config/medical/ExpenseTypeConfiguration'));
const BnMedicalReviewRulesPage = lazy(() => import('@/pages/bn/config/medical/MedicalReviewRulesPage'));
const BnMedicalDocumentsPage = lazy(() => import('@/pages/bn/config/medical/MedicalDocumentsPage'));
const BnSimulationDashboard = lazy(() => import('@/pages/bn/simulation/SimulationDashboard'));
const BnScenarioBuilder = lazy(() => import('@/pages/bn/simulation/ScenarioBuilder'));
const BnRunSimulation = lazy(() => import('@/pages/bn/simulation/RunSimulation'));
const BnSimulationResult = lazy(() => import('@/pages/bn/simulation/SimulationResultSummary'));
const BnPerson360 = lazy(() => import('@/pages/bn/person360/BnPerson360'));
const BnPaymentExceptions = lazy(() => import('@/pages/bn/issue/PaymentExceptions'));
const BnPostIssueEnhanced = lazy(() => import('@/pages/bn/postissue/PostIssueEnhanced'));
const BnClaimWorklistEnhanced = lazy(() => import('@/pages/bn/claims/ClaimWorklistEnhanced'));
const BnPaymentHistoryInquiry = lazy(() => import('@/pages/bn/history/PaymentHistoryInquiry'));
const BnAuditDecisionHistory = lazy(() => import('@/pages/bn/history/AuditDecisionHistory'));
const BnLifeCertificateManagement = lazy(() => import('@/pages/bn/servicing/LifeCertificateManagement'));
const BnMedicalReviewScheduler = lazy(() => import('@/pages/bn/servicing/MedicalReviewScheduler'));
const BnOverpaymentRecovery = lazy(() => import('@/pages/bn/servicing/OverpaymentRecovery'));
const BnMortalityPage = lazy(() => import('@/pages/bn/mortality/BnMortalityPage'));
const BnMortalityRegistrationPage = lazy(() => import('@/pages/bn/mortality/BnMortalityRegistrationPage'));
const BnMortalityDetailPage = lazy(() => import('@/pages/bn/mortality/BnMortalityDetailPage'));
const BnAppealsWorkspacePage = lazy(() => import('@/pages/bn/appeals/BnAppealsWorkspacePage'));
const BnAppealDetailPage = lazy(() => import('@/pages/bn/appeals/BnAppealDetailPage'));
const BnAppealNewPreviewPage = lazy(() => import('@/pages/bn/appeals/BnAppealNewPreviewPage'));
const BnAppealMyWorkPage = lazy(() => import('@/pages/bn/appeals/BnAppealMyWorkPage'));
const BnAppealHearingsPage = lazy(() => import('@/pages/bn/appeals/BnAppealHearingsPage'));
const BnAppealImplementationPage = lazy(() => import('@/pages/bn/appeals/BnAppealImplementationPage'));
const BnAppealConfigPage = lazy(() => import('@/pages/bn/appeals/BnAppealConfigPage'));
const BnMeansTestsPage = lazy(() => import('@/pages/bn/meansTests/BnMeansTestsPage'));
const BnRiskManagementPage = lazy(() => import('@/pages/bn/risk/BnRiskManagementPage'));
const BnUpratingPage = lazy(() => import('@/pages/bn/uprating/BnUpratingPage'));
const BnAwardSuspensionConsole = lazy(() => import('@/pages/bn/servicing/AwardSuspensionConsole'));
const BnSurvivorsBenefitProcessing = lazy(() => import('@/pages/bn/servicing/SurvivorsBenefitProcessing'));

// SSB Legal Module - already imported above
const CaseIntakeWizard = lazy(() => import('@/pages/legal/CaseIntakeWizard'));

// BeMA Compliance - deprecated, routes redirect to /compliance/*
const IATemplatesManagement = lazy(() => import("@/pages/audit/TemplatesManagement"));

// Authentication
const DummyLoginPage = lazy(() => import('@/pages/auth/DummyLoginPage'));
const ForgotPassword = lazy(() => import('@/pages/auth/ForgotPassword').then((m) => ({ default: m.ForgotPassword })));
const ResetPassword = lazy(() => import('@/pages/auth/ResetPassword').then((m) => ({ default: m.ResetPassword })));
const ChangePasswordPage = lazy(() => import('@/pages/auth/ChangePassword').then((m) => ({ default: m.ChangePassword })));
const MFAVerify = lazy(() => import('@/pages/auth/MFAVerify'));
const BootstrapAdmin = lazy(() => import('@/pages/setup/BootstrapAdmin'));

// Foundation Components Demo
const FoundationComponentsDemo = lazy(() => import('@/pages/FoundationComponentsDemo'));
const FeeConfiguration = lazy(() => import('@/pages/admin/FeeConfiguration'));
const IPCardConfiguration = lazy(() => import('@/pages/admin/IPCardConfiguration'));
const KnowledgeBaseAdmin = lazy(() => import('@/pages/admin/settings/KnowledgeBaseAdmin'));

// Report Pages
const InsuredPersonsSummaryReport = lazy(() => import('@/pages/reports/insured-persons/InsuredPersonsSummaryReport'));
const CoverageByAgeReport = lazy(() => import('@/pages/reports/insured-persons/CoverageByAgeReport'));
const ContributionHistoryReport = lazy(() => import('@/pages/reports/insured-persons/ContributionHistoryReport'));
const RegisteredSummaryReport = lazy(() => import('@/pages/reports/employers/RegisteredSummaryReport'));
const ActiveInactiveReport = lazy(() => import('@/pages/reports/employers/ActiveInactiveReport'));
const ContributionComplianceReport = lazy(() => import('@/pages/reports/employers/ContributionComplianceReport'));
const NonPaying3MonthsReport = lazy(() => import('@/pages/reports/employers/NonPaying3MonthsReport'));
const NonPaying6MonthsReport = lazy(() => import('@/pages/reports/employers/NonPaying6MonthsReport'));
const NonPaying9MonthsReport = lazy(() => import('@/pages/reports/employers/NonPaying9MonthsReport'));
const TopMissingC3Report = lazy(() => import('@/pages/reports/employers/TopMissingC3Report'));
const MissingC3PerZoneReport = lazy(() => import('@/pages/reports/employers/MissingC3PerZoneReport'));
const C3WithoutPaymentReport = lazy(() => import('@/pages/reports/employers/C3WithoutPaymentReport'));
const NoPaymentPerZoneReport = lazy(() => import('@/pages/reports/employers/NoPaymentPerZoneReport'));
const EmployeeTurnoverReport = lazy(() => import('@/pages/reports/employers/EmployeeTurnoverReport'));
const ByEmployeeCountReport = lazy(() => import('@/pages/reports/employers/ByEmployeeCountReport'));
const ByMonthlyContributionsReport = lazy(() => import('@/pages/reports/employers/ByMonthlyContributionsReport'));
const ByArrearsReport = lazy(() => import('@/pages/reports/employers/ByArrearsReport'));
const ByWaiversReport = lazy(() => import('@/pages/reports/employers/ByWaiversReport'));
const WaiversPerZoneReport = lazy(() => import('@/pages/reports/employers/WaiversPerZoneReport'));
const EmployeesPerZoneReport = lazy(() => import('@/pages/reports/employers/EmployeesPerZoneReport'));
const ContributionsPerZoneReport = lazy(() => import('@/pages/reports/employers/ContributionsPerZoneReport'));
const QueriesPerZoneReport = lazy(() => import('@/pages/reports/employers/QueriesPerZoneReport'));
const MostQueriesReport = lazy(() => import('@/pages/reports/employers/MostQueriesReport'));
const ByLitigationCountReport = lazy(() => import('@/pages/reports/employers/ByLitigationCountReport'));
const ArrearsPerZoneReport = lazy(() => import('@/pages/reports/employers/ArrearsPerZoneReport'));
const ArrearsOver50kReport = lazy(() => import('@/pages/reports/employers/ArrearsOver50kReport'));
const ArrearsOver100kReport = lazy(() => import('@/pages/reports/employers/ArrearsOver100kReport'));
const ArrearsOver200kReport = lazy(() => import('@/pages/reports/employers/ArrearsOver200kReport'));
const ArrearsOver300kReport = lazy(() => import('@/pages/reports/employers/ArrearsOver300kReport'));
const ArrearsOver400kReport = lazy(() => import('@/pages/reports/employers/ArrearsOver400kReport'));
const Arrears50kByZoneReport = lazy(() => import('@/pages/reports/employers/Arrears50kByZoneReport'));
const TopCompliantReport = lazy(() => import('@/pages/reports/employers/TopCompliantReport'));
const Arrears30DaysReport = lazy(() => import('@/pages/reports/employers/Arrears30DaysReport'));
const Arrears60DaysReport = lazy(() => import('@/pages/reports/employers/Arrears60DaysReport'));
const Arrears90DaysReport = lazy(() => import('@/pages/reports/employers/Arrears90DaysReport'));
const ArrearsOver90DaysReport = lazy(() => import('@/pages/reports/employers/ArrearsOver90DaysReport'));
const UnderLitigationReport = lazy(() => import('@/pages/reports/employers/UnderLitigationReport'));
const WithPaymentPlansReport = lazy(() => import('@/pages/reports/employers/WithPaymentPlansReport'));
const DefaultedPlansReport = lazy(() => import('@/pages/reports/employers/DefaultedPlansReport'));
const CeasedEmployersReport = lazy(() => import('@/pages/reports/employers/CeasedEmployersReport'));
const OutOfFederationReport = lazy(() => import('@/pages/reports/employers/OutOfFederationReport'));
const DeceasedEmployersReport = lazy(() => import('@/pages/reports/employers/DeceasedEmployersReport'));
const OverseasSubmissionsReport = lazy(() => import('@/pages/reports/employers/OverseasSubmissionsReport'));
const NILReturns3MonthsReport = lazy(() => import('@/pages/reports/employers/NILReturns3MonthsReport'));
const NILReturnsOver3MonthsReport = lazy(() => import('@/pages/reports/employers/NILReturnsOver3MonthsReport'));
const MonthlyCollectionsReport = lazy(() => import('@/pages/reports/c3/MonthlyCollectionsReport'));
const ArrearsReport = lazy(() => import('@/pages/reports/c3/ArrearsReport'));
const TopContributorsReport = lazy(() => import('@/pages/reports/c3/TopContributorsReport'));
const ContributionsVsBenefitsReport = lazy(() => import('@/pages/reports/finance/ContributionsVsBenefitsReport'));
const CashFlowReport = lazy(() => import('@/pages/reports/finance/CashFlowReport'));
const InvestmentPortfolioReport = lazy(() => import('@/pages/reports/finance/InvestmentPortfolioReport'));
const PaymentsByTypeReport = lazy(() => import('@/pages/reports/benefits/PaymentsByTypeReport'));
const ClaimsVolumeReport = lazy(() => import('@/pages/reports/benefits/ClaimsVolumeReport'));
const OverpaymentsReport = lazy(() => import('@/pages/reports/benefits/OverpaymentsReport'));
const EmployerStatusReport = lazy(() => import('@/pages/reports/compliance/EmployerStatusReport'));
const EngagementSummaryReport = lazy(() => import('@/pages/reports/audit/EngagementSummaryReport'));
const CommunicationComplianceReport = lazy(() => import('@/pages/reports/audit/CommunicationComplianceReport'));
const PlanSlippageReport = lazy(() => import('@/pages/reports/audit/PlanSlippageReport'));
const OverdueActionsReport = lazy(() => import('@/pages/reports/audit/OverdueActionsReport'));
const CarryForwardAgingReport = lazy(() => import('@/pages/reports/audit/CarryForwardAgingReport'));
const AccountRolesReport = lazy(() => import('@/pages/reports/admin/AccountRolesReport'));
const PermissionChangesReport = lazy(() => import('@/pages/reports/admin/PermissionChangesReport'));
const ConfigurationAuditReport = lazy(() => import('@/pages/reports/admin/ConfigurationAuditReport'));

// Finance Module
const FinanceDashboard = lazy(() => import('@/pages/finance/FinanceDashboard'));
const BatchManagement = lazy(() => import('@/pages/finance/BatchManagement'));
const PaymentEntry = lazy(() => import('@/pages/finance/PaymentEntry'));
const ReceiptSearch = lazy(() => import('@/pages/finance/ReceiptSearch'));
const InvoiceManagement = lazy(() => import('@/pages/finance/InvoiceManagement'));
const GLExport = lazy(() => import('@/pages/finance/GLExport'));
const DailyReports = lazy(() => import('@/pages/finance/DailyReports'));
const ReversalsAndPenalties = lazy(() => import('@/pages/finance/ReversalsAndPenalties'));
const AdminConfiguration = lazy(() => import('@/pages/finance/AdminConfiguration'));
const FinanceUserManagement = lazy(() => import('@/pages/finance/UserManagement'));
const IncomeCategoryManagement = lazy(() => import('@/pages/admin/IncomeCategoryManagement'));
const SepContribRateManagement = lazy(() => import('@/pages/admin/SepContribRateManagement'));
const IncomeCodeManagement = lazy(() => import('@/pages/admin/IncomeCodeManagement'));

// Master Data CRUD Pages
const ActivityManagement = lazy(() => import('@/pages/admin/master-data/ActivityManagement'));
const BankCodeManagement = lazy(() => import('@/pages/admin/master-data/BankCodeManagement'));
const BatchStatusManagement = lazy(() => import('@/pages/admin/master-data/BatchStatusManagement'));
const PayPeriodManagement = lazy(() => import('@/pages/admin/master-data/PayPeriodManagement'));
const C3StatusManagement = lazy(() => import('@/pages/admin/master-data/C3StatusManagement'));
const CountryManagement = lazy(() => import('@/pages/admin/master-data/CountryManagement'));
const DependentRelationManagement = lazy(() => import('@/pages/admin/master-data/DependentRelationManagement'));
const DistrictManagement = lazy(() => import('@/pages/admin/master-data/DistrictManagement'));
const EyeColorManagement = lazy(() => import('@/pages/admin/master-data/EyeColorManagement'));
const IndustryManagement = lazy(() => import('@/pages/admin/master-data/IndustryManagement'));
const InspectorMDManagement = lazy(() => import('@/pages/admin/master-data/InspectorManagement'));
const InvoiceStatusMDManagement = lazy(() => import('@/pages/admin/master-data/InvoiceStatusManagement'));
const InvoiceTypesMDManagement = lazy(() => import('@/pages/admin/master-data/InvoiceTypesManagement'));
const LegalStatusManagement = lazy(() => import('@/pages/admin/master-data/LegalStatusManagement'));
const MaritalStatusManagement = lazy(() => import('@/pages/admin/master-data/MaritalStatusManagement'));
const MerchantManagement = lazy(() => import('@/pages/admin/master-data/MerchantManagement'));
const MethodOfPaymentManagement = lazy(() => import('@/pages/admin/master-data/MethodOfPaymentManagement'));
const OccupationManagement = lazy(() => import('@/pages/admin/master-data/OccupationManagement'));
const PayerTypeManagement = lazy(() => import('@/pages/admin/master-data/PayerTypeManagement'));
const PaymentSourcesManagement = lazy(() => import('@/pages/admin/master-data/PaymentSourcesManagement'));
const PaymentTypeMDManagement = lazy(() => import('@/pages/admin/master-data/PaymentTypeManagement'));
const PenaltyMDManagement = lazy(() => import('@/pages/admin/master-data/PenaltyManagement'));
const PostalDistrictManagement = lazy(() => import('@/pages/admin/master-data/PostalDistrictManagement'));
const ReceiptStatusManagement = lazy(() => import('@/pages/admin/master-data/ReceiptStatusManagement'));
const RelationManagement = lazy(() => import('@/pages/admin/master-data/RelationManagement'));
const SectorManagement = lazy(() => import('@/pages/admin/master-data/SectorManagement'));
const SscRatesManagement = lazy(() => import('@/pages/admin/master-data/SscRatesManagement'));
const VcContribRateManagement = lazy(() => import('@/pages/admin/master-data/VcContribRateManagement'));
const VcEligibilityConfigManagement = lazy(() => import('@/pages/admin/master-data/VcEligibilityConfigManagement'));
const VerifyManagement = lazy(() => import('@/pages/admin/master-data/VerifyManagement'));
const VillagesManagement = lazy(() => import('@/pages/admin/master-data/VillagesManagement'));
const DesignationMasterManagement = lazy(() => import('@/pages/admin/master-data/DesignationMasterManagement'));

// Contribution Payments Module
const PaymentDataEntry = lazy(() => import('@/pages/cashier/PaymentDataEntry'));
const PaymentHistoricalEntry = lazy(() => import('@/pages/cashier/PaymentHistoricalEntry'));
const PaymentHistoryManagement = lazy(() => import('@/pages/cashier/PaymentHistoryManagement'));
const TransferPayments = lazy(() => import('@/pages/cashier/TransferPayments'));
const PaymentHistoryReport = lazy(() => import('@/pages/cashier/PaymentHistoryReport'));
const VCPaymentUpdate = lazy(() => import('@/pages/cashier/VCPaymentUpdate'));

export const AppRoutes = () => {
  // Phase 1: bootstrap DB-backed compliance.* feature flags into the
  // runtime cache so isComplianceFeatureEnabled / isComplianceDbFlagEnabled
  // can return the canonical DB values. Mounted once at app root.
  useComplianceFeatureFlagsBootstrap();
  return (
    <Suspense fallback={<div className="min-h-screen w-full flex items-center justify-center bg-background text-sm text-muted-foreground">Loading…</div>}>
    <Routes>
      <Route path="/login" element={<LoginScreen />} />
      <Route path="/acknowledge-audit/:token" element={<AuditReportAcknowledgePage />} />
      <Route path="/setup" element={<BootstrapAdmin />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route path="/change-password" element={<ChangePasswordPage />} />
      <Route path="/mfa-verify" element={<MFAVerify />} />
      <Route path="/inspector/login" element={<InspectorLogin />} />
      <Route path="/public/api-docs" element={<PublicApiDocs />} />
      <Route path="/public/benefit/:productCode" element={<PublicBenefitApplication />} />
      <Route path="/public/uat-downloads" element={<UatDownloadsPublic />} />
      <Route path="/uat-downloads" element={<Navigate to="/public/uat-downloads" replace />} />

      {/* Public website */}
      <Route path="/public" element={<PublicLayout />}>
        <Route index element={<PublicHome />} />
        <Route path="services" element={<PublicServices />} />
        <Route path="benefits" element={<PublicBenefits />} />
        <Route path="contributions" element={<PublicContributions />} />
        <Route path="employers" element={<PublicEmployers />} />
        <Route path="medical-providers" element={<PublicMedicalProviders />} />
        <Route path="contact" element={<PublicContact />} />
        <Route path="help" element={<PublicHelp />} />
        <Route path="login" element={<PublicLogin />} />
      </Route>
      <Route path="/public/register" element={<RegisterWizard />} />

      
      {/* Inspector Routes */}
      <Route path="/inspector" element={<InspectorLayout />}>
        <Route path="dashboard" element={<InspectorDashboard />} />
        <Route path="plan" element={<Suspense fallback={<div>Loading...</div>}><InspectorWeeklyPlan /></Suspense>} />
        <Route path="activities" element={<Suspense fallback={<div>Loading...</div>}><InspectorActivities /></Suspense>} />
        <Route path="violations" element={<Suspense fallback={<div>Loading...</div>}><InspectorViolations /></Suspense>} />
        <Route path="violations/record" element={<Suspense fallback={<div>Loading...</div>}><RecordViolationForm /></Suspense>} />
        <Route path="reports" element={<Suspense fallback={<div>Loading...</div>}><InspectorReports /></Suspense>} />
      </Route>
      <Route path="/demo-login" element={<DummyLoginPage />} />
      {/* Protected routes — single parent layout keeps Sidebar/Header mounted across navigations */}
      <Route element={<ProtectedLayout />}>
      <Route path="/components-demo" element={<FoundationComponentsDemo />} />
      
      {/* Dashboard */}
      <Route path="/" element={<Index />} />

      {/* Embedded satellite micro-frontends (iframe + postMessage bridge).
          When a satellite has no base URL configured, fall back to the local
          /compliance/* or /audit/* routes instead of mounting an empty iframe. */}
      <Route
        path="/compliance-hub/*"
        element={
          isComplianceRemoteEnabled() ? (
              <Suspense fallback={<div>Loading...</div>}>
                <SatelliteFrame app="compliance" basePath="compliance-hub" title="Compliance & Enforcement" />
              </Suspense>
          ) : (
            <Navigate to="/compliance" replace />
          )
        }
      />
      <Route
        path="/audit-hub/*"
        element={
          isAuditRemoteEnabled() ? (
              <Suspense fallback={<div>Loading...</div>}>
                <SatelliteFrame app="audit" basePath="audit-hub" title="Internal Audit" />
              </Suspense>
          ) : (
            <Navigate to="/audit" replace />
          )
        }
      />
      
      {/* Employers Management Routes */}
      <Route path="/employers-management/dashboard" element={<EmployersDashboard />} />
      <Route path="/employers-management/manage" element={<ManageEmployers />} />
      <Route path="/employers-management/add" element={<AddEmployer />} />
      <Route path="/employers-management/view/:regNo" element={<ViewEmployer />} />
      <Route path="/employers-management/edit/:regNo" element={<EditEmployer />} />
      <Route path="/employers-management/reports" element={<EmployersReports />} />
      <Route path="/employers-management/pending-verification" element={<PendingVerificationPage />} />

      {/* C3 Management Routes */}
      <Route path="/c3-management/dashboard" element={<C3Dashboard />} />
      <Route path="/c3-management/manage" element={<C3Management />} />
      <Route path="/c3-management/add" element={<C3InputForm />} />
      

      <Route path="/c3-management/input-form" element={<C3InputForm />} />
      <Route path="/c3-management/reports" element={<C3Reports />} />
      <Route path="/c3-management/verification" element={<C3Verification />} />
      <Route path="/c3-management/configure-electronic-c3" element={<ElectronicC3Config />} />
      <Route path="/c3-management/view/:id" element={<ViewC3Record />} />
      <Route path="/c3-management/edit/:id" element={<EditC3Record />} />
      <Route path="/c3-management/simulation" element={<C3Simulation />} />
      
      {/* C3 Wizard Admin - Employer Management Routes */}
      <Route path="/c3-management/employer-details" element={<WizEmployerList />} />
      <Route path="/c3-management/employer-details/:companyId" element={<WizEmployerDetailsEdit />} />
      <Route path="/c3-management/employer-users/:companyId" element={<WizCompanyUsers />} />
      <Route path="/c3-management/employer-employees/:companyId" element={<WizEmployeeList />} />
      
      {/* C3 Wizard Admin - Self-Employed Management Routes */}
      <Route path="/c3-management/self-employed-details" element={<WizSelfEmployedList />} />
      <Route path="/c3-management/self-employed-details/:selfEmployedId" element={<WizSelfEmployedDetailsEdit />} />
      <Route path="/c3-management/self-employed-user/:userId" element={<WizSelfEmployedUserEdit />} />

      {/* C3 Wizard Admin - Manage Users Module */}
      <Route path="/c3-management/users/employers" element={<WizEmployerUsers />} />
      <Route path="/c3-management/users/self-employed" element={<WizSelfEmployedUsers />} />
      <Route path="/c3-management/users/role-permission" element={<WizRolePermission />} />
      <Route path="/c3-management/users/role-master" element={<WizRoleMaster />} />

      {/* C3 Details - Contribution Screens */}
      <Route path="/c3-management/c3-contribution" element={<C3ContributionList />} />
      <Route path="/c3-management/nw-director" element={<NwDirectorList />} />
      <Route path="/c3-management/self-employed-c3" element={<SelfEmployedContributionList />} />
      <Route path="/c3-management/offline-payment/:entityType/:headerId" element={<OfflinePaymentPage />} />

      {/* C3 Wizard Admin - Payment Details Route */}
      <Route path="/c3-management/payment-details" element={<WizPaymentDetails />} />
      <Route path="/c3-management/payments" element={<WizPaymentDetails />} />
      
      {/* C3 Settings Routes */}
      <Route path="/c3-management/settings/levy/schemes" element={<LevySchemesList />} />
      <Route path="/c3-management/settings/levy/schemes/:schemeId" element={<LevySchemeDetail />} />
      <Route path="/c3-management/settings/levy/simulator" element={<LevySimulator />} />
      <Route path="/c3-management/settings/ss/schemes" element={<SSSchemesList />} />
      <Route path="/c3-management/settings/ss/schemes/:schemeId" element={<SSSchemeDetail />} />
      <Route path="/c3-management/settings/ss/simulator" element={<SSSimulator />} />
      <Route path="/c3-management/settings/severance/schemes" element={<SeveranceSchemesList />} />
      <Route path="/c3-management/settings/severance/schemes/:schemeId" element={<SeveranceSchemeDetail />} />
      <Route path="/c3-management/settings/severance/simulator" element={<SeveranceSimulator />} />
      <Route path="/c3-management/settings/injury/schemes" element={<InjurySchemesList />} />
      <Route path="/c3-management/settings/injury/schemes/:schemeId" element={<InjurySchemeDetail />} />
      <Route path="/c3-management/settings/injury/simulator" element={<InjurySimulator />} />
      <Route path="/c3-management/settings/c3file/formats" element={<C3FormatsList />} />
      <Route path="/c3-management/settings/c3file/formats/:formatId" element={<C3FormatDetail />} />
      <Route path="/c3-management/settings/cybersource" element={<Navigate to="/c3-management/settings-configuration" replace />} />
      <Route path="/c3-management/settings-configuration" element={<SettingsConfiguration />} />
      <Route path="/c3-management/email-templates" element={<Navigate to="/admin/notification-templates?tab=core&module=PAYMENTS&type=EMAIL&channel=EMAIL" replace />} />
      <Route path="/c3-management/reconciliation" element={<ReconciliationPage />} />

      {/* C3 Wizard Admin - Reports Routes */}
      <Route path="/c3-management/reports/employer-history" element={<WizEmployerHistory />} />
      <Route path="/c3-management/reports/self-employed-history" element={<WizSelfEmployedHistory />} />
      <Route path="/c3-management/reports/payments-history" element={<WizPaymentsHistory />} />
      <Route path="/c3-management/reports/reconciliation-history" element={<WizReconciliationHistory />} />
      <Route path="/c3-management/reports/users-history" element={<WizUsersHistory />} />

      <Route path="/self-employed/manage" element={<ManageSelfEmployed />} />
      <Route path="/self-employed/add" element={<AddSelfEmployed />} />
      <Route path="/self-employed/reports" element={<SelfEmployedReports />} />

      {/* ═══════════════════════════════════════════════════════════════
          COMPLIANCE MODULE — Canonical Routes (new structure)
          ═══════════════════════════════════════════════════════════════ */}

      {/* ── Compliance — wired leaf routes (close menu/route gap) ── */}
      <Route path="/compliance/inspections/evidence" element={<ComplianceFeatureGate flagKey="compliance.inspection.evidence" title="Inspection Evidence"><InspectionEvidencePage /></ComplianceFeatureGate>} />
      <Route path="/compliance/inspections/convert-finding" element={<ComplianceFeatureGate flagKey="compliance.inspection.convert_finding" title="Convert Finding To Violation"><ConvertFindingToViolationPage /></ComplianceFeatureGate>} />
      <Route path="/compliance/violations/verification-queue" element={<ComplianceFeatureGate flagKey="compliance.core.verification_queue" title="Verification Queue"><VerificationQueue /></ComplianceFeatureGate>} />
      <Route path="/compliance/violations/rule-detected" element={<RuleDetectedViolations />} />
      <Route path="/compliance/violations/duplicate-review" element={<DuplicateReview />} />
      <Route path="/compliance/violations/history" element={<ViolationHistory />} />
      <Route path="/compliance/cases/intake" element={<ComplianceCaseIntake />} />
      <Route path="/compliance/cases/assigned" element={<AssignedCases />} />
      <Route path="/compliance/cases/merge-review" element={<ComplianceFeatureGate flagKey="compliance.core.case_merge" title="Case Merge Review"><CaseMergeReviewPage /></ComplianceFeatureGate>} />
      <Route path="/compliance/cases/reopen-requests" element={<ComplianceFeatureGate flagKey="compliance.core.case_reopen" title="Reopen Requests"><ReopenRequestsPage /></ComplianceFeatureGate>} />
      <Route path="/compliance/cases/closure" element={<ComplianceFeatureGate flagKey="compliance.core.case_closure_approval" title="Case Closure Approval"><CaseClosurePage /></ComplianceFeatureGate>} />
      <Route path="/compliance/legal/pack-preparation" element={<ComplianceFeatureGate flagKey="compliance.legal.pack_generation" title="Legal Pack Preparation"><LegalPackPreparationPage /></ComplianceFeatureGate>} />
      <Route path="/compliance/legal/approved-escalations" element={<ComplianceFeatureGate flagKey="compliance.legal.handoff" title="Approved Escalations"><ApprovedEscalationsPage /></ComplianceFeatureGate>} />
      <Route path="/compliance/legal/returned-from-legal" element={<ComplianceFeatureGate flagKey="compliance.legal.returned_handling" title="Returned From Legal"><ReturnedFromLegalPage /></ComplianceFeatureGate>} />
      <Route path="/compliance/risk/score-details" element={<ComplianceFeatureGate flagKey="compliance.risk.scoring" title="Risk Score Details"><RiskScoreDetailsPage /></ComplianceFeatureGate>} />
      <Route path="/compliance/risk/repeat-defaulters" element={<ComplianceFeatureGate flagKey="compliance.risk.scoring" title="Repeat Defaulters"><RepeatDefaultersPage /></ComplianceFeatureGate>} />
      <Route path="/compliance/risk/high-risk" element={<ComplianceFeatureGate flagKey="compliance.risk.scoring" title="High Risk Employers"><HighRiskEmployersPage /></ComplianceFeatureGate>} />
      <Route path="/compliance/risk/watchlist" element={<ComplianceFeatureGate flagKey="compliance.risk.scoring" title="Risk Watchlist"><WatchlistPage /></ComplianceFeatureGate>} />
      <Route path="/compliance/reports/automation-jobs" element={<ComplianceFeatureGate flagKey="compliance.risk.automation_jobs" title="Automation Job Reports"><AutomationJobReports /></ComplianceFeatureGate>} />


      {/* ── Workbench ── */}
      <Route path="/compliance/workbench" element={<WorkbenchLanding />} />
      <Route path="/compliance/my-work-queue" element={<ComplianceMyWorkQueue />} />
      <Route path="/compliance/workbench/manager" element={<ComplianceManagerDashboard />} />
      <Route path="/compliance/workbench/inspector" element={<ComplianceInspectorDashboard />} />
      <Route path="/compliance/workbench/legal" element={<ComplianceLegalDashboard />} />
      <Route path="/compliance/workbench/analytics" element={<ComplianceAnalytics />} />
      <Route path="/compliance/workbench/monitoring" element={<ComplianceMonitoring />} />
      <Route path="/compliance/workbench/queues" element={<AssignmentQueues />} />
      <Route path="/compliance/workbench/review-queue" element={<ReviewQueue />} />
      <Route path="/compliance/workbench/reassignment" element={<Reassignment />} />

      {/* ── Violations ── */}
      <Route path="/compliance/violations" element={<ViolationsManagement />} />
      <Route path="/compliance/violations/manual-entry" element={<ManualViolationEntry />} />
      <Route path="/compliance/violations/:id" element={<ViolationDetails />} />

      {/* ── Cases ── */}
      <Route path="/compliance/cases" element={<ComplianceCaseManagement />} />
      <Route path="/compliance/cases/queue" element={<ComplianceCaseQueue />} />
      <Route path="/compliance/cases/penalties" element={<PenaltyManagement />} />
      <Route path="/compliance/cases/:id" element={<ComplianceCaseDetailView />} />

      {/* ── Field — planning, execution, inspections, employer views ── */}
      <Route path="/compliance/field/plan-builder" element={<ComplianceFeatureGate flagKey="compliance.inspection.planning" title="Inspection Planning"><WeeklyPlanBuilder /></ComplianceFeatureGate>} />
      <Route path="/compliance/field/plan-builder-v2" element={<ComplianceFeatureGate flagKey="compliance.inspection.planning" title="Inspection Planning"><WeeklyPlanBuilderV2 /></ComplianceFeatureGate>} />
      <Route path="/compliance/field/plan-builder-v3" element={<ComplianceFeatureGate flagKey="compliance.inspection.planning" title="Inspection Planning"><WeeklyPlanBuilderV3 /></ComplianceFeatureGate>} />
      <Route path="/compliance/field/approval-inbox" element={<ComplianceFeatureGate flagKey="compliance.inspection.planning" title="Plan Approval Inbox"><PlannerApprovalInbox /></ComplianceFeatureGate>} />
      <Route path="/approval/inbox" element={<PlannerApprovalInbox />} />
      <Route path="/approval/decide" element={<PlannerApprovalDecidePage />} />
      <Route path="/compliance/field/revisions-pending" element={<ComplianceFeatureGate flagKey="compliance.inspection.planning" title="Plan Revisions Pending"><RevisionsPending /></ComplianceFeatureGate>} />
      <Route path="/compliance/field/revision-review/:revisionId" element={<ComplianceFeatureGate flagKey="compliance.inspection.planning" title="Plan Revision Review"><PlanRevisionReview /></ComplianceFeatureGate>} />
      <Route path="/compliance/field/my-plans" element={<ComplianceFeatureGate flagKey="compliance.inspection.planning" title="My Inspection Plans"><MyPlans /></ComplianceFeatureGate>} />
      <Route path="/compliance/field/pending-review" element={<ComplianceFeatureGate flagKey="compliance.inspection.planning" title="Plans Pending Review"><CompliancePendingReview /></ComplianceFeatureGate>} />
      <Route path="/compliance/field/pending-review/:planId" element={<ComplianceFeatureGate flagKey="compliance.inspection.planning" title="Plan Review"><WeeklyPlanReview /></ComplianceFeatureGate>} />
      <Route path="/compliance/field/execution" element={<ComplianceFeatureGate flagKey="compliance.inspection.field" title="Field Inspection Execution"><FieldExecution /></ComplianceFeatureGate>} />
      <Route path="/compliance/field/operations" element={<ComplianceFeatureGate flagKey="compliance.inspection.field" title="Field Operations"><FieldOperations /></ComplianceFeatureGate>} />
      <Route path="/compliance/field/inspections" element={<ComplianceFeatureGate flagKey="compliance.inspection.field" title="Inspection Management"><ComplianceInspectionManagement /></ComplianceFeatureGate>} />
      <Route path="/compliance/field/findings" element={<ComplianceFeatureGate flagKey="compliance.inspection.field" title="Field Inspection Findings"><EmployerFindings /></ComplianceFeatureGate>} />
      <Route path="/compliance/field/employer-statements" element={<ComplianceFeatureGate flagKey="compliance.inspection.field" title="Field Inspection — Employer Statements"><EmployerStatements /></ComplianceFeatureGate>} />
      <Route path="/compliance/field/employer-statement/:employerId" element={<ComplianceFeatureGate flagKey="compliance.inspection.field" title="Field Inspection — Employer Statement"><EmployerStatementDetail /></ComplianceFeatureGate>} />
      <Route path="/compliance/field/visit/:employerId" element={<ComplianceFeatureGate flagKey="compliance.inspection.field" title="Field Inspection Visit"><EmployerVisitWorkspace /></ComplianceFeatureGate>} />

      <Route path="/compliance/field/employer-360" element={<Employer360Search />} />
      <Route path="/compliance/field/employer-360/:employerId" element={<Employer360 />} />
      <Route path="/compliance/field/employer-risk/:employerId" element={<EmployerRiskProfile />} />
      <Route path="/compliance/employers/management" element={<EmployerComplianceManagement />} />
      <Route path="/compliance/employers/hierarchy" element={<EmployerHierarchy />} />
      <Route path="/compliance/employers/financial-statement/:employerId" element={<EmployerFinancialStatement />} />
      <Route path="/compliance/field/audit-management" element={<AuditManagement />} />
      <Route path="/compliance/field/weekly-report" element={<WeeklyReportSubmission />} />
      <Route path="/compliance/field/weekly-reports" element={<WeeklyReports />} />
      <Route path="/compliance/field/all-reports" element={<AllWeeklyReports />} />
      <Route path="/compliance/field/execution-dashboard/:planId" element={<PlanExecutionDashboard />} />
      <Route path="/compliance/field/execution-dashboard/:planId/visit/:planItemId" element={<AuditVisitWorkspace />} />
      <Route path="/compliance/field/audit-visit/:planItemId" element={<AuditVisitWorkspace />} />
      <Route path="/compliance/field/audit-report/:inspectionId" element={<EmployerAuditReportViewer />} />
      <Route path="/compliance/field/audit-report/:reportId/print/:variant" element={<ProtectedRoute><AuditReportPrintPage /></ProtectedRoute>} />
      <Route path="/compliance/field/weekly-report-review" element={<WeeklyReportReview />} />
      <Route path="/compliance/field/my-upcoming" element={<MyUpcomingAudits />} />
      <Route path="/compliance/field/sampling" element={<SamplingDashboard />} />
      <Route path="/compliance/field/sampling/candidates" element={<MonthlyAuditCandidates />} />

      {/* ── Enforcement — legal, notices, arrangements, waivers ── */}
      <Route path="/compliance/enforcement/recommendation-queue" element={<ComplianceFeatureGate flagKey="compliance.legal.handoff" title="Legal Recommendation Queue"><LegalRecommendationQueue /></ComplianceFeatureGate>} />
      <Route path="/compliance/enforcement/legal-referral" element={<ComplianceFeatureGate flagKey="compliance.legal.handoff" title="Legal Referral"><LegalReferralWizard /></ComplianceFeatureGate>} />
      <Route path="/compliance/enforcement/legal-queue" element={<ComplianceLegalQueue />} />
      <Route path="/compliance/enforcement/proceedings" element={<ComplianceFeatureGate flagKey="compliance.legal.court_monitoring" title="Legal Proceedings & Court Monitoring"><ComplianceLegalProceedings /></ComplianceFeatureGate>} />
      <Route path="/compliance/enforcement/notices" element={<NoticesManagement />} />
      <Route path="/compliance/enforcement/arrangements" element={<PaymentArrangements />} />
      <Route path="/compliance/enforcement/breaches" element={<ComplianceBreachMonitoring />} />
      <Route path="/compliance/enforcement/waivers" element={<ComplianceFeatureGate flagKey="compliance.payment.waiver_requests" title="Waiver Requests"><ComplianceWaivers /></ComplianceFeatureGate>} />


      {/* ── Reports (unchanged paths) ── */}
      <Route path="/compliance/reports" element={<ComplianceReports />} />
      <Route path="/compliance/reports/violations-analytics" element={<CaseAnalytics />} />
      <Route path="/compliance/reports/violations/summary" element={<CaseAnalytics />} />
      <Route path="/compliance/reports/violations/status" element={<ViolationsByStatusReport />} />
      <Route path="/compliance/reports/violations/type" element={<ViolationsByTypeReport />} />
      <Route path="/compliance/reports/violations/resolution-time" element={<ViolationResolutionTimeReport />} />
      <Route path="/compliance/reports/violations/zone" element={<ViolationsByZoneReport />} />
      <Route path="/compliance/reports/inspector-performance" element={<InspectorPerformance />} />
      <Route path="/compliance/reports/c3-compliance" element={<C3Compliance />} />
      <Route path="/compliance/reports/arrears" element={<ArrearsReports />} />
      <Route path="/compliance/reports/audit" element={<ComplianceAuditReports />} />
      <Route path="/compliance/reports/arrangements" element={<ArrangementReports />} />
      <Route path="/compliance/reports/legal" element={<LegalEscalationReports />} />
      <Route path="/compliance/reports/trends" element={<TrendReports />} />

      {/* ── Unique drill-down report leaves (shared VariantReport renderer) ── */}
      <Route path="/compliance/reports/inspector-performance/weekly-plan" element={<VariantReport variant="inspector_perf_weekly_plan" />} />
      <Route path="/compliance/reports/inspector-performance/field-activities" element={<VariantReport variant="inspector_perf_field_activities" />} />
      <Route path="/compliance/reports/inspector-performance/check-in-out" element={<VariantReport variant="inspector_perf_check_in_out" />} />
      <Route path="/compliance/reports/inspector-performance/violations-by-inspector" element={<VariantReport variant="inspector_perf_violations_by_officer" />} />
      <Route path="/compliance/reports/c3-compliance/on-time-vs-late" element={<VariantReport variant="c3_on_time_vs_late" />} />
      <Route path="/compliance/reports/c3-compliance/missing" element={<VariantReport variant="c3_missing" />} />
      <Route path="/compliance/reports/c3-compliance/without-payment" element={<VariantReport variant="c3_without_payment" />} />
      <Route path="/compliance/reports/c3-compliance/rate-by-zone" element={<VariantReport variant="c3_rate_by_zone" />} />
      <Route path="/compliance/reports/arrears/by-zone" element={<VariantReport variant="arrears_by_zone" />} />
      <Route path="/compliance/reports/arrears/aging" element={<VariantReport variant="arrears_aging" />} />
      <Route path="/compliance/reports/arrears/collections-over-time" element={<VariantReport variant="arrears_collections_over_time" />} />
      <Route path="/compliance/reports/arrears/top-50" element={<VariantReport variant="arrears_top_50" />} />
      <Route path="/compliance/reports/audit/completion-rate" element={<VariantReport variant="audit_completion_rate" />} />
      <Route path="/compliance/reports/audit/findings-by-severity" element={<VariantReport variant="audit_findings_by_severity" />} />
      <Route path="/compliance/reports/audit/coverage-by-zone" element={<VariantReport variant="audit_coverage_by_zone" />} />
      <Route path="/compliance/reports/audit/risk-based" element={<VariantReport variant="audit_risk_based" />} />
      <Route path="/compliance/reports/arrangements/active" element={<VariantReport variant="arrangements_active" />} />
      <Route path="/compliance/reports/arrangements/defaulted" element={<VariantReport variant="arrangements_defaulted" />} />
      <Route path="/compliance/reports/arrangements/success-rate" element={<VariantReport variant="arrangements_success_rate" />} />
      <Route path="/compliance/reports/arrangements/installment-trends" element={<VariantReport variant="arrangements_installment_trends" />} />
      <Route path="/compliance/reports/legal/escalated" element={<VariantReport variant="legal_escalated" />} />
      <Route path="/compliance/reports/legal/stage-distribution" element={<VariantReport variant="legal_stage_distribution" />} />
      <Route path="/compliance/reports/legal/court-status" element={<VariantReport variant="legal_court_status" />} />
      <Route path="/compliance/reports/legal/judgements" element={<VariantReport variant="legal_judgements" />} />
      <Route path="/compliance/reports/trends/compliance-12m" element={<VariantReport variant="trends_compliance_12m" />} />
      <Route path="/compliance/reports/trends/violation-creation" element={<VariantReport variant="trends_violation_creation" />} />
      <Route path="/compliance/reports/trends/resolution-rate" element={<VariantReport variant="trends_resolution_rate" />} />
      <Route path="/compliance/reports/trends/financial-recovery" element={<VariantReport variant="trends_financial_recovery" />} />

      {/* ── Admin — settings, geography, staff, automation, tools ── */}
      <Route path="/compliance/admin/settings/rule-engine" element={<ComplianceRuleEngine />} />
      <Route path="/compliance/admin/settings/violation-types" element={<ComplianceViolationTypes />} />
      <Route path="/compliance/admin/settings/assignment-routing" element={<AssignmentRoutingRules />} />
      <Route path="/compliance/admin/settings/number-templates" element={<ComplianceNumberTemplates />} />
      <Route path="/compliance/admin/settings/risk-policy" element={<RiskRulePolicy />} />
      <Route path="/compliance/admin/settings/templates" element={<ComplianceTemplates />} />
      <Route path="/compliance/admin/communication-templates" element={<AuditCommunicationTemplatesPage />} />
      <Route path="/compliance/admin/communication-templates/new" element={<AuditCommunicationTemplateEditorPage />} />
      <Route path="/compliance/admin/communication-templates/:id" element={<AuditCommunicationTemplateEditorPage />} />
      <Route path="/compliance/admin/report-templates" element={<Suspense fallback={<div />}><ComplianceReportTemplates defaultTab="templates" /></Suspense>} />
      <Route path="/compliance/admin/document-foundation" element={<Suspense fallback={<div />}><ComplianceReportTemplates defaultTab="foundation" foundationFocused pageTitle="Shared Sections & Foundation" pageDescription="Reusable section library, common clauses/disclaimers, branding and merge fields shared across all employer-audit report templates." /></Suspense>} />
      <Route path="/compliance/admin/online-response" element={<OnlineResponseConfigPage />} />
      <Route path="/compliance/admin/risk-operations" element={<ComplianceRiskOperations />} />
      <Route path="/compliance/admin/settings/sampling" element={<RiskSamplingSettings />} />
      <Route path="/compliance/admin/settings/c3-ledger-sync" element={<C3LedgerSync />} />
      <Route path="/compliance/admin/settings/payment-ledger-sync" element={<PaymentLedgerSync />} />
      <Route path="/compliance/admin/settings/ledger-admin" element={<LedgerAdministration />} />
      <Route path="/compliance/admin/settings/ledger-operations" element={<LedgerOperationsDashboard />} />
      <Route path="/compliance/admin/settings/ledger-posting" element={<LedgerPostingAdmin />} />
      <Route path="/compliance/admin/settings/ledger-help" element={<LedgerHelpCenter />} />
      <Route path="/compliance/admin/geography/zones" element={<ZoneManagement />} />
      <Route path="/compliance/admin/geography/office-zone-mapping" element={<OfficeZoneMapping />} />
      <Route path="/compliance/admin/geography/village-zone-mapping" element={<VillageZoneMapping />} />
      <Route path="/compliance/admin/staff/officers" element={<OfficerManagement />} />
      <Route path="/compliance/admin/staff/queue-members" element={<QueueMembers />} />
      <Route path="/compliance/admin/staff/supervisors" element={<SupervisorHierarchy />} />
      <Route path="/compliance/admin/staff/link-legacy" element={<LegacyInspectorLinking />} />
      <Route path="/compliance/admin/automation/jobs" element={<ComplianceFeatureGate flagKey="compliance.risk.automation_jobs" title="Automation Jobs"><ComplianceJobConfiguration /></ComplianceFeatureGate>} />
      <Route path="/compliance/admin/feature-toggle-diagnostics" element={<FeatureToggleDiagnosticsPage />} />
      <Route path="/compliance/admin/automation/history" element={<ComplianceJobHistory />} />
      <Route path="/compliance/admin/automation/employer-jobs" element={<EmployerComplianceJobs />} />
      <Route path="/compliance/admin/tools/rule-simulator" element={<ComplianceFeatureGate flagKey="compliance.risk.rule_simulator" title="Rule Simulator"><ComplianceRuleSimulator /></ComplianceFeatureGate>} />
      <Route path="/compliance/admin/tools/risk-simulator" element={<ComplianceFeatureGate flagKey="compliance.risk.risk_simulator" title="Risk Simulator"><ComplianceRiskSimulator /></ComplianceFeatureGate>} />

      <Route path="/compliance/admin/feature-toggles" element={<ComplianceFeatureTogglesPage />} />
      <Route path="/compliance/admin/setup-wizard" element={<ComplianceSetupWizard />} />
      <Route path="/compliance/admin/case-families" element={<ComplianceCaseFamiliesPage />} />
      <Route path="/compliance/admin/workflow-mapping" element={<ComplianceWorkflowMappingPage />} />
      <Route path="/compliance/admin/waiver-rules" element={<ComplianceWaiverRulesPage />} />
      <Route path="/compliance/admin/legal-handoff-rules" element={<ComplianceLegalHandoffRulesPage />} />
      <Route path="/compliance/admin/help" element={<ComplianceHelpAdmin />} />
      {/* Calculation Rules & Escalation Rules — canonical location is Rule Engine */}
      <Route path="/compliance/admin/calculation-rules" element={<Navigate to="/compliance/admin/settings/rule-engine" replace />} />
      <Route path="/compliance/admin/escalation-rules" element={<Navigate to="/compliance/admin/settings/rule-engine" replace />} />
      <Route path="/compliance/admin/schedule-settings" element={<ComplianceScheduleSettings />} />
      <Route path="/compliance/admin/payment-arrangement-rules" element={<CompliancePaymentArrangementRulesPage />} />
      {/* Risk Scoring aliases — canonical route is /compliance/admin/settings/risk-policy */}
      <Route path="/compliance/admin/risk-scoring" element={<Navigate to="/compliance/admin/settings/risk-policy" replace />} />
      <Route path="/compliance/admin/settings/risk-scoring" element={<Navigate to="/compliance/admin/settings/risk-policy" replace />} />

      {/* Visible-by-default 404 fixes (menu aliases to existing working pages) */}
      <Route path="/compliance/workbench/overview" element={<Navigate to="/compliance/workbench" replace />} />
      <Route path="/compliance/work-queue" element={<Navigate to="/compliance/my-work-queue" replace />} />
      <Route path="/compliance/my-work" element={<Navigate to="/compliance/my-work-queue" replace />} />
      <Route path="/compliance/workbench/my-work" element={<Navigate to="/compliance/my-work-queue" replace />} />
      <Route path="/compliance/workbench/my-work-queue" element={<Navigate to="/compliance/my-work-queue" replace />} />
      <Route path="/compliance/:scope/my-work" element={<Navigate to="/compliance/my-work-queue" replace />} />
      <Route path="/compliance/:scope/my-work-queue" element={<Navigate to="/compliance/my-work-queue" replace />} />
      <Route path="/compliance/:scope/work-queue" element={<Navigate to="/compliance/my-work-queue" replace />} />
      <Route path="/compliance/reports/case-analytics" element={<Navigate to="/compliance/reports/violations-analytics" replace />} />
      <Route path="/compliance/admin/settings" element={<Navigate to="/compliance/settings" replace />} />

      {/* Restructure-Delivery-1 placeholder for menu items wired ahead of their page */}
      <Route path="/compliance/coming-soon/:slug" element={<ComingSoonStub />} />


      {/* ═══════════════════════════════════════════════════════════════
          COMPLIANCE — Legacy Redirects (old path → new canonical path)
          All old menu/bookmark URLs continue to work via 301 redirects.
          ═══════════════════════════════════════════════════════════════ */}

      {/* Workbench redirects */}
      <Route path="/compliance/dashboard" element={<Navigate to="/compliance/workbench/manager" replace />} />
      <Route path="/compliance/dashboard/manager" element={<Navigate to="/compliance/workbench/manager" replace />} />
      <Route path="/compliance/dashboard/inspector" element={<Navigate to="/compliance/workbench/inspector" replace />} />
      <Route path="/compliance/dashboard/legal" element={<Navigate to="/compliance/workbench/legal" replace />} />
      <Route path="/compliance/dashboard/analytics" element={<Navigate to="/compliance/workbench/analytics" replace />} />
      <Route path="/compliance/monitoring" element={<Navigate to="/compliance/workbench/monitoring" replace />} />
      <Route path="/compliance/operations/queues" element={<Navigate to="/compliance/workbench/queues" replace />} />
      <Route path="/compliance/operations/review-queue" element={<Navigate to="/compliance/workbench/review-queue" replace />} />
      <Route path="/compliance/operations/reassignment" element={<Navigate to="/compliance/workbench/reassignment" replace />} />

      {/* Field redirects */}
      <Route path="/compliance/audit-planning/weekly-plan-builder" element={<Navigate to="/compliance/field/plan-builder" replace />} />
      <Route path="/compliance/audit-planning/my-plans" element={<Navigate to="/compliance/field/my-plans" replace />} />
      <Route path="/compliance/inspector-plans" element={<Navigate to="/compliance/field/my-plans" replace />} />
      <Route path="/compliance/audit-planning/pending-review" element={<Navigate to="/compliance/field/pending-review" replace />} />
      <Route path="/compliance/audit-planning/pending-review/:planId" element={<Navigate to="/compliance/field/pending-review" replace />} />
      <Route path="/compliance/audit-planning/field-execution" element={<Navigate to="/compliance/field/execution" replace />} />
      <Route path="/compliance/inspections/field-execution" element={<Navigate to="/compliance/field/execution" replace />} />
      {/* Retired redirect targets removed (hard cutover): field-operations, inspections */}
      <Route path="/compliance/employers/findings" element={<Navigate to="/compliance/field/findings" replace />} />
      <Route path="/compliance/employer-statements" element={<Navigate to="/compliance/field/employer-statements" replace />} />
      <Route path="/compliance/employer-statement/:employerId" element={<Navigate to="/compliance/field/employer-statements" replace />} />
      <Route path="/compliance/employers/visit/:employerId" element={<Navigate to="/compliance/field/employer-statements" replace />} />
      <Route path="/compliance/employer-360/:employerId" element={<Employer360LegacyRedirect />} />
      <Route path="/compliance/employers/:employerId/risk-profile" element={<Navigate to="/compliance/field/employer-statements" replace />} />
      <Route path="/compliance/employers/hierarchy" element={<Navigate to="/compliance/field/employer-statements" replace />} />
      <Route path="/compliance/employers/management" element={<Navigate to="/compliance/field/employer-statements" replace />} />
      <Route path="/compliance/employer" element={<Navigate to="/compliance/field/employer-statements" replace />} />
      <Route path="/compliance/audits" element={<Navigate to="/compliance/field/audit-management" replace />} />
      <Route path="/compliance/violations/weekly-reports" element={<Navigate to="/compliance/field/weekly-report" replace />} />
      <Route path="/compliance/audit-planning/weekly-reports" element={<Navigate to="/compliance/field/all-reports" replace />} />
      <Route path="/compliance/audit-planning/all-reports" element={<Navigate to="/compliance/field/all-reports" replace />} />
      {/* Retired redirect targets removed (hard cutover): my-upcoming */}
      {/* Retired (hard cutover): /compliance/my-audits/upcoming */}
      <Route path="/compliance/audit-planning/sampling-dashboard" element={<Navigate to="/compliance/field/sampling" replace />} />
      <Route path="/compliance/sampling" element={<Navigate to="/compliance/field/sampling" replace />} />
      <Route path="/compliance/audit-planning/monthly-candidates" element={<Navigate to="/compliance/field/sampling/candidates" replace />} />
      <Route path="/compliance/sampling/candidates" element={<Navigate to="/compliance/field/sampling/candidates" replace />} />
      <Route path="/compliance/sampling/upcoming" element={<Navigate to="/compliance/field/my-upcoming" replace />} />

      {/* Enforcement redirects */}
      <Route path="/compliance/legal-recommendation-queue" element={<Navigate to="/compliance/enforcement/recommendation-queue" replace />} />
      <Route path="/compliance/legal/queue" element={<Navigate to="/compliance/enforcement/legal-queue" replace />} />
      <Route path="/compliance/legal/proceedings" element={<Navigate to="/compliance/enforcement/proceedings" replace />} />
      {/* Notices & Communications menu group */}
      <Route path="/compliance/notices" element={<Navigate to="/compliance/notices/register" replace />} />
      <Route path="/compliance/notices/register" element={<ComplianceNoticeRegister />} />
      <Route path="/compliance/notices/generate" element={<ComplianceGenerateNotice />} />
      <Route path="/compliance/notices/pending-approval" element={<ComplianceFeatureGate flagKey="compliance.core.notice_approval" title="Notice Approval Queue"><ComplianceNoticesPendingApproval /></ComplianceFeatureGate>} />
      <Route path="/compliance/notices/delivery-tracking" element={<ComplianceNoticeDeliveryTracking />} />
      <Route path="/compliance/notices/employer-responses" element={<ComplianceEmployerResponses />} />
      <Route path="/compliance/notices/communication-history" element={<ComplianceCommunicationHistory />} />
      <Route path="/compliance/arrangements" element={<Navigate to="/compliance/enforcement/arrangements" replace />} />
      <Route path="/compliance/payment-arrangements" element={<Navigate to="/compliance/enforcement/arrangements" replace />} />
      <Route path="/compliance/arrangements/new" element={<ComplianceFeatureGate flagKey="compliance.payment.arrangement" title="New Payment Arrangement"><NewArrangementPage /></ComplianceFeatureGate>} />
      <Route path="/compliance/arrangements/pending-approval" element={<ComplianceFeatureGate flagKey="compliance.payment.arrangement" title="Pending Arrangement Approvals"><ArrangementPendingApprovalPage /></ComplianceFeatureGate>} />
      <Route path="/compliance/arrangements/active" element={<ComplianceFeatureGate flagKey="compliance.payment.arrangement" title="Active Arrangements"><ActiveArrangementsPage /></ComplianceFeatureGate>} />
      <Route path="/compliance/arrangements/installments-due" element={<ComplianceFeatureGate flagKey="compliance.payment.arrangement" title="Installments Due"><InstallmentsDuePage /></ComplianceFeatureGate>} />
      <Route path="/compliance/arrangements/breaches" element={<Navigate to="/compliance/enforcement/breaches" replace />} />
      <Route path="/compliance/arrangements/payment-allocation" element={<ComplianceFeatureGate flagKey="compliance.payment.arrangement" title="Payment Allocation"><PaymentAllocationPage /></ComplianceFeatureGate>} />
      <Route path="/compliance/waivers" element={<Navigate to="/compliance/enforcement/waivers" replace />} />
      <Route path="/compliance/penalties" element={<Navigate to="/compliance/cases/penalties" replace />} />

      {/* Admin redirects */}
      <Route path="/compliance/settings" element={<ComplianceSettings />} />
      <Route path="/compliance/settings/completion-gate" element={<CompletionGateSettings />} />
      <Route path="/compliance/settings/rule-engine" element={<Navigate to="/compliance/admin/settings/rule-engine" replace />} />
      <Route path="/compliance/settings/violation-types" element={<Navigate to="/compliance/admin/settings/violation-types" replace />} />
      <Route path="/compliance/settings/assignment-routing" element={<Navigate to="/compliance/admin/settings/assignment-routing" replace />} />
      <Route path="/compliance/settings/number-templates" element={<Navigate to="/compliance/admin/settings/number-templates" replace />} />
      <Route path="/compliance/settings/risk-policy" element={<Navigate to="/compliance/admin/settings/risk-policy" replace />} />
      <Route path="/compliance/settings/risk-config" element={<Navigate to="/compliance/admin/settings/risk-policy" replace />} />
      <Route path="/compliance/settings/legal-escalation-policy" element={<Navigate to="/compliance/admin/settings/risk-policy" replace />} />
      <Route path="/compliance/settings/templates" element={<Navigate to="/compliance/admin/settings/templates" replace />} />
      <Route path="/compliance/settings/c3-ledger-sync" element={<Navigate to="/compliance/admin/settings/c3-ledger-sync" replace />} />
      <Route path="/compliance/settings/payment-ledger-sync" element={<Navigate to="/compliance/admin/settings/payment-ledger-sync" replace />} />
      <Route path="/compliance/settings/ledger-admin" element={<Navigate to="/compliance/admin/settings/ledger-admin" replace />} />
      <Route path="/compliance/audit-planning/settings" element={<Navigate to="/compliance/admin/settings/sampling" replace />} />
      <Route path="/compliance/sampling/settings" element={<Navigate to="/compliance/admin/settings/sampling" replace />} />
      <Route path="/compliance/geography/zones" element={<Navigate to="/compliance/admin/geography/zones" replace />} />
      <Route path="/compliance/geography/office-zone-mapping" element={<Navigate to="/compliance/admin/geography/office-zone-mapping" replace />} />
      <Route path="/compliance/geography/village-zone-mapping" element={<Navigate to="/compliance/admin/geography/village-zone-mapping" replace />} />
      <Route path="/compliance/staff/officers" element={<Navigate to="/compliance/admin/staff/officers" replace />} />
      <Route path="/compliance/staff/queue-members" element={<Navigate to="/compliance/admin/staff/queue-members" replace />} />
      <Route path="/compliance/staff/supervisors" element={<Navigate to="/compliance/admin/staff/supervisors" replace />} />
      <Route path="/compliance/staff/link-legacy" element={<Navigate to="/compliance/admin/staff/link-legacy" replace />} />
      <Route path="/compliance/automation/jobs" element={<Navigate to="/compliance/admin/automation/jobs" replace />} />
      <Route path="/compliance/automation/history" element={<Navigate to="/compliance/admin/automation/history" replace />} />
      <Route path="/compliance/automation/employer-jobs" element={<Navigate to="/compliance/admin/automation/employer-jobs" replace />} />
      <Route path="/compliance/tools/rule-simulator" element={<Navigate to="/compliance/admin/tools/rule-simulator" replace />} />
      <Route path="/compliance/tools/risk-simulator" element={<Navigate to="/compliance/admin/tools/risk-simulator" replace />} />
      <Route path="/compliance/risk-profiles" element={<Navigate to="/audit/risk-register" replace />} />

      {/* Audit Module Routes — Simplified Department Function Audit */}
      <Route path="/audit/dashboard" element={<AuditDashboard />} />
      <Route path="/audit/departments" element={<AuditFeatureGate featureFlag="FEATURE_AUDIT_DEPARTMENT_MASTER"><DepartmentMaster /></AuditFeatureGate>} />
      <Route path="/audit/universe" element={<Navigate to="/audit/departments" replace />} />
      <Route path="/audit/risk-register" element={<Suspense fallback={<div />}><RiskRegister /></Suspense>} />
      <Route path="/audit/functions" element={<AuditFeatureGate featureFlag="FEATURE_AUDIT_FUNCTION_MASTER"><FunctionMaster /></AuditFeatureGate>} />
      <Route path="/audit/department-view/:id" element={<DepartmentView />} />
      <Route path="/audit/risk-assessment" element={<AuditFeatureGate featureFlag="FEATURE_AUDIT_RISK_ASSESSMENT"><RiskAssessment /></AuditFeatureGate>} />
      <Route path="/audit/entity-summary" element={<AuditFeatureGate featureFlag="FEATURE_AUDIT_RISK_ASSESSMENT"><EntitySummary /></AuditFeatureGate>} />
      <Route path="/audit/risk-matrix" element={<AuditFeatureGate featureFlag="FEATURE_AUDIT_RISK_MATRIX"><RiskMatrix /></AuditFeatureGate>} />
      <Route path="/audit/audit-plans" element={<AuditFeatureGate featureFlag="FEATURE_AUDIT_PLANS"><AuditPlansNew /></AuditFeatureGate>} />
      <Route path="/audit/audit-plans/:id" element={<Suspense fallback={<div>Loading...</div>}><AuditPlanDetail /></Suspense>} />
      <Route path="/audit/audits" element={<AuditFeatureGate featureFlag="FEATURE_AUDIT_ENGAGEMENTS"><AuditEngagements /></AuditFeatureGate>} />
      <Route path="/audit/audits/:id" element={<EngagementDetail />} />
      <Route path="/audit/audit-reports" element={<AuditFeatureGate featureFlag="FEATURE_AUDIT_REPORTS"><AuditReports /></AuditFeatureGate>} />
      <Route path="/audit/report-builder" element={<Suspense fallback={<div>Loading...</div>}><AuditReportBuilder /></Suspense>} />
      <Route path="/audit/plan-approval" element={<PlanApproval />} />
      <Route path="/audit/config" element={<AuditFeatureGate featureFlag="FEATURE_AUDIT_SYSTEM_CONFIG"><AuditConfig /></AuditFeatureGate>} />
      <Route path="/audit/risk-settings" element={<Suspense fallback={<div />}><RiskSettings /></Suspense>} />
      <Route path="/audit/document-templates" element={<AuditFeatureGate featureFlag="FEATURE_AUDIT_SYSTEM_CONFIG"><Suspense fallback={<div />}><DocumentTemplateSettings /></Suspense></AuditFeatureGate>} />
      <Route path="/audit/queries" element={<Suspense fallback={<div />}><AuditQueries /></Suspense>} />
      <Route path="/audit/auditors" element={<AuditFeatureGate featureFlag="FEATURE_AUDIT_AUDITOR_PROFILES"><Suspense fallback={<div />}><AuditorProfiles /></Suspense></AuditFeatureGate>} />
      <Route path="/audit/auditor-profiles" element={<Navigate to="/audit/auditors" replace />} />
      <Route path="/audit/workload" element={<AuditFeatureGate featureFlag="FEATURE_AUDIT_WORKLOAD_CAPACITY"><Suspense fallback={<div />}><WorkloadCapacity /></Suspense></AuditFeatureGate>} />
      <Route path="/audit/time-tracking" element={<AuditFeatureGate featureFlag="FEATURE_AUDIT_TIME_TRACKING"><Suspense fallback={<div />}><TimeTracking /></Suspense></AuditFeatureGate>} />
      
      <Route path="/audit/leave" element={<AuditFeatureGate featureFlag="FEATURE_AUDIT_LEAVE_MANAGEMENT"><Suspense fallback={<div />}><AuditorLeaveManagement /></Suspense></AuditFeatureGate>} />

      {/* Legacy redirects */}
      <Route path="/audit/engagements" element={<Navigate to="/audit/audits" replace />} />
      <Route path="/audit/engagements/:id" element={<Navigate to="/audit/audits" replace />} />
      <Route path="/audit/plans" element={<Navigate to="/audit/audit-plans" replace />} />
      <Route path="/audit/reports" element={<Navigate to="/audit/audit-reports" replace />} />

      {/* Registration Rules & Process Routes */}
      <Route path="/registration/insured-person-guide" element={<InsuredPersonGuide />} />
      <Route path="/registration/employer-rules" element={<EmployerRules />} />
      <Route path="/registration/approval-workflow" element={<ApprovalWorkflow />} />
      <Route path="/registration/documentation" element={<DocumentationRequirements />} />

      {/* User Profile & Permissions Routes */}
      <Route path="/profile" element={<MyProfile />} />
      <Route path="/profile/change-password" element={<ProfileChangePassword />} />
      <Route path="/profile/notifications" element={<NotificationPreferences />} />
      <Route path="/profile/sessions" element={<ActiveSessions />} />
      <Route path="/profile/roles" element={<ManageRoles />} />
      <Route path="/admin/security" element={<SecuritySettings />} />
      <Route path="/admin/settings" element={<SystemSettings />} />

      {/* Legacy Routes - keeping existing functionality */}
      <Route path="/employer/register" element={<EmployerRegistration />} />
      <Route path="/employer/approval" element={<EmployerApproval />} />
      <Route path="/employer/directory" element={<EmployerDirectory />} />
      <Route path="/employer/:employerId/ledger" element={<EmployerLedger />} />
      <Route path="/ledger/recalc" element={<LedgerRecalcWizard />} />
      <Route path="/admin/ledger/allocation-rules" element={<PaymentAllocationRules />} />
      <Route path="/employer/contribution-entry" element={<ContributionEntry />} />
      <Route path="/employer/compliance" element={<ComplianceMonitoring />} />
      <Route path="/employer/contributions" element={<ContributionTracking />} />

      {/* Insured Persons Routes - Consolidated */}
      <Route path="/person/listing" element={<IPManagement />} />
      <Route path="/person/register" element={<PersonRegistration />} />
      <Route path="/person/register-tabs" element={<RegisterPersonTabs />} />
      <Route path="/person/management" element={<IPManagement />} />
      <Route path="/person/ip-management" element={<PersonIPManagement />} />
      <Route path="/person/view/:ssn" element={<ViewInsuredPerson />} />
      <Route path="/person/edit/:ssn" element={<EditInsuredPerson />} />

      {/* Quick Actions Routes */}
      <Route path="/person/wages-history" element={<WagesHistory />} />
      <Route path="/person/claim-history" element={<ClaimHistory />} />
      <Route path="/person/benefit-eligibility" element={<BenefitEligibility />} />
      <Route path="/person/pending-reviews" element={<PendingReviews />} />
      
      {/* Service Request Routes */}
      <Route path="/person/service-requests" element={<ServiceRequestList />} />
      <Route path="/person/service-requests/new" element={<ServiceRequestNew />} />
      <Route path="/person/service-requests/:id" element={<ServiceRequestDetail />} />
      <Route path="/person/service-requests/pending-verification" element={<PendingVerification />} />
      <Route path="/person/profile/:id" element={<InsuredPersonProfile />} />

      {/* Insured Persons Reports - CRD Department */}
      <Route path="/person/reports/ip-entry-verification" element={<IPEntryVerificationReport />} />
      <Route path="/person/reports/age-62-without-claim" element={<Age62WithoutClaimReport />} />
      <Route path="/person/reports/online-renewal-update" element={<OnlineRenewalUpdateReport />} />
      <Route path="/person/reports/registration-payments" element={<RegistrationPaymentsReport />} />
      <Route path="/person/reports/contribution-statement-payment" element={<ContributionStatementPaymentReport />} />
      <Route path="/person/reports/pension-letters-payment" element={<PensionLettersPaymentReport />} />
      <Route path="/person/reports/non-national-workers-ssn" element={<NonNationalWorkersSSNReport />} />
      <Route path="/person/reports/new-registrants-by-officer" element={<NewRegistrantsByOfficerReport />} />
      <Route path="/person/reports/employer-registration-by-officer" element={<EmployerRegistrationByOfficerReport />} />
      <Route path="/person/reports/life-certificates" element={<LifeCertificatesReport />} />
      <Route path="/person/reports/self-employed-by-officer" element={<SelfEmployedByOfficerReport />} />
      <Route path="/person/reports/claims-entered-by-officer" element={<ClaimsEnteredByOfficerReport />} />
      <Route path="/person/reports/self-employed-without-license" element={<SelfEmployedWithoutLicenseReport />} />
      <Route path="/person/reports/claims-to-benefits" element={<ClaimsToBenefitsReport />} />
      <Route path="/person/reports/crm-activity" element={<CRMActivityReport />} />
      <Route path="/person/reports/refunds-to-cru" element={<RefundsToCRUReport />} />
      <Route path="/person/reports/audit-sample-ip" element={<AuditSampleIPReport />} />
      
      {/* C3 Management Reports - Moved from Insured Persons */}
      <Route path="/c3/reports/c3-entry-verification" element={<C3EntryVerificationReport />} />
      <Route path="/c3/reports/pending-c3" element={<PendingC3Report />} />
      <Route path="/c3/reports/missing-ssn" element={<MissingSSNReport />} />
      
      {/* C3 Levy Settings Routes */}
      <Route path="/c3-management/settings/levy/schemes" element={<LevySchemesList />} />
      <Route path="/c3-management/settings/levy/schemes/:schemeId" element={<LevySchemeDetail />} />
      <Route path="/c3-management/settings/levy/simulator" element={<LevySimulator />} />
      <Route path="/c3/reports/c3-line-item-changes" element={<C3LineItemChangesReport />} />
      <Route path="/c3/reports/electronic-c3-uploads" element={<ElectronicC3UploadsReport />} />
      <Route path="/c3/reports/c3-without-payment" element={<C3WithoutPaymentReport />} />
      <Route path="/c3/reports/employer-notifications" element={<EmployerNotificationsReport />} />
      <Route path="/c3/reports/high-wage-multi-employer" element={<HighWageMultiEmployerReport />} />
      <Route path="/c3/reports/scanning-activity" element={<ScanningActivityReport />} />
      <Route path="/c3/reports/outstanding-discrepancies" element={<OutstandingDiscrepanciesReport />} />
      <Route path="/c3/reports/long-term-claims" element={<LongTermClaimsReport />} />
      <Route path="/c3/reports/audit-sample" element={<AuditSampleReport />} />

      {/* Finance Settings Routes */}
      <Route path="/finance/settings/fee-configuration" element={<FeeConfigurationList />} />
      <Route path="/finance/settings/fee-configuration/new" element={<FeeConfigurationDetail />} />
      <Route path="/finance/settings/fee-configuration/:feeId" element={<FeeConfigurationDetail />} />
      <Route path="/finance/settings/fee-configuration/:feeId/edit" element={<FeeConfigurationDetail />} />
      <Route path="/finance/settings/service-types" element={<ServiceTypeManagement />} />
      <Route path="/finance/settings/verification" element={<VerificationSettings />} />
      <Route path="/finance/settings/multi-currency" element={<MultiCurrencySettings />} />

      {/* Benefits Routes - Legacy /benefits/* paths redirect to /bn/* module */}
      <Route path="/benefits/all" element={<Navigate to="/bn/claims" replace />} />
      <Route path="/benefits/online-applications" element={<Navigate to="/bn/queue" replace />} />
      <Route path="/benefits/maternity" element={<Navigate to="/bn/claims?type=maternity" replace />} />
      <Route path="/benefits/unemployment" element={<Navigate to="/bn/claims?type=unemployment" replace />} />
      <Route path="/benefits/work-injury" element={<Navigate to="/bn/claims?type=work-injury" replace />} />
      <Route path="/benefits/death" element={<Navigate to="/bn/claims?type=death" replace />} />
      <Route path="/benefits/educational" element={<Navigate to="/bn/claims?type=educational" replace />} />


      {/* Customer Relationship (CRD) Module Routes */}
      <Route path="/crd/cards" element={<CardManagement />} />
      <Route path="/crd/reports/printed-spoiled-cards" element={<CRDPrintedSpoiledCardsReport />} />

      {/* System Administration Routes - Using DB-backed Enterprise Admin components */}
      <Route path="/admin/master-data/income-categories" element={<IncomeCategoryManagement />} />
      <Route path="/admin/master-data/sep-contrib-rates" element={<Navigate to="/admin/c3-configuration" replace />} />
      <Route path="/admin/master-data/income-codes" element={<IncomeCodeManagement />} />
      {/* Master Data CRUD Routes */}
      <Route path="/admin/master-data/activity-types" element={<ActivityManagement />} />
      {/* Phase 3 dedup: canonical Designations page is /admin/designations */}
      <Route path="/admin/master-data/designations" element={<Navigate to="/admin/designations" replace />} />
      <Route path="/admin/master-data/bank-codes" element={<BankCodeManagement />} />
      <Route path="/admin/master-data/batch-status" element={<BatchStatusManagement />} />
      <Route path="/admin/master-data/pay-periods" element={<PayPeriodManagement />} />
      <Route path="/admin/master-data/c3-status" element={<C3StatusManagement />} />
      <Route path="/admin/master-data/countries" element={<CountryManagement />} />
      <Route path="/admin/master-data/dependent-relations" element={<DependentRelationManagement />} />
      <Route path="/admin/master-data/districts" element={<DistrictManagement />} />
      <Route path="/admin/master-data/eye-colors" element={<EyeColorManagement />} />
      <Route path="/admin/master-data/industries" element={<IndustryManagement />} />
      <Route path="/admin/master-data/inspectors" element={<InspectorMDManagement />} />
      <Route path="/admin/master-data/invoice-status" element={<InvoiceStatusMDManagement />} />
      <Route path="/admin/master-data/invoice-types" element={<InvoiceTypesMDManagement />} />
      <Route path="/admin/master-data/legal-status" element={<LegalStatusManagement />} />
      <Route path="/admin/master-data/marital-status" element={<MaritalStatusManagement />} />
      <Route path="/admin/master-data/merchants" element={<MerchantManagement />} />
      <Route path="/admin/master-data/methods-of-payment" element={<MethodOfPaymentManagement />} />
      <Route path="/admin/master-data/occupations" element={<OccupationManagement />} />
      <Route path="/admin/master-data/payer-types" element={<PayerTypeManagement />} />
      <Route path="/admin/master-data/payment-sources" element={<PaymentSourcesManagement />} />
      <Route path="/admin/master-data/payment-types" element={<PaymentTypeMDManagement />} />
      <Route path="/admin/master-data/penalty-rates" element={<PenaltyMDManagement />} />
      <Route path="/admin/master-data/postal-districts" element={<PostalDistrictManagement />} />
      <Route path="/admin/master-data/receipt-status" element={<ReceiptStatusManagement />} />
      <Route path="/admin/master-data/relations" element={<RelationManagement />} />
      <Route path="/admin/master-data/sectors" element={<SectorManagement />} />
      <Route path="/admin/master-data/ssc-rates" element={<SscRatesManagement />} />
      <Route path="/admin/master-data/vc-contrib-rates" element={<VcContribRateManagement />} />
      <Route path="/admin/master-data/vc-eligibility-config" element={<VcEligibilityConfigManagement />} />
      <Route path="/admin/master-data/verification-types" element={<VerifyManagement />} />
      <Route path="/admin/master-data/villages" element={<VillagesManagement />} />
      <Route path="/admin" element={<UserList />} />
      {/* EPIC 0.1 — Enterprise Platform Administration landing */}
      <Route path="/admin/platform" element={<PlatformAdmin />} />
      {/* Epic 1 — Administration Route Registry */}
      <Route path="/admin/route-registry" element={<Suspense fallback={<div>Loading...</div>}><RouteRegistryAdmin /></Suspense>} />
      <Route path="/admin/table-registry" element={<Suspense fallback={<div>Loading...</div>}><TableRegistryAdmin /></Suspense>} />
      <Route path="/admin/legacy-mapping" element={<Suspense fallback={<div>Loading...</div>}><LegacyMappingAdmin /></Suspense>} />
      <Route path="/admin/legacy-mapping/:tableMapId" element={<Suspense fallback={<div>Loading...</div>}><LegacyMappingDetailAdmin /></Suspense>} />
      {/* Epic 5 — Permission Registry */}
      <Route path="/admin/permission-registry" element={<Suspense fallback={<div>Loading...</div>}><PermissionRegistryAdmin /></Suspense>} />
      <Route path="/admin/platform/enterprise-catalogue" element={<Suspense fallback={<div>Loading...</div>}><EnterpriseServiceCatalogue /></Suspense>} />
      {/* Enterprise Configuration Centre — readiness dashboard (no duplicate screens) */}
      <Route path="/admin/configuration-centre" element={<Suspense fallback={<div>Loading...</div>}><ConfigurationCentre /></Suspense>} />
      {/* SSB Implementation Setup — St. Kitts & Nevis central policy shell */}
      <Route path="/admin/ssb-setup" element={<Suspense fallback={<div>Loading...</div>}><SsbSetupPage /></Suspense>} />
      {/* SSB Configuration Governance — registry, packages, validation, snapshots */}
      <Route path="/admin/configuration-governance" element={<Suspense fallback={<div>Loading...</div>}><ConfigurationGovernancePage /></Suspense>} />
      {/* Platform Readiness Centre — BN Wave 1 readiness cockpit */}
      <Route path="/admin/platform-readiness" element={<Suspense fallback={<div>Loading...</div>}><PlatformReadinessCentre /></Suspense>} />
      {/* Enterprise Consumption Registry — ownership and consumption contract */}
      <Route path="/admin/enterprise-consumption-registry" element={<Suspense fallback={<div>Loading...</div>}><EnterpriseConsumptionRegistryPage /></Suspense>} />
      {/* EPIC 2.2 — Geography Domain Pack (shared Social Security foundation) */}
      <Route path="/admin/geography" element={<Suspense fallback={<div>Loading...</div>}><GeographyDomainPage /></Suspense>} />
      {/* EPIC 2.3 — Identity Domain Pack (shared Social Security foundation) */}
      <Route path="/admin/identity" element={<Suspense fallback={<div>Loading...</div>}><IdentityDomainPage /></Suspense>} />
      <Route path="/admin/financial-reference" element={<Suspense fallback={<div>Loading...</div>}><FinancialReferenceDomainPage /></Suspense>} />
      <Route path="/admin/legal-reference" element={<Suspense fallback={<div>Loading...</div>}><LegalReferenceDomainPage /></Suspense>} />
      {/* EPIC 2.6 — Participant / Party Domain Pack (shared Social Security foundation) */}
      <Route path="/admin/participant" element={<Suspense fallback={<div>Loading...</div>}><ParticipantDomainPage /></Suspense>} />
      <Route path="/admin/communication-domain" element={<Suspense fallback={<div>Loading...</div>}><CommunicationDomainPage /></Suspense>} />
      {/* EPIC 1.1.2 — Enterprise Reference Framework governance console */}
      <Route path="/admin/reference-framework" element={<ReferenceFramework />} />
      <Route path="/admin/home" element={<Navigate to="/admin/platform" replace />} />
      <Route path="/admin/dashboard" element={<Navigate to="/admin/platform" replace />} />
      <Route path="/admin/user-management" element={<Navigate to="/admin/users" replace />} />
      <Route path="/admin/notification-management" element={<Navigate to="/admin/notifications" replace />} />
      {/* Canonical workflow list = /admin/workflows (backed by workflow_definitions).
          /admin/workflow-management is the visual designer shell and stays available,
          but the alias /admin/workflow points to the working canonical registry. */}
      <Route path="/admin/workflow" element={<Navigate to="/admin/workflows" replace />} />
      <Route path="/admin/system-monitoring" element={<Navigate to="/admin/session-health" replace />} />
      <Route path="/admin/system-logs" element={<Navigate to="/admin/logs" replace />} />
      <Route path="/admin/audit" element={<Navigate to="/system-logs/audit" replace />} />
      <Route path="/admin/users" element={<UserList />} />
      <Route path="/admin/users/create" element={<UserCreate />} />
      <Route path="/admin/users/:userId" element={<UserView />} />
      <Route path="/admin/users/:userId/edit" element={<UserEdit />} />
      <Route path="/admin/users/:userId/roles" element={<UserRoles />} />
      <Route path="/admin/users/:userId/manage" element={<UserProfileManageAdmin />} />
      <Route path="/admin/seed-test-users" element={<SeedTestUsers />} />
      <Route path="/admin/external-portal-settings" element={<ExternalPortalSettings />} />
      <Route path="/admin/external-portal-approvals" element={<ExternalPortalApprovals />} />
      <Route path="/admin/public-catalog-validation" element={<PublicCatalogValidation />} />
      <Route path="/admin/numbering" element={<NumberingAdmin />} />
      <Route path="/admin/numbering-rules" element={<Navigate to="/admin/numbering" replace />} />
      <Route path="/admin/web-users" element={<WebUsers />} />
      <Route path="/admin/audit-log" element={<Suspense fallback={<div>Loading...</div>}><AuditLogAdmin /></Suspense>} />
      <Route path="/admin/audit-logs" element={<Navigate to="/admin/audit-log" replace />} />
      <Route path="/admin/scheduler" element={<CentralScheduler />} />
      <Route path="/admin/backup" element={<BackupRecovery />} />
      <Route path="/admin/logs" element={<SystemLogs />} />
      <Route path="/admin/session-health" element={<SessionHealth />} />
      <Route path="/admin/employees" element={<EmployeeList />} />
      <Route path="/admin/org-units" element={<OrgUnitList />} />
      <Route path="/admin/positions" element={<PositionList />} />
      {/* Phase 3 dedup: canonical Roles admin merges roles + permissions + hierarchy */}
      <Route path="/admin/roles" element={<RolesAdmin />} />
      <Route path="/admin/roles-permissions" element={<Navigate to="/admin/roles?tab=permissions" replace />} />
      <Route path="/admin/delegations" element={<DelegationList />} />
      <Route path="/admin/approval-matrix/payment" element={<ApprovalMatrixPayment />} />
      <Route path="/admin/approval-matrix/fee-waiver" element={<ApprovalMatrixFeeWaiver />} />
      <Route path="/admin/approval-matrix/journal" element={<ApprovalMatrixJournal />} />
      <Route path="/admin/approval-matrix/refund" element={<ApprovalMatrixRefund />} />
      <Route path="/admin/approval-matrix/write-off" element={<ApprovalMatrixWriteOff />} />
      <Route path="/admin/workflow-schemes" element={<WorkflowSchemeList />} />
      <Route path="/admin/workflow-inbox" element={<WorkflowInbox />} />
      <Route path="/admin/migration-control" element={<Suspense fallback={<div>Loading...</div>}><MigrationControlCentre /></Suspense>} />
      <Route path="/admin/platform-services" element={<Suspense fallback={<div>Loading...</div>}><PlatformServiceCatalogue /></Suspense>} />
      <Route path="/admin/release-readiness" element={<Suspense fallback={<div>Loading...</div>}><ReleaseReadinessDashboard /></Suspense>} />
      <Route path="/admin/employer-registry" element={<Suspense fallback={<div>Loading...</div>}><EmployerRegistry /></Suspense>} />
      <Route path="/admin/employer-registry/:employerId" element={<Suspense fallback={<div>Loading...</div>}><EmployerRegistryDetail /></Suspense>} />
      <Route path="/admin/workflow-management" element={<WorkflowManagement />} />
      <Route path="/admin/workflow-management/workflows" element={<WorkflowManagement />} />
      <Route path="/admin/workflow-management/runs" element={<WorkflowManagement />} />
      <Route path="/admin/workflow-management/data" element={<WorkflowManagement />} />
      <Route path="/admin/workflow-management/templates" element={<WorkflowManagement />} />
      <Route path="/admin/workflow-management/settings" element={<WorkflowManagement />} />
      <Route path="/admin/notifications" element={<NotificationManagement />} />
      <Route path="/admin/notifications/log" element={<AdminNotificationLogs />} />
      <Route path="/admin/notifications/logs" element={<AdminNotificationLogs />} />
      {/* Phase 3 dedup: canonical Notification Templates admin merges 5 surfaces */}
      <Route path="/admin/notification-templates" element={<Suspense fallback={<div>Loading...</div>}><NotificationTemplatesAdmin /></Suspense>} />
      <Route path="/admin/notifications/templates" element={<Navigate to="/admin/notification-templates" replace />} />
      <Route path="/admin/notifications/notification-templates" element={<Navigate to="/admin/notification-templates" replace />} />
      <Route path="/admin/notifications/channels" element={<NotificationChannelSettings />} />
      <Route path="/admin/notifications/providers" element={<ProviderSettings />} />
      <Route path="/admin/email-campaigns" element={<EmailCampaigns />} />
      <Route path="/admin/email-logs" element={<EmailLogs />} />
      {/* Phase 3 dedup: canonical Offices admin merges offices + IP whitelist + locations */}
      <Route path="/admin/offices" element={<OfficesAdmin />} />
      <Route path="/admin/reference-sequences" element={<Navigate to="/admin/numbering?tab=sequences" replace />} />
      <Route path="/admin/office-ip-management" element={<Navigate to="/admin/offices?tab=ip" replace />} />
      {/* Phase 3 dedup: canonical Departments admin merges departments + profiles + mapping */}
      <Route path="/admin/departments" element={<DepartmentsAdmin />} />
      <Route path="/admin/modules" element={<ModuleManagement />} />
      <Route path="/admin/security/password-policy" element={<PasswordPolicySettings />} />
      <Route path="/admin/security/mfa" element={<MFASettings />} />
      <Route path="/admin/security/policy" element={<SecurityPolicySettingsPage />} />
      <Route path="/admin/security/ip-access" element={<IPAccessRulesManagement />} />
      <Route path="/admin/designations" element={<DesignationsAdmin />} />
      {/* Phase 3 dedup: hierarchy lives in a tab on the canonical page */}
      <Route path="/admin/designation-hierarchy" element={<Navigate to="/admin/designations?tab=hierarchy" replace />} />
      <Route path="/admin/role-hierarchy" element={<Navigate to="/admin/roles?tab=hierarchy" replace />} />
      <Route path="/admin/user-notification-preferences" element={<UserNotificationPreferences />} />
      <Route path="/admin/data-migration" element={<DataMigration />} />
      <Route path="/admin/release-management" element={<ReleaseManagement />} />
      <Route path="/admin/users/update-password" element={<UpdateUserPassword />} />
      <Route path="/admin/module-button-bindings" element={<ModuleButtonBindings />} />
      <Route path="/admin/api-keys" element={<ApiKeysManagement />} />
      {/* SSC Compliance API Test Console */}
      <Route path="/admin/api-test-console" element={<ApiTestDashboard />} />
      <Route path="/admin/api-test-console/keys" element={<ApiKeysConsole />} />
      <Route path="/admin/api-test-console/environments" element={<EnvironmentsConsole />} />
      <Route path="/admin/api-test-console/auth-lab" element={<AuthTestLab />} />
      <Route path="/admin/api-test-console/endpoints" element={<EndpointExplorer />} />
      <Route path="/admin/api-test-console/runner" element={<ComplianceRunner />} />
      <Route path="/admin/api-test-console/saved-cases" element={<SavedCasesConsole />} />
      <Route path="/admin/api-test-console/suites" element={<SuitesConsole />} />
      <Route path="/admin/api-test-console/logs" element={<ExecutionLogs />} />
      <Route path="/admin/public-api" element={<PublicApiManagement />} />
      <Route path="/admin/external-apis" element={<ExternalApiManagement />} />
      <Route path="/external/api-docs" element={<ExternalApiDocs />} />
      {/* Phase 3 dedup: canonical C3 Configuration consolidates calculation + period tabs */}
      <Route path="/admin/c3-calculation-config" element={<Navigate to="/admin/c3-configuration" replace />} />
      <Route path="/admin/c3-period-config" element={<Navigate to="/admin/c3-configuration" replace />} />
      <Route path="/admin/c3-configuration" element={<C3ConfigurationPage />} />
      <Route path="/admin/global-settings" element={<GlobalSettings />} />
      <Route path="/admin/date-culture-consistency" element={<DateCultureConsistency />} />
      <Route path="/admin/document-configuration" element={<DocumentConfigurationPage />} />
      <Route path="/admin/ip-card-configuration" element={<IPCardConfiguration />} />
      <Route path="/admin/knowledge-base" element={<KnowledgeBaseAdmin />} />
      
      {/* Workflow Engine Routes */}
      <Route path="/admin/workflows" element={<WorkflowList />} />
      <Route path="/admin/workflows/new" element={<WorkflowForm />} />
      <Route path="/admin/workflows/:id" element={<WorkflowForm />} />
      <Route path="/admin/workflow-triggers" element={<WorkflowTriggers />} />
      <Route path="/admin/workflow-logs" element={<WorkflowLogs />} />
      <Route path="/admin/workflow-analytics" element={<WorkflowAnalytics />} />
      <Route path="/admin/workflow-security" element={<WorkflowSecuritySettings />} />
      <Route path="/admin/workflow-secured-approvals" element={<SecuredWorkflowApprovals />} />
      <Route path="/admin/workflow-role-assignment" element={<WorkflowRoleAssignment />} />
      <Route path="/workflow/my-tasks" element={<MyWorkflowTasks />} />
      
      <Route path="/finance/settings/benefit-finance-mapping" element={<BenefitFinanceMapping />} />
      <Route path="/nbenefit/config/life-certificate-config" element={<LifeCertificateConfig />} />

      {/* Correspondence / Communication Hub Routes */}
      <Route path="/correspondence/dashboard" element={<CorrespondenceDashboard />} />
      <Route path="/correspondence/incoming" element={<IncomingCommunications />} />
      <Route path="/correspondence/outgoing" element={<OutgoingCommunications />} />
      <Route path="/correspondence/search" element={<SearchHistory />} />
      <Route path="/correspondence/archive" element={<Archive />} />

      {/* Module Templates Routes */}
      <Route path="/compliance/templates" element={<ModuleTemplates module="Compliance" />} />
      {/* Epic 0.2 (BN Navigation Foundation): legacy → canonical redirect */}
      <Route path="/benefits/templates" element={<Navigate to="/admin/notification-templates?tab=core&module=BENEFITS" replace />} />
      <Route path="/finance/templates" element={<ModuleTemplates module="Finance" />} />
      <Route element={<LegalRouteGuard />}>
        <Route path="/legal/templates" element={<ModuleTemplates module="Legal" />} />
      </Route>
      <Route path="/audit/templates" element={<Navigate to="/admin/notification-templates?tab=core&module=AUDIT" replace />} />
      <Route path="/employers/templates" element={<ModuleTemplates module="Employers" />} />
      <Route path="/insured-persons/templates" element={<ModuleTemplates module="InsuredPersons" />} />

      {/* Reports Routes */}
      <Route path="/reports/claims" element={<ReportsHub />} />
      <Route path="/reports/cashier" element={<ReportsHub />} />
      <Route path="/reports/employer" element={<ReportsHub />} />
      <Route path="/reports/employer-statement" element={<EmployerStatement />} />
      <Route path="/reports/persons" element={<ReportsHub />} />
      <Route path="/reports/statistics" element={<ReportsHub />} />
      <Route path="/reports/financial" element={<ReportsHub />} />
      <Route path="/reports/custom" element={<ReportsHub />} />

      {/* BeMA Legacy Redirects - all redirect to Compliance module */}
      <Route path="/bema/workplan" element={<Navigate to="/compliance/field/my-plans" replace />} />
      <Route path="/bema/c3-filing" element={<Navigate to="/compliance/reports/c3-compliance" replace />} />
      <Route path="/bema/registrations" element={<Navigate to="/compliance/field/employer-360" replace />} />
      <Route path="/bema/scouting" element={<Navigate to="/compliance/field/findings" replace />} />
      <Route path="/bema/admin/rules" element={<Navigate to="/compliance/admin/settings/rule-engine" replace />} />
      <Route path="/bema/admin/templates" element={<Navigate to="/compliance/admin/settings/templates" replace />} />
      <Route path="/bema/admin/roles" element={<Navigate to="/compliance/admin/staff/officers" replace />} />
      <Route path="/bema/admin/logs" element={<Navigate to="/compliance/admin/automation/history" replace />} />

      {/* All /legal/* and /legal-advanced/* routes gated by LegalRouteGuard */}
      <Route element={<LegalRouteGuard />}>
      {/* Unified Legal Advice / Contract Review module */}
      <Route path="/legal/services" element={<Suspense fallback={<div>Loading...</div>}><LegalServicesHub /></Suspense>} />
      <Route path="/legal/contract-review/dashboard" element={<Suspense fallback={<div>Loading...</div>}><ContractReviewDashboard /></Suspense>} />
      <Route path="/legal/contract-review/new" element={<Suspense fallback={<div>Loading...</div>}><ContractReviewIntake /></Suspense>} />
      <Route path="/legal/contract-review/mine" element={<Suspense fallback={<div>Loading...</div>}><MyContractReviews /></Suspense>} />
      <Route path="/legal/contract-review/:id" element={<Suspense fallback={<div>Loading...</div>}><ContractReviewDetail /></Suspense>} />
      {/* Aliases under /legal/advice/* */}
      <Route path="/legal/advice/dashboard" element={<Suspense fallback={<div>Loading...</div>}><ContractReviewDashboard /></Suspense>} />
      <Route path="/legal/advice/new" element={<Suspense fallback={<div>Loading...</div>}><ContractReviewIntake /></Suspense>} />
      <Route path="/legal/advice/mine" element={<Suspense fallback={<div>Loading...</div>}><MyContractReviews /></Suspense>} />
      <Route path="/legal/advice/:id" element={<Suspense fallback={<div>Loading...</div>}><ContractReviewDetail /></Suspense>} />
      {/* Workbench buckets */}
      <Route path="/legal/advice/workbench/:bucket" element={<Suspense fallback={<div>Loading...</div>}><AdviceWorkbench /></Suspense>} />

      {/* Legal Module Routes - New */}
      <Route path="/legal/dashboard" element={<LegalDashboard />} />
      <Route path="/legal/lg/dashboard" element={<Suspense fallback={<div>Loading...</div>}><LgDashboard /></Suspense>} />
      <Route path="/legal/admin/uat-documents" element={<Suspense fallback={<div>Loading...</div>}><UatDocumentsPage /></Suspense>} />
      <Route path="/legal/lg/documents" element={<Suspense fallback={<div>Loading...</div>}><LegalDocumentsWorkspace /></Suspense>} />
      <Route path="/legal/ops" element={<Suspense fallback={<div>Loading...</div>}><LegalOpsDashboard /></Suspense>} />
      <Route path="/legal/lg/hearings" element={<Suspense fallback={<div>Loading...</div>}><LgHearingCalendar /></Suspense>} />
      <Route path="/legal/lg/hearing-workbench" element={<Suspense fallback={<div>Loading...</div>}><LgHearingWorkbench /></Suspense>} />
      <Route path="/legal/lg/hearings/:id" element={<Suspense fallback={<div>Loading...</div>}><LgHearingWorkspace /></Suspense>} />
      <Route path="/legal/lg/cases" element={<Suspense fallback={<div>Loading...</div>}><LgCaseList /></Suspense>} />
      {/* Canonical task route: /legal/lg/tasks. /legal/tasks is a legacy alias. */}
      <Route path="/legal/tasks" element={<Navigate to="/legal/lg/tasks" replace />} />
      <Route path="/legal/lg/tasks" element={<Suspense fallback={<div>Loading...</div>}><LgTasksList /></Suspense>} />
      <Route path="/legal/lg/recovery" element={<Suspense fallback={<div>Loading...</div>}><LgRecoveryWorkbench /></Suspense>} />
      <Route path="/legal/lg/intake" element={<Suspense fallback={<div>Loading...</div>}><LgIntakeWorkbench /></Suspense>} />
      <Route path="/legal/lg/intake/:id" element={<Suspense fallback={<div>Loading...</div>}><LgIntakeWorkspace /></Suspense>} />
      <Route path="/legal/lg/orders" element={<Suspense fallback={<div>Loading...</div>}><LgJudicialOrdersWorkbench /></Suspense>} />
      <Route path="/legal/lg/orders/:id" element={<Suspense fallback={<div>Loading...</div>}><LgOrderDetail /></Suspense>} />
      {/* Canonical /legal/lg/referrals path — aliases the existing Referrals Workbench */}
      <Route path="/legal/lg/referrals" element={<Navigate to="/legal/referrals-workbench" replace />} />
      <Route path="/legal/lg/my-work" element={<Navigate to="/legal/lg/tasks?view=my" replace />} />
      <Route path="/legal/lg/post-judgment/:caseId" element={<Suspense fallback={<div>Loading...</div>}><LgPostJudgmentWorkspace /></Suspense>} />
      <Route path="/legal/lg/legal-recovery-dashboard" element={<Suspense fallback={<div>Loading...</div>}><LgLegalRecoveryDashboard /></Suspense>} />
      <Route path="/legal/lg/judgment-compliance" element={<Suspense fallback={<div>Loading...</div>}><LgJudgmentComplianceWorkbench /></Suspense>} />
      <Route path="/legal/lg/consent-orders" element={<Suspense fallback={<div>Loading...</div>}><LgConsentOrdersWorkbench /></Suspense>} />
      <Route path="/legal/lg/settlements" element={<Suspense fallback={<div>Loading...</div>}><LgLegalSettlementsWorkbench /></Suspense>} />
      <Route path="/legal/lg/court-filings" element={<Suspense fallback={<div>Loading...</div>}><LgCourtFilingsWorkbench /></Suspense>} />
      <Route path="/legal/lg/external-counsel" element={<Suspense fallback={<div>Loading...</div>}><LgExternalCounselWorkbench /></Suspense>} />
      <Route path="/legal/lg/cost-recovery" element={<Suspense fallback={<div>Loading...</div>}><LgLegalCostRecoveryWorkbench /></Suspense>} />




      {/* Legal Advanced - Matter Framework (feature-flag gated) */}
      {/* Phase 6: /legal-advanced/* now redirects to the new IA.
          Original screens remain reachable under /legal-advanced/legacy/* for zero-deletion guarantee. */}
      <Route path="/legal-advanced" element={<Navigate to="/legal/dashboard" replace />} />
      <Route path="/legal-advanced/dashboard" element={<Navigate to="/legal/dashboard" replace />} />
      <Route path="/legal-advanced/matters" element={<Navigate to="/legal/lg/cases" replace />} />
      <Route path="/legal-advanced/matters/:id" element={<LegalAdvancedMatterRedirect />} />
      <Route path="/legal-advanced/intake" element={<Navigate to="/legal/cases/intake" replace />} />
      <Route path="/legal-advanced/workbaskets" element={<Navigate to="/legal/workbench" replace />} />
      <Route path="/legal-advanced/my-workbasket" element={<Navigate to="/legal/workbench?tab=my-work" replace />} />
      <Route path="/legal-advanced/team-workbasket" element={<Navigate to="/legal/workbench?tab=team" replace />} />
      <Route path="/legal-advanced/advice" element={<Navigate to="/legal/services?type=advice" replace />} />
      <Route path="/legal-advanced/contracts" element={<Navigate to="/legal/services?type=contract" replace />} />
      <Route path="/legal-advanced/employer-recovery" element={<Navigate to="/legal/lg/cases?segment=employer-recovery" replace />} />
      <Route path="/legal-advanced/ip-matters" element={<Navigate to="/legal/lg/cases?segment=ip" replace />} />
      <Route path="/legal-advanced/documents" element={<Navigate to="/legal/documents" replace />} />
      <Route path="/legal-advanced/activities" element={<Navigate to="/legal/workbench?tab=activities" replace />} />
      <Route path="/legal-advanced/reports" element={<Navigate to="/legal/reports" replace />} />
      <Route path="/legal-advanced/admin" element={<Navigate to="/legal/admin" replace />} />
      <Route path="/legal-advanced/settings" element={<Navigate to="/legal/admin" replace />} />

      {/* Legacy /legal-advanced/* screens preserved (zero-deletion guarantee) */}
      <Route path="/legal-advanced/legacy" element={<Suspense fallback={<div>Loading...</div>}><LegalAdvancedGate><LegalAdvancedLayout /></LegalAdvancedGate></Suspense>}>
        <Route index element={<Navigate to="/legal-advanced/legacy/dashboard" replace />} />
        <Route path="dashboard" element={<Suspense fallback={<div>Loading...</div>}><LADashboard /></Suspense>} />
        <Route path="matters" element={<Suspense fallback={<div>Loading...</div>}><LAMatterList /></Suspense>} />
        <Route path="matters/:id" element={<Suspense fallback={<div>Loading...</div>}><LAMatterDetail /></Suspense>} />
        <Route path="intake" element={<Suspense fallback={<div>Loading...</div>}><LAMatterIntake /></Suspense>} />
        <Route path="workbaskets" element={<Suspense fallback={<div>Loading...</div>}><LAWorkbaskets /></Suspense>} />
        <Route path="my-workbasket" element={<Suspense fallback={<div>Loading...</div>}><LAPlaceholder title="My Workbasket" description="Matters assigned to you across all queues." /></Suspense>} />
        <Route path="team-workbasket" element={<Suspense fallback={<div>Loading...</div>}><LAPlaceholder title="Team Workbasket" description="Matters assigned to your team." /></Suspense>} />
        <Route path="advice" element={<Suspense fallback={<div>Loading...</div>}><LAPlaceholder title="Legal Advice Requests" description="Inbound advisory requests from other departments." /></Suspense>} />
        <Route path="contracts" element={<Suspense fallback={<div>Loading...</div>}><LAPlaceholder title="Contract & Document Reviews" description="Contracts and documents under legal review." /></Suspense>} />
        <Route path="employer-recovery" element={<Suspense fallback={<div>Loading...</div>}><LAPlaceholder title="Employer Recovery Matters" description="Recovery matters originating from compliance / employer arrears." /></Suspense>} />
        <Route path="ip-matters" element={<Suspense fallback={<div>Loading...</div>}><LAPlaceholder title="Benefit / Insured Person Matters" description="Legal matters relating to benefit claims and insured persons." /></Suspense>} />
        <Route path="documents" element={<Suspense fallback={<div>Loading...</div>}><LAPlaceholder title="Documents & Versions" description="Matter documents with version history." /></Suspense>} />
        <Route path="activities" element={<Suspense fallback={<div>Loading...</div>}><LAPlaceholder title="Activities & Tasks" description="Tasks, deadlines and activity timeline." /></Suspense>} />
        <Route path="reports" element={<Suspense fallback={<div>Loading...</div>}><LAPlaceholder title="Reports" description="Operational and management reports for legal matters." /></Suspense>} />
        <Route path="admin" element={<Suspense fallback={<div>Loading...</div>}><LAPlaceholder title="Legal Advanced Admin" description="Configure matter types, workbaskets, SLAs and routing." /></Suspense>} />
        <Route path="settings" element={<Suspense fallback={<div>Loading...</div>}><LASettings /></Suspense>} />
      </Route>


      <Route path="/legal/lg/cases/new" element={<Suspense fallback={<div>Loading...</div>}><LgCaseCreateWizard /></Suspense>} />
      <Route path="/legal/lg/cases/:id/edit" element={<Suspense fallback={<div>Loading...</div>}><LgCaseEdit /></Suspense>} />
      <Route path="/legal/lg/cases/:id" element={<Suspense fallback={<div>Loading...</div>}><LgCaseDetail /></Suspense>} />
      <Route path="/legal/admin/fees" element={<Suspense fallback={<div>Loading...</div>}><LgFeeConfig /></Suspense>} />
      <Route path="/legal/admin/policy" element={<Suspense fallback={<div>Loading...</div>}><LgPolicyConfig /></Suspense>} />
      {/* EPIC-06C — Judicial platform admin */}
      <Route path="/legal/admin/sla-policies" element={<Suspense fallback={<div>Loading...</div>}><LgSlaPoliciesAdmin /></Suspense>} />
      <Route path="/legal/admin/notification-rules" element={<Suspense fallback={<div>Loading...</div>}><LgNotificationRulesAdmin /></Suspense>} />
      <Route path="/legal/admin/template-registry" element={<Suspense fallback={<div>Loading...</div>}><LgTemplateRegistryAdmin /></Suspense>} />
      {/* EPIC-06D — Recovery Assignment (canonical /legal/lg/* routes) */}
      <Route path="/legal/lg/recovery-assignments" element={<Suspense fallback={<div>Loading...</div>}><LgRecoveryAssignmentWorkbench /></Suspense>} />
      <Route path="/legal/lg/recovery-assignments/:id" element={<Suspense fallback={<div>Loading...</div>}><LgRecoveryAssignmentWorkspace /></Suspense>} />
      <Route path="/legal/lg/recovery-campaigns" element={<Suspense fallback={<div>Loading...</div>}><LgRecoveryCampaignsList /></Suspense>} />
      {/* Legacy redirects — kept so bookmarks/deep links keep working */}
      <Route path="/legal/recovery/assignments" element={<Navigate to="/legal/lg/recovery-assignments" replace />} />
      <Route path="/legal/recovery/assignments/:id" element={<Navigate to="/legal/lg/recovery-assignments" replace />} />
      {/* Admin — canonical + legacy aliases */}
      <Route path="/legal/admin/recovery-strategy-types" element={<Suspense fallback={<div>Loading...</div>}><LgRecoveryStrategyTypesAdmin /></Suspense>} />
      <Route path="/legal/admin/recovery-strategies" element={<Navigate to="/legal/admin/recovery-strategy-types" replace />} />
      <Route path="/legal/admin/recovery-campaign-types" element={<Suspense fallback={<div>Loading...</div>}><LgRecoveryCampaignTypesAdmin /></Suspense>} />
      <Route path="/legal/admin/recovery-workload-rules" element={<Suspense fallback={<div>Loading...</div>}><LgRecoveryWorkloadRulesAdmin /></Suspense>} />
      {/* /legal/admin/recovery-assignment-statuses — screen not yet built; redirect to strategy-types admin */}
      <Route path="/legal/admin/recovery-assignment-statuses" element={<Navigate to="/legal/admin/recovery-strategy-types" replace />} />
      {/* Legal workflow admin — filtered view of central workflow engine */}
      <Route path="/legal/admin/workflow" element={<Suspense fallback={<div>Loading...</div>}><LegalAdminWorkflowManagement /></Suspense>} />

      <Route path="/legal/admin/waiver-policies" element={<Suspense fallback={<div>Loading...</div>}><LgFeeWaiverPolicyConfig /></Suspense>} />
      <Route path="/legal/admin/templates" element={<Suspense fallback={<div>Loading...</div>}><LegalTemplateManagement /></Suspense>} />
      <Route path="/legal/admin/templates/:id/edit" element={<Suspense fallback={<div>Loading...</div>}><LegalTemplateEditor /></Suspense>} />
      <Route path="/legal/admin/live-case-assignment-notice" element={<Suspense fallback={<div>Loading...</div>}><LegalCaseAssignmentLiveNotice /></Suspense>} />
      <Route path="/legal/admin/codesets" element={<Suspense fallback={<div>Loading...</div>}><LegalAdminCodeSets /></Suspense>} />
      {/* Alias of /codesets — new menu uses /code-sets */}
      <Route path="/legal/admin/code-sets" element={<Suspense fallback={<div>Loading...</div>}><LegalAdminCodeSets /></Suspense>} />
      <Route path="/legal/admin/complainant" element={<Suspense fallback={<div>Loading...</div>}><LegalAdminComplainant /></Suspense>} />
      <Route path="/legal/admin/teams" element={<Suspense fallback={<div>Loading...</div>}><LegalAdminTeams /></Suspense>} />
      <Route path="/legal/admin/staff" element={<Suspense fallback={<div>Loading...</div>}><LegalAdminStaff /></Suspense>} />
      <Route path="/legal/admin/legal-references" element={<Suspense fallback={<div>Loading...</div>}><LegalReferenceLibrary /></Suspense>} />
      <Route path="/legal/admin/legal-references/verification" element={<Suspense fallback={<div>Loading...</div>}><LegalReferenceVerification /></Suspense>} />
      <Route path="/legal/admin/stage-template-mapping" element={<Suspense fallback={<div>Loading...</div>}><LegalStageTemplateMapping /></Suspense>} />
      <Route path="/legal/admin/stage-reference-mapping" element={<Suspense fallback={<div>Loading...</div>}><LegalStageReferenceMapping /></Suspense>} />
      <Route path="/legal/admin/stage-document-rules" element={<Suspense fallback={<div>Loading...</div>}><LegalStageDocumentRules /></Suspense>} />
      {/* New grouped leaves — placeholder UIs (seeded in app_modules) */}
      <Route path="/legal/admin/profile" element={<Suspense fallback={<div>Loading...</div>}><LegalAdminDepartmentProfile /></Suspense>} />
      <Route path="/admin/communication" element={<Suspense fallback={<div>Loading...</div>}><CommunicationAssetsAdmin /></Suspense>} />
      <Route path="/admin/communication/:kind" element={<Suspense fallback={<div>Loading...</div>}><CommunicationAssetsAdmin /></Suspense>} />
      {/* Legacy tabbed page — now redirected to the new 5-section shell.
          `OrganizationManagementAdmin` remains importable for the redirect fallbacks below. */}
      <Route path="/admin/organization-management" element={<Navigate to="/admin/org/foundation/profile" replace />} />
      <Route path="/admin/organization-management/legacy" element={<Suspense fallback={<div>Loading...</div>}><OrganizationManagementAdmin /></Suspense>} />
      {/* Organization Management — dual navigation.
          - /admin/org/overview          → tabbed hub (OrganizationManagementShell)
          - /admin/org/:section/:leaf    → direct single-page (OrganizationDirectLeaf)
          Both share the same section+leaf catalogue in `_sections.tsx`. */}
      <Route path="/admin/org" element={<Navigate to="/admin/org/overview" replace />} />
      <Route path="/admin/org/overview" element={<Suspense fallback={<div>Loading...</div>}><OrganizationManagementShell /></Suspense>} />
      <Route path="/admin/org/overview/:section/:leaf" element={<Suspense fallback={<div>Loading...</div>}><OrganizationManagementShell /></Suspense>} />
      <Route path="/admin/org/overview/configuration-center" element={<Suspense fallback={<div>Loading...</div>}><OrganizationManagementShell /></Suspense>} />
      <Route path="/admin/org/overview/validation" element={<Suspense fallback={<div>Loading...</div>}><OrganizationManagementShell /></Suspense>} />

      {/* In-app User Manual for Organisation Management (docs only, no feature changes) */}
      <Route path="/admin/help/organization-management" element={<Suspense fallback={<div>Loading...</div>}><OrganizationManualShell /></Suspense>}>
        <Route index element={<Suspense fallback={<div>Loading...</div>}><OrganizationManualPage /></Suspense>} />
        <Route path=":slug" element={<Suspense fallback={<div>Loading...</div>}><OrganizationManualPage /></Suspense>} />
      </Route>
      <Route path="/admin/help/organization-management/print" element={<Suspense fallback={<div>Loading...</div>}><OrganizationManualShell /></Suspense>} />
      {/* Direct leaf routes (each menu item opens its own page — no tab chrome) */}
      <Route path="/admin/org/:section/:leaf" element={<Suspense fallback={<div>Loading...</div>}><OrganizationDirectLeaf /></Suspense>} />
      <Route path="/admin/org/configuration-center" element={<Suspense fallback={<div>Loading...</div>}><OrganizationDirectLeaf /></Suspense>} />
      <Route path="/admin/org/validation" element={<Suspense fallback={<div>Loading...</div>}><OrganizationDirectLeaf /></Suspense>} />

      {/* OM-4 — Communication & Template Management shell.
          Reuses the Organisation section catalogue but presents only
          assets / template library / configuration / validation to keep
          Organisation Foundation navigation focused. */}
      <Route path="/admin/template-management" element={<Suspense fallback={<div>Loading...</div>}><TemplateManagementShell /></Suspense>} />
      <Route path="/admin/template-management/:section/:leaf" element={<Suspense fallback={<div>Loading...</div>}><TemplateManagementShell /></Suspense>} />
      <Route path="/admin/template-management/configuration-center" element={<Suspense fallback={<div>Loading...</div>}><TemplateManagementShell /></Suspense>} />
      <Route path="/admin/template-management/validation" element={<Suspense fallback={<div>Loading...</div>}><TemplateManagementShell /></Suspense>} />

      {/* Enterprise Communication Hub (Phase 1 — menu shell + Phase 2 placeholders) */}
      <Route path="/admin/communication-hub" element={<CommHubAdminRoute><Suspense fallback={<div>Loading...</div>}><CommunicationHubShell /></Suspense></CommHubAdminRoute>} />
      <Route path="/admin/communication-hub/requests" element={<CommHubAdminRoute><Suspense fallback={<div>Loading...</div>}><CommHubRequestsPage /></Suspense></CommHubAdminRoute>} />
      <Route path="/admin/communication-hub/requests/:requestId" element={<CommHubAdminRoute><Suspense fallback={<div>Loading...</div>}><CommHubRequestDetailPage /></Suspense></CommHubAdminRoute>} />
      <Route path="/admin/communication-hub/delivery-monitor" element={<CommHubAdminRoute><Suspense fallback={<div>Loading...</div>}><CommHubDeliveryMonitorPage /></Suspense></CommHubAdminRoute>} />
      <Route path="/admin/communication-hub/retry-queue" element={<CommHubAdminRoute><Suspense fallback={<div>Loading...</div>}><CommHubRetryQueuePage /></Suspense></CommHubAdminRoute>} />
      <Route path="/admin/communication-hub/print-queue" element={<CommHubAdminRoute><Suspense fallback={<div>Loading...</div>}><CommHubPrintQueuePage /></Suspense></CommHubAdminRoute>} />
      <Route path="/admin/communication-hub/dispatch-register" element={<CommHubAdminRoute><Suspense fallback={<div>Loading...</div>}><CommHubDispatchRegisterPage /></Suspense></CommHubAdminRoute>} />
      <Route path="/admin/communication-hub/lifecycle-log" element={<CommHubAdminRoute><Suspense fallback={<div>Loading...</div>}><CommHubLifecycleLogPage /></Suspense></CommHubAdminRoute>} />
      <Route path="/admin/communication-hub/control-center" element={<CommHubAdminRoute><Suspense fallback={<div>Loading...</div>}><CommHubControlCenterPage /></Suspense></CommHubAdminRoute>} />
      <Route path="/admin/communication-hub/safety" element={<CommHubAdminRoute><Suspense fallback={<div>Loading...</div>}><CommHubSafetySwitchboardPage /></Suspense></CommHubAdminRoute>} />
      <Route path="/admin/communication-hub/recipient-control" element={<CommHubAdminRoute><Suspense fallback={<div>Loading...</div>}><CommHubRecipientControlPage /></Suspense></CommHubAdminRoute>} />
      <Route path="/admin/communication-hub/recipient-policy" element={<CommHubAdminRoute><Suspense fallback={<div>Loading...</div>}><CommHubRecipientPolicySettingsPage /></Suspense></CommHubAdminRoute>} />
      <Route path="/admin/communication-hub/design" element={<CommHubAdminRoute><Suspense fallback={<div>Loading...</div>}><CommHubDesignPage /></Suspense></CommHubAdminRoute>} />
      <Route path="/admin/communication-hub/design/sender-profiles" element={<CommHubAdminRoute><Suspense fallback={<div>Loading...</div>}><CommHubSenderProfilesPage /></Suspense></CommHubAdminRoute>} />
      <Route path="/admin/communication-hub/design/sender-verification" element={<CommHubAdminRoute><Suspense fallback={<div>Loading...</div>}><CommHubSenderVerificationPage /></Suspense></CommHubAdminRoute>} />
      <Route path="/admin/communication-hub/onboarding" element={<CommHubAdminRoute><Suspense fallback={<div>Loading...</div>}><CommHubOnboardingPage /></Suspense></CommHubAdminRoute>} />
      <Route path="/admin/communication-hub/onboarding/event-template-wizard" element={<CommHubAdminRoute><Suspense fallback={<div>Loading...</div>}><CommHubEventTemplateWizardPage /></Suspense></CommHubAdminRoute>} />
      <Route path="/admin/communication-hub/onboarding/module-adapter-tests" element={<CommHubAdminRoute><Suspense fallback={<div>Loading...</div>}><CommHubModuleAdapterTestsPage /></Suspense></CommHubAdminRoute>} />
      <Route path="/admin/communication-hub/pilots" element={<CommHubAdminRoute><Suspense fallback={<div>Loading...</div>}><CommHubPilotsPage /></Suspense></CommHubAdminRoute>} />
      {/* /admin/communication-hub/go-live moved into the shared workspace layout below. */}
      <Route path="/admin/communication-hub/test-diagnostics" element={<CommHubAdminRoute><Suspense fallback={<div>Loading...</div>}><CommHubTestDiagnosticsPage /></Suspense></CommHubAdminRoute>} />
      <Route path="/admin/communication-hub/testing/controlled-live-test" element={<CommHubAdminRoute><Suspense fallback={<div>Loading...</div>}><CommHubControlledLiveTestPage /></Suspense></CommHubAdminRoute>} />

      {/* Shared workspace layout: mounts RuntimeContractProvider + WorkspaceProvider ONCE across the four Go-Live tabs. */}
      <Route element={<CommHubAdminRoute><Suspense fallback={<div>Loading...</div>}><CommHubWorkspaceLayout /></Suspense></CommHubAdminRoute>}>
        <Route path="/admin/communication-hub/go-live" element={<Suspense fallback={<div>Loading...</div>}><CommHubSimpleOperationsPage /></Suspense>} />
        <Route path="/admin/communication-hub/go-live/advanced" element={<Suspense fallback={<div>Loading...</div>}><CommHubGoLivePage /></Suspense>} />
        <Route path="/admin/communication-hub/readiness" element={<Suspense fallback={<div>Loading...</div>}><CommHubReadinessCenterPage /></Suspense>} />
        <Route path="/admin/communication-hub/revalidation" element={<Suspense fallback={<div>Loading...</div>}><CommHubRevalidationWorkspacePage /></Suspense>} />
        <Route path="/admin/communication-hub/audit" element={<Suspense fallback={<div>Loading...</div>}><CommHubAuditEvidenceWorkspacePage /></Suspense>} />
      </Route>
      <Route path="/admin/communication-hub/governance" element={<CommHubAdminRoute><Suspense fallback={<div>Loading...</div>}><CommHubGovernancePage /></Suspense></CommHubAdminRoute>} />
{/* MOVED_BELOW_GOLIVE_ROUTES */}
      <Route path="/admin/communication-hub/live-readiness/all-events" element={<CommHubAdminRoute><Suspense fallback={<div>Loading...</div>}><CommHubAllEventsLiveReadinessPage /></Suspense></CommHubAdminRoute>} />
      <Route path="/admin/communication-hub/production-readiness" element={<CommHubAdminRoute><Suspense fallback={<div>Loading...</div>}><CommHubProductionReadinessPage /></Suspense></CommHubAdminRoute>} />

      <Route path="/admin/communication-hub/governance/send-policies" element={<CommHubAdminRoute><Suspense fallback={<div>Loading...</div>}><CommHubSendPoliciesPage /></Suspense></CommHubAdminRoute>} />
      <Route path="/admin/communication-hub/governance/automation-settings" element={<CommHubAdminRoute><Suspense fallback={<div>Loading...</div>}><CommHubAutomationSettingsPage /></Suspense></CommHubAdminRoute>} />
      <Route path="/admin/communication-hub/traces" element={<CommHubAdminRoute><Suspense fallback={<div>Loading...</div>}><CommHubTraceCenterPage /></Suspense></CommHubAdminRoute>} />
      <Route path="/admin/communication-hub/traces/:traceId" element={<CommHubAdminRoute><Suspense fallback={<div>Loading...</div>}><CommHubTraceDetailPage /></Suspense></CommHubAdminRoute>} />




      {/* Phase 1 redirects from old ?tab= URLs to the new IA */}
      <Route path="/admin/organization-management/redirect/organization"     element={<Navigate to="/admin/org/foundation/profile" replace />} />
      <Route path="/admin/organization-management/redirect/locations"        element={<Navigate to="/admin/org/foundation/locations" replace />} />
      <Route path="/admin/organization-management/redirect/departments"      element={<Navigate to="/admin/org/foundation/departments" replace />} />
      <Route path="/admin/organization-management/redirect/modules"          element={<Navigate to="/admin/org/foundation/modules" replace />} />
      <Route path="/admin/organization-management/redirect/assets"           element={<Navigate to="/admin/org/assets/media" replace />} />
      <Route path="/admin/organization-management/redirect/asset-categories" element={<Navigate to="/admin/org/assets/categories" replace />} />
      <Route path="/admin/organization-management/redirect/text-blocks"      element={<Navigate to="/admin/org/library/text-blocks" replace />} />
      <Route path="/admin/organization-management/redirect/assignments"      element={<Navigate to="/admin/org/configuration-center" replace />} />
      <Route path="/admin/organization-management/redirect/usage"            element={<Navigate to="/admin/org/validation/usage" replace />} />
      {/* Legacy leaf ids renamed during full IA restructure — one-hop redirects preserve bookmarks. */}
      <Route path="/admin/org/validation/engine" element={<Navigate to="/admin/org/validation/health" replace />} />
      <Route path="/admin/org/configuration-center/assignments" element={<Navigate to="/admin/org/configuration-center?domain=communication" replace />} />
      <Route path="/admin/organization/profile" element={<Suspense fallback={<div>Loading...</div>}><OrganizationProfilePage /></Suspense>} />
      <Route path="/admin/organization/locations" element={<Navigate to="/admin/offices?tab=locations" replace />} />
      {/* Epic 7 – Organization Foundation aliases and new pages */}
      <Route path="/admin/organisation-profile" element={<Suspense fallback={<div>Loading...</div>}><OrganizationProfilePage /></Suspense>} />
      <Route path="/admin/calendar-holidays" element={<Suspense fallback={<div>Loading...</div>}><CalendarHolidaysPage /></Suspense>} />
      <Route path="/admin/locations" element={<Suspense fallback={<div>Loading...</div>}><OfficeLocationsPage /></Suspense>} />
      {/* Phase 3 dedup: canonical communication assets URL is /admin/communication */}
      {/* DEPRECATED (2026-07-01): legacy menu codes `org_comm_assets` and `org_letterheads`.
          Kept as hidden redirect stubs for one release cycle to preserve bookmarks / saved links.
          Safe to remove after bookmark impact is verified (target: next release cycle).
          Canonical routes: /admin/communication and /admin/communication/letterhead. */}
      <Route path="/admin/organization/communication-assets" element={<Navigate to="/admin/communication" replace />} />
      <Route path="/admin/organization/departments" element={<Navigate to="/admin/departments?tab=profiles" replace />} />
      <Route path="/admin/organization/usage" element={<Suspense fallback={<div>Loading...</div>}><OrgUsageValidationPage /></Suspense>} />
      <Route path="/admin/organization/media-library" element={<Suspense fallback={<div>Loading...</div>}><OrgMediaLibraryPage /></Suspense>} />
      <Route path="/admin/organization/letterheads" element={<Suspense fallback={<div>Loading...</div>}><OrgLetterheadsPage /></Suspense>} />
      <Route path="/admin/organization/notification-templates" element={<Navigate to="/admin/notification-templates?tab=org" replace />} />
      <Route path="/admin/organization/portal-branding" element={<Suspense fallback={<div>Loading...</div>}><OrgPortalBrandingPage /></Suspense>} />
      <Route path="/admin/organization/document-assets" element={<Suspense fallback={<div>Loading...</div>}><OrgDocumentAssetsPage /></Suspense>} />
      <Route path="/admin/organization/department-mapping" element={<Navigate to="/admin/departments?tab=mapping" replace />} />
      <Route path="/admin/organization/text-blocks" element={<Suspense fallback={<div>Loading...</div>}><OrgTextBlocksPage /></Suspense>} />
      <Route path="/admin/organization/modules" element={<Navigate to="/admin/modules" replace />} />
      <Route path="/admin/organization/enterprise-health" element={<Suspense fallback={<div>Loading...</div>}><EnterpriseHealthPage /></Suspense>} />
      <Route path="/legal/admin/routing" element={<Suspense fallback={<div>Loading...</div>}><LegalAdminRouting /></Suspense>} />
      <Route path="/legal/admin/document-types" element={<Suspense fallback={<div>Loading...</div>}><LegalAdminPlaceholder title="Document Types" description="Catalog of legal document types used across cases." permissionCode="lg_admin_doc_types" /></Suspense>} />
      <Route path="/legal/admin/fee-bundles" element={<Suspense fallback={<div>Loading...</div>}><LegalAdminPlaceholder title="Fee Bundles" description="Pre-defined groups of fees that can be applied together." permissionCode="lg_admin_fee_bundles" /></Suspense>} />
      <Route path="/legal/admin/permissions" element={<Suspense fallback={<div>Loading...</div>}><LegalAdminPlaceholder title="Permissions" description="Legal role-permission matrix overview." permissionCode="lg_admin_permissions" /></Suspense>} />
      <Route path="/legal/admin/audit" element={<Suspense fallback={<div>Loading...</div>}><LegalAdminPlaceholder title="Audit Log" description="Audit trail for Legal Admin configuration changes." permissionCode="lg_admin_audit_log" /></Suspense>} />
      <Route path="/legal/admin/validation" element={<Suspense fallback={<div>Loading...</div>}><LegalAdminValidationReport /></Suspense>} />
      <Route path="/legal/admin/referral-integrity" element={<Suspense fallback={<div>Loading...</div>}><LegalAdminReferralIntegrity /></Suspense>} />
      <Route path="/legal/admin/case-integrity" element={<Suspense fallback={<div>Loading...</div>}><LegalAdminCaseIntegrity /></Suspense>} />
      <Route path="/legal/admin/assignment-integrity" element={<Suspense fallback={<div>Loading...</div>}><LegalAdminAssignmentIntegrity /></Suspense>} />
      <Route path="/legal/admin/sla-rules" element={<Suspense fallback={<div>Loading...</div>}><LegalAdminSlaRules /></Suspense>} />
      <Route path="/legal/admin/matter-workspace-integrity" element={<Suspense fallback={<div>Loading...</div>}><LegalMatterWorkspaceIntegrity /></Suspense>} />
      <Route path="/legal/admin/courts" element={<Suspense fallback={<div>Loading...</div>}><LegalCourtAdmin /></Suspense>} />
      <Route path="/admin/dms" element={<Suspense fallback={<div>Loading...</div>}><CoreDmsAdmin /></Suspense>} />
      <Route path="/admin/dms-api-test" element={<Suspense fallback={<div>Loading...</div>}><DmsApiTest /></Suspense>} />
      <Route path="/admin/core-templates" element={<Navigate to="/admin/notification-templates?tab=core" replace />} />
      {/* Filtered entrypoints into the single Core Template Designer */}
      <Route path="/admin/comm/templates" element={<Navigate to="/admin/notification-templates?tab=core" replace />} />
      <Route path="/admin/comm/templates/email" element={<Navigate to="/admin/notification-templates?tab=core&type=EMAIL&channel=EMAIL" replace />} />
      <Route path="/admin/comm/templates/letter" element={<Navigate to="/admin/notification-templates?tab=core&type=LETTER&channel=PRINT_LETTER" replace />} />
      <Route path="/admin/comm/templates/notice" element={<Navigate to="/admin/notification-templates?tab=core&type=NOTICE" replace />} />
      <Route path="/admin/comm/templates/document" element={<Navigate to="/admin/notification-templates?tab=core&type=PDF" replace />} />
      <Route path="/admin/comm/templates/certificate" element={<Navigate to="/admin/notification-templates?tab=core&type=CERTIFICATE" replace />} />
      <Route path="/admin/comm/templates/statement" element={<Navigate to="/admin/notification-templates?tab=core&type=STATEMENT" replace />} />
      <Route path="/admin/comm/templates/receipt" element={<Navigate to="/admin/notification-templates?tab=core&type=RECEIPT" replace />} />
      <Route path="/admin/comm/templates/sms" element={<Navigate to="/admin/notification-templates?tab=core&type=SMS&channel=SMS" replace />} />
      <Route path="/admin/comm/templates/whatsapp" element={<Navigate to="/admin/notification-templates?tab=core&type=WHATSAPP" replace />} />
      <Route path="/admin/comm/templates/in-app" element={<Navigate to="/admin/notification-templates?tab=core&type=IN_APP&channel=PORTAL_MSG" replace />} />
      <Route path="/admin/comm/templates/report" element={<Navigate to="/admin/notification-templates?tab=core&type=REPORT" replace />} />
      <Route path="/admin/configuration/template-assignments" element={<Suspense fallback={<div>Loading...</div>}><TemplateAssignmentsPage /></Suspense>} />
      {/* Legacy per-module template editors → central designer with module filters */}
      <Route path="/admin/org/library/templates" element={<Navigate to="/admin/notification-templates?tab=core" replace />} />
      <Route path="/documents/templates" element={<Navigate to="/admin/notification-templates?tab=core&type=PDF" replace />} />
      <Route path="/employers/templates" element={<Navigate to="/admin/notification-templates?tab=core&module=EMPLOYER" replace />} />
      <Route path="/insured-persons/templates" element={<Navigate to="/admin/notification-templates?tab=core&module=MEMBER" replace />} />
      <Route path="/finance/templates" element={<Navigate to="/admin/notification-templates?tab=core&module=PAYMENTS" replace />} />
      <Route path="/bn/config/communication-templates" element={<Navigate to="/admin/notification-templates?tab=core&module=BENEFITS" replace />} />
      <Route path="/nbenefit/shared/document-templates" element={<Navigate to="/admin/notification-templates?tab=core&module=BENEFITS&type=PDF" replace />} />
      <Route path="/compliance/admin/communication-templates" element={<Navigate to="/admin/notification-templates?tab=core&module=COMPLIANCE" replace />} />
      <Route path="/compliance/admin/report-templates" element={<Navigate to="/admin/notification-templates?tab=core&module=COMPLIANCE&type=NOTICE" replace />} />
      <Route path="/legal/templates" element={<Navigate to="/admin/notification-templates?tab=core&module=LEGAL" replace />} />



      <Route path="/legal/workbench" element={<Suspense fallback={<div>Loading...</div>}><LegalUnifiedWorkbench /></Suspense>} />
      <Route path="/legal/workbench/legacy" element={<Navigate to="/legal/lg/dashboard" replace />} />
      <Route path="/legal/cases" element={<CaseTracking />} />
      <Route path="/legal/cases/intake" element={<CaseIntake />} />
      <Route path="/legal/cases/delinquent" element={<DelinquentCases />} />
      <Route path="/legal/hearings" element={<Suspense fallback={<div>Loading...</div>}><LegalHearingCalendar /></Suspense>} />
      <Route path="/legal/config/reference-data" element={<Suspense fallback={<div>Loading...</div>}><LegalReferenceData /></Suspense>} />
      <Route path="/legal/config/reference-legacy" element={<Suspense fallback={<div>Loading...</div>}><LegalReferenceLegacyValues /></Suspense>} />
      {/* Legacy Court Orders / Enforcement / Payment Plans — redirected to canonical EPIC-06B workbench. */}
      <Route path="/legal/court-orders" element={<Navigate to="/legal/lg/orders" replace />} />
      <Route path="/legal/enforcement" element={<Navigate to="/legal/lg/orders" replace />} />
      <Route path="/legal/payment-plans" element={<Navigate to="/legal/lg/orders" replace />} />
      <Route path="/legal/reports/cases-by-stage" element={<CasesByStageReport />} />
      <Route path="/legal/reports/recovery" element={<RecoveryAnalysis />} />
      <Route path="/legal/reports/aging" element={<AgingReceivables />} />
      <Route path="/legal/reports/costs-fees" element={<CourtCostsFees />} />
      <Route path="/legal/reports/performance" element={<PerformanceMetrics />} />
      <Route path="/legal/reports/pending-hearings" element={<PendingHearings />} />
      <Route path="/legal/reports" element={<LegalReportsCentre />} />
      <Route path="/legal/reports/executive" element={<ExecutiveKpiDashboard />} />
      <Route path="/legal/reports/analytics/:kind" element={<LegalAnalyticsDashboard />} />
      <Route path="/legal/reports/personalize" element={<LegalDashboardPersonalization />} />
      <Route path="/legal/reports/run/:code" element={<LegalReportRunner />} />
      <Route path="/legal/reports/command-centre" element={<ExecutiveCommandCentre />} />
      <Route path="/legal/reports/data-quality" element={<DataQualityDashboard />} />
      <Route path="/legal/reports/exports" element={<ExportCentre />} />
      <Route path="/legal/reports/performance" element={<PerformanceMonitoring />} />
      <Route path="/legal/reports/audit" element={<ReportAudit />} />
      <Route path="/legal/reports/shared" element={<SharedDashboards />} />
      <Route path="/legal/reports/certification" element={<ReportCertificationPage />} />



      <Route path="/legal/reports/lg" element={<Navigate to="/legal/reports" replace />} />
      <Route path="/legal/reports/legacy-hub" element={<LgReportsHub />} />
      <Route path="/legal/reports/lg/cases-by-stage" element={<LgCasesByStageReport />} />
      <Route path="/legal/reports/lg/cases-by-officer" element={<LgCasesByOfficerReport />} />
      <Route path="/legal/reports/lg/cases-by-territory" element={<LgCasesByTerritoryReport />} />
      <Route path="/legal/reports/lg/ageing" element={<LgAgeingReport />} />
      <Route path="/legal/reports/lg/overdue-hearings" element={<LgOverdueHearingsReport />} />
      <Route path="/legal/reports/lg/sla-breach" element={<LgSlaBreachReport />} />
      <Route path="/legal/reports/lg/recovery" element={<LgRecoveryReport />} />
      <Route path="/legal/reports/lg/judgment-order" element={<LgJudgmentOrderReport />} />
      <Route path="/legal/reports/lg/referral-source" element={<LgReferralSourceReport />} />
      <Route path="/legal/reports/lg/closed-cases" element={<LgClosedCasesReport />} />
      <Route path="/legal/reports/lg/pending-action" element={<LgPendingActionReport />} />
      <Route path="/legal/settings/courts" element={<CourtsJudges />} />
      <Route path="/legal/settings/hearing-types" element={<HearingTypes />} />
      <Route path="/legal/settings/statuses" element={<CaseStatuses />} />
      <Route path="/legal/settings/workflow" element={<CaseWorkflow />} />
      <Route path="/legal/settings/roles" element={<LegalRoles />} />
      <Route path="/legal/settings/fee-mappings" element={<FeeMappings />} />
      <Route path="/legal/settings/territory" element={<TerritorySettings />} />
      
      {/* Legal Module Routes - Old */}
      <Route path="/legal" element={<NewLegalModule />} />
      <Route path="/legal/case-intake" element={<CaseIntake />} />
      {/* duplicate /legal/cases/intake removed — canonical registration at line 1832 */}

      <Route path="/legal/cases/intake/:id" element={<IntakeDetail />} />
      <Route path="/legal/admin/intake-validation" element={<IntakeValidationReport />} />
      <Route path="/compliance/cases/:ceCaseId/legal-referral" element={<ComplianceLegalReferralWizard />} />
      <Route path="/compliance/legal-referral" element={<ComplianceLegalReferralWizard />} />
      <Route path="/bn/claims/:claimId/legal-referral" element={<BenefitsLegalReferralWizard />} />
      <Route path="/bn/legal-referral" element={<BenefitsLegalReferralWizard />} />
      <Route path="/compliance/legal-referral/launcher" element={<ComplianceLegalReferralLauncher />} />
      <Route path="/bn/legal-referral/launcher" element={<BenefitsLegalReferralLauncher />} />

      <Route path="/legal/case-tracking" element={<CaseTracking />} />
      <Route path="/bn/legal-referrals" element={<BenefitsLegalReferrals />} />
      <Route path="/compliance/legal-referrals" element={<ComplianceLegalReferrals />} />
      <Route path="/legal/referrals-workbench" element={<LegalReferralsWorkbench />} />
      <Route path="/bn/legal-referrals/respond/:infoRequestId" element={<BenefitsLegalReferrals />} />
      <Route path="/compliance/legal-referrals/respond/:infoRequestId" element={<ComplianceLegalReferrals />} />
      <Route path="/legal/case-detail/:id" element={<CaseDetailView />} />
      <Route path="/legal/case-edit/:id" element={<CaseEditView />} />
      <Route path="/legal/notices" element={<LgNoticeRegister />} />
      <Route path="/legal/notices/generate" element={<NoticeGeneration />} />

      <Route path="/legal/appeals" element={<AppealSubmission />} />
      <Route path="/legal/evidence" element={<LegalEvidenceManagement />} />
      {/* /legal/admin renders the grouped Administration hub */}
      <Route path="/legal/admin" element={<Suspense fallback={<div>Loading...</div>}><LegalAdminHub /></Suspense>} />
      <Route path="/legal/admin/legacy" element={<Navigate to="/legal/admin/profile" replace />} />
      </Route>
      {/* end LegalRouteGuard */}

      {/* LegalFinal prototype — deprecated. All routes redirect to the canonical
          Legal V1 dashboard. Files under src/pages/legalFinal/ are pending
          deletion after one release cycle (see LEGAL_LEGACY_RETIREMENT_AUDIT.md). */}
      <Route path="/legal-final" element={<Navigate to="/legal/dashboard" replace />} />
      <Route path="/legal-final/new-case" element={<Navigate to="/legal/lg/intake" replace />} />
      <Route path="/legal-final/cases" element={<Navigate to="/legal/lg/cases" replace />} />
      <Route path="/legal-final/cases/:caseId/edit" element={<Navigate to="/legal/lg/cases" replace />} />
      <Route path="/legal-final/cases/:caseId/documents" element={<Navigate to="/legal/documents" replace />} />
      <Route path="/legal-final/cases/:caseId/hearing" element={<Navigate to="/legal/lg/hearing-workbench" replace />} />
      <Route path="/legal-final/cases/:caseId/enforcement" element={<Navigate to="/legal/lg/orders" replace />} />
      <Route path="/legal-final/hearings" element={<Navigate to="/legal/lg/hearing-workbench" replace />} />
      <Route path="/legal-final/enforcement" element={<Navigate to="/legal/lg/orders" replace />} />
      <Route path="/legal-final/reports" element={<Navigate to="/legal/reports" replace />} />

      {/* Notification Routes */}
      <Route path="/notifications/dashboard" element={<NotificationDashboard />} />
      <Route path="/notifications/templates" element={<Navigate to="/admin/notification-templates" replace />} />
      <Route path="/notifications/actions" element={<ActionMapping />} />
      <Route path="/notifications/delivery" element={<DeliveryManagement />} />
      <Route path="/notifications/preferences" element={<UserPreferences />} />
      <Route path="/notifications/center" element={<NotificationCenter />} />
      <Route path="/notifications/reports" element={<ReportsAnalytics />} />
          <Route path="/notifications/admin" element={<Administration />} />

          {/* NewBenefit Routes
              Epic 0.2 (BN Navigation Foundation):
              - Staff-facing screens with a canonical /bn/* equivalent now redirect.
              - Portal-like contributor/employer screens (dashboard, apply, my-claims,
                inbox, reports, new-referral, new-verification, verification/:id,
                employer-hub, medical-board, admin) are INVESTIGATE — kept as-is
                until they are migrated to src/portals/*. Do not force them into /bn/*. */}
          <Route path="/newbenefit/dashboard" element={<ContributorDashboard />} />
          <Route path="/newbenefit/apply" element={<ApplyForBenefits />} />
          <Route path="/newbenefit/apply/:benefitType" element={<BenefitApplicationForm />} />
          <Route path="/newbenefit/new-referral" element={<NewReferralForm />} />
          <Route path="/newbenefit/new-verification" element={<NewVerificationRequest />} />
          <Route path="/newbenefit/verification/:verificationId" element={<EmploymentVerificationDetail />} />
          <Route path="/newbenefit/my-claims" element={<MyClaims />} />
          <Route path="/newbenefit/reports" element={<ContributorReports />} />
          <Route path="/newbenefit/inbox" element={<ContributorInbox />} />
          <Route path="/newbenefit/worklists" element={<Navigate to="/bn/worklist" replace />} />
          {/* INVESTIGATE: :claimId param cannot be interpolated by <Navigate>; needs shim component */}
          <Route path="/newbenefit/claim-360/:claimId" element={<Claim360View />} />
          <Route path="/newbenefit/intake" element={<Navigate to="/bn/intake/register" replace />} />
          {/* INVESTIGATE: medical-board parity check pending before redirect */}
          <Route path="/newbenefit/medical-board" element={<MedicalBoardHub />} />
          {/* INVESTIGATE: employer-hub belongs in src/portals/employer/* */}
          <Route path="/newbenefit/employer-hub" element={<EmployerHub />} />
          <Route path="/newbenefit/pension-admin" element={<Navigate to="/bn/awards" replace />} />
          <Route path="/newbenefit/payments" element={<Navigate to="/bn/payables" replace />} />
          <Route path="/newbenefit/communications" element={<Navigate to="/admin/notification-templates?tab=core&module=BENEFITS" replace />} />
          {/* INVESTIGATE: admin target (Platform vs bn/config/products) not confirmed */}
          <Route path="/newbenefit/admin" element={<AdminConfig />} />
          <Route path="/newbenefit/auditor" element={<Navigate to="/bn/audit-history" replace />} />

      {/* Benefit Management Module (bn_) */}
      <Route path="/bn/dashboard" element={<BnFeatureGate flag="bn.enabled"><BenefitsDashboard /></BnFeatureGate>} />
      <Route path="/bn/person-360" element={<BnFeatureGate flag="bn.person360"><BnPerson360 /></BnFeatureGate>} />
      <Route path="/bn/config/products" element={<BnFeatureGate flag="bn.config.products"><BnProductCatalog /></BnFeatureGate>} />
      <Route path="/bn/config/products/:id" element={<BnFeatureGate flag="bn.config.products"><BnProductEditor /></BnFeatureGate>} />
      <Route path="/bn/claims" element={<BnFeatureGate flag="bn.claims.workbench"><BnClaimWorklist /></BnFeatureGate>} />
      <Route path="/bn/claims/:id" element={<BnFeatureGate flag="bn.claims.workbench"><BnClaimWorkbench /></BnFeatureGate>} />
      <Route path="/bn/claims/:id/legacy" element={<BnFeatureGate flag="bn.claim360"><BnClaim360 /></BnFeatureGate>} />
      <Route path="/bn/claims/:id/determination" element={<BnFeatureGate flag="bn.claims.workbench"><BnBenefitDetermination /></BnFeatureGate>} />
      <Route path="/bn/claims/:id/eligibility" element={<BnFeatureGate flag="bn.claims.workbench"><BnEligibilityReview /></BnFeatureGate>} />
      <Route path="/bn/claims/:id/calculation" element={<BnFeatureGate flag="bn.claims.workbench"><BnCalculationWorkspace /></BnFeatureGate>} />
      <Route path="/bn/claims/:id/recommendation" element={<BnFeatureGate flag="bn.claims.workbench"><BnDeterminationRecommendation /></BnFeatureGate>} />
      <Route path="/bn/engine" element={<BnFeatureGate flag="bn.config.rules"><BnCalculationEngine /></BnFeatureGate>} />
      <Route path="/bn/intake/register" element={<BnFeatureGate flag="bn.claims.intake"><BnClaimRegistration /></BnFeatureGate>} />
      <Route path="/bn/queue" element={<BnFeatureGate flag="bn.claims.workbench"><BnClaimQueue /></BnFeatureGate>} />
      <Route path="/bn/approval" element={<BnFeatureGate flag="bn.claims.workbench"><BnApprovalConsole /></BnFeatureGate>} />
      <Route path="/bn/approval/workbaskets" element={<BnFeatureGate flag="bn.claims.workbench"><BnApprovalWorkbasketsConsole /></BnFeatureGate>} />
      <Route path="/bn/config/product-approvals" element={<BnFeatureGate flag="bn.claims.workbench"><BnProductApprovalConsole /></BnFeatureGate>} />
      <Route path="/bn/approval/queue" element={<BnFeatureGate flag="bn.claims.workbench"><BnApprovalQueue /></BnFeatureGate>} />
      <Route path="/bn/approval/workspace/:claimId" element={<BnFeatureGate flag="bn.claims.workbench"><BnAdjudicationWorkspace /></BnFeatureGate>} />
      <Route path="/bn/entitlements" element={<BnFeatureGate flag="bn.awards"><BnEntitlementManagement /></BnFeatureGate>} />
      <Route path="/bn/payables" element={<BnFeatureGate flag="bn.payments"><BnPayablesQueue /></BnFeatureGate>} />
      <Route path="/bn/schedules" element={<BnFeatureGate flag="bn.payments"><BnPaymentSchedule /></BnFeatureGate>} />
      <Route path="/bn/batches" element={<BnFeatureGate flag="bn.payments"><BnBatchOperations /></BnFeatureGate>} />
      <Route path="/bn/issue" element={<BnFeatureGate flag="bn.payments"><BnPaymentIssue /></BnFeatureGate>} />
      <Route path="/bn/post-issue" element={<BnFeatureGate flag="bn.payments"><BnPostIssueReview /></BnFeatureGate>} />
      <Route path="/bn/cheque-stock" element={<BnFeatureGate flag="bn.payments"><BnChequeStock /></BnFeatureGate>} />
      <Route path="/bn/payment-profiles" element={<BnFeatureGate flag="bn.payments"><BnPaymentProfiles /></BnFeatureGate>} />
      <Route path="/bn/config/payment-masters" element={<BnFeatureGate flag="bn.payments"><BnPaymentMasters /></BnFeatureGate>} />
      <Route path="/bn/admin/diagnostics" element={<BnDiagnostics />} />
      <Route path="/bn/admin/sql" element={<BnSqlEditor />} />
      <Route path="/bn/history" element={<BnFeatureGate flag="bn.historicalInquiry"><BnHistoricalInquiry /></BnFeatureGate>} />
      <Route path="/bn/exceptions" element={<BnFeatureGate flag="bn.payments"><BnPaymentExceptions /></BnFeatureGate>} />
      <Route path="/bn/post-issue-enhanced" element={<BnFeatureGate flag="bn.payments"><BnPostIssueEnhanced /></BnFeatureGate>} />
      <Route path="/bn/worklist" element={<BnFeatureGate flag="bn.claims.workbench"><BnClaimWorklistEnhanced /></BnFeatureGate>} />
      <Route path="/bn/payment-history" element={<BnFeatureGate flag="bn.payments"><BnPaymentHistoryInquiry /></BnFeatureGate>} />
      <Route path="/bn/audit-history" element={<BnFeatureGate flag="bn.enabled"><BnAuditDecisionHistory /></BnFeatureGate>} />
      <Route path="/bn/life-certificates" element={<BnFeatureGate flag="bn.servicing.lifeCert"><BnLifeCertificateManagement /></BnFeatureGate>} />
      <Route path="/bn/medical-reviews" element={<BnFeatureGate flag="bn.servicing.medicalReview"><BnMedicalReviewScheduler /></BnFeatureGate>} />
      <Route path="/bn/overpayments" element={<BnFeatureGate flag="bn.servicing.overpayment"><BnOverpaymentRecovery /></BnFeatureGate>} />
      <Route path="/bn/mortality" element={<BnFeatureGate flag="bn.gap.mortality"><BnMortalityPage /></BnFeatureGate>} />
      <Route path="/bn/mortality/new" element={<BnFeatureGate flag="bn.gap.mortality"><BnMortalityRegistrationPage /></BnFeatureGate>} />
      <Route path="/bn/mortality/:eventId" element={<BnFeatureGate flag="bn.gap.mortality"><BnMortalityDetailPage /></BnFeatureGate>} />
      {/* BN-AP-00 — Canonical Appeals & Disputes route. Subroutes reserved for AP-01. */}
      <Route path="/bn/appeals" element={<BnFeatureGate flag="bn.gap.appeals"><BnModuleRouteGate moduleCode="bn_appeals_dashboard" requiredAction="view" adminCapabilities={[{ moduleCode: 'bn_appeals', action: 'view' }]}>{() => <BnAppealsWorkspacePage />}</BnModuleRouteGate></BnFeatureGate>} />
      <Route path="/bn/appeals/new" element={<BnFeatureGate flag="bn.gap.appeals"><BnModuleRouteGate moduleCode="bn_appeals_register" requiredAction="view" adminCapabilities={[{ moduleCode: 'bn_appeals', action: 'view' }]}>{() => <BnAppealNewPreviewPage />}</BnModuleRouteGate></BnFeatureGate>} />
      <Route path="/bn/appeals/my-work" element={<BnFeatureGate flag="bn.gap.appeals"><BnModuleRouteGate moduleCode="bn_appeals_my_work" requiredAction="view" adminCapabilities={[{ moduleCode: 'bn_appeals', action: 'view' }]}>{() => <BnAppealMyWorkPage />}</BnModuleRouteGate></BnFeatureGate>} />
      <Route path="/bn/appeals/hearings" element={<BnFeatureGate flag="bn.gap.appeals"><BnModuleRouteGate moduleCode="bn_appeals_hearings" requiredAction="view" adminCapabilities={[{ moduleCode: 'bn_appeals', action: 'view' }]}>{() => <BnAppealHearingsPage />}</BnModuleRouteGate></BnFeatureGate>} />
      <Route path="/bn/appeals/implementation" element={<BnFeatureGate flag="bn.gap.appeals"><BnModuleRouteGate moduleCode="bn_appeals_implementation" requiredAction="view" adminCapabilities={[{ moduleCode: 'bn_appeals', action: 'view' }]}>{() => <BnAppealImplementationPage />}</BnModuleRouteGate></BnFeatureGate>} />
      <Route path="/bn/appeals/config" element={<BnFeatureGate flag="bn.gap.appeals"><BnModuleRouteGate moduleCode="bn_appeals_config" requiredAction="view" adminCapabilities={[{ moduleCode: 'bn_appeals', action: 'admin' }]}>{() => <BnAppealConfigPage />}</BnModuleRouteGate></BnFeatureGate>} />
      <Route path="/bn/appeals/:appealId" element={<BnFeatureGate flag="bn.gap.appeals"><BnModuleRouteGate moduleCode="bn_appeals_detail" requiredAction="view" adminCapabilities={[{ moduleCode: 'bn_appeals', action: 'view' }]}>{() => <BnAppealDetailPage />}</BnModuleRouteGate></BnFeatureGate>} />
      <Route path="/bn/appeals-workspace" element={<Navigate to="/bn/appeals" replace />} />

      <Route path="/bn/means-tests" element={<BnFeatureGate flag="bn.gap.meansTests"><BnMeansTestsPage /></BnFeatureGate>} />
      <Route path="/bn/risk-management" element={<BnFeatureGate flag="bn.gap.risk"><BnRiskManagementPage /></BnFeatureGate>} />
      <Route path="/bn/uprating" element={<BnFeatureGate flag="bn.gap.uprating"><BnUpratingPage /></BnFeatureGate>} />
      <Route path="/bn/award-suspension" element={<BnFeatureGate flag="bn.servicing.awardSuspension"><PermissionWrapper moduleName="bn_award_suspension"><BnAwardSuspensionConsole /></PermissionWrapper></BnFeatureGate>} />
      <Route path="/bn/survivors" element={<BnFeatureGate flag="bn.awards"><BnSurvivorsBenefitProcessing /></BnFeatureGate>} />
      <Route path="/bn/awards" element={<BnFeatureGate flag="bn.awards"><BnPensionerRegister /></BnFeatureGate>} />
      <Route path="/bn/awards/survivors" element={<BnFeatureGate flag="bn.awards"><BnSurvivorAwards /></BnFeatureGate>} />
      <Route path="/bn/awards/adjustments" element={<BnFeatureGate flag="bn.awards"><BnAwardAdjustments /></BnFeatureGate>} />
      <Route path="/bn/awards/:id" element={<BnFeatureGate flag="bn.awards"><BnAward360 /></BnFeatureGate>} />
      <Route path="/bn/config/reason-codes" element={<BnFeatureGate flag="bn.config.rules"><BnReasonCodes /></BnFeatureGate>} />
      <Route path="/bn/config/communication-templates" element={<BnFeatureGate flag="bn.config.rules"><BnBenefitCommunicationTemplates /></BnFeatureGate>} />
      <Route path="/bn/config/transitions" element={<BnFeatureGate flag="bn.config.rules"><BnTransitionMatrix /></BnFeatureGate>} />
      <Route path="/bn/config/workbaskets" element={<BnFeatureGate flag="bn.config.rules"><BnWorkbasketConfig /></BnFeatureGate>} />
      <Route path="/bn/config/role-bundles" element={<BnFeatureGate flag="bn.config.rules"><BnRoleBundles /></BnFeatureGate>} />
      <Route path="/bn/config/delegations" element={<BnFeatureGate flag="bn.config.rules"><BnDelegations /></BnFeatureGate>} />
      <Route path="/bn/workbench" element={<BnFeatureGate flag="bn.config.rules"><BnMyWorkbench /></BnFeatureGate>} />
      <Route path="/bn/config/escalation" element={<BnFeatureGate flag="bn.config.rules"><BnEscalationConfig /></BnFeatureGate>} />
      <Route path="/bn/config/workflow-templates" element={<BnFeatureGate flag="bn.config.rules"><BnWorkflowTemplateEditor /></BnFeatureGate>} />
      <Route path="/bn/config/service-doc-types" element={<BnFeatureGate flag="bn.config.rules"><BnServiceDocTypes /></BnFeatureGate>} />
      <Route path="/bn/config/country-master" element={<BnFeatureGate flag="bn.config.rules"><BnCountryMaster /></BnFeatureGate>} />
      <Route path="/bn/config/country" element={<BnFeatureGate flag="bn.config.rules"><BnCountryPackPage /></BnFeatureGate>} />
      <Route path="/bn/config/country/id-rules" element={<BnFeatureGate flag="bn.config.rules"><BnCountryIdRules /></BnFeatureGate>} />
      <Route path="/bn/config/country/address-model" element={<BnFeatureGate flag="bn.config.rules"><BnCountryAddressModel /></BnFeatureGate>} />
      <Route path="/bn/config/country/participant-types" element={<BnFeatureGate flag="bn.config.rules"><BnCountryParticipantTypes /></BnFeatureGate>} />
      <Route path="/bn/config/country/payment-config" element={<BnFeatureGate flag="bn.config.rules"><BnCountryPaymentConfig /></BnFeatureGate>} />
      <Route path="/bn/config/country/legal-refs" element={<BnFeatureGate flag="bn.config.rules"><BnCountryLegalRefs /></BnFeatureGate>} />
      <Route path="/bn/config/rules" element={<BnFeatureGate flag="bn.config.rules"><BnRuleConfiguration /></BnFeatureGate>} />
      <Route path="/bn/config/rule-catalogue" element={<BnFeatureGate flag="bn.config.rules"><BnRuleCatalogue /></BnFeatureGate>} />
      <Route path="/bn/config/rules-admin" element={<BnFeatureGate flag="bn.config.rules"><BnRulesAdministration /></BnFeatureGate>} />
      <Route path="/bn/config/formulas" element={<BnFeatureGate flag="bn.config.rules"><BnFormulaConfiguration /></BnFeatureGate>} />
      <Route path="/bn/config/calculation" element={<BnFeatureGate flag="bn.config.rules"><BnCalculationSetup /></BnFeatureGate>} />
      <Route path="/bn/config/calculation-readiness" element={<BnFeatureGate flag="bn.config.rules"><BnCalculationReadiness /></BnFeatureGate>} />
      <Route path="/bn/config/reference-data" element={<BnFeatureGate flag="bn.config.rules"><BnReferenceDataAdmin /></BnFeatureGate>} />
      <Route path="/bn/config/derived-facts" element={<BnFeatureGate flag="bn.config.rules"><BnDerivedFactRegistry /></BnFeatureGate>} />
      <Route path="/bn/config/product-parameters" element={<BnFeatureGate flag="bn.config.rules"><BnProductParameterRegistry /></BnFeatureGate>} />

      <Route path="/bn/config/document-setup" element={<BnFeatureGate flag="bn.config.rules"><BnDocumentSetup /></BnFeatureGate>} />
      <Route path="/bn/config/screen-setup" element={<BnFeatureGate flag="bn.config.rules"><BnScreenMetadataSetup /></BnFeatureGate>} />
      <Route path="/bn/config/validation" element={<BnFeatureGate flag="bn.config.rules"><BnBenefitConfigurationValidation /></BnFeatureGate>} />
      <Route path="/bn/_grid-demo" element={<BnGridDemo />} />

      {/* Medical Benefit Setup */}
      <Route path="/bn/config/medical" element={<BnFeatureGate flag="bn.config.rules"><BnMedicalSetupHome /></BnFeatureGate>} />
      <Route path="/bn/config/medical/procedures" element={<BnFeatureGate flag="bn.config.rules"><BnMedicalProceduresCatalog /></BnFeatureGate>} />
      <Route path="/bn/config/medical/facility-availability" element={<BnFeatureGate flag="bn.config.rules"><BnFacilityAvailabilityMatrix /></BnFeatureGate>} />
      <Route path="/bn/config/medical/referral-rules" element={<BnFeatureGate flag="bn.config.rules"><BnReferralRulesPage /></BnFeatureGate>} />
      <Route path="/bn/config/medical/reimbursement-limits" element={<BnFeatureGate flag="bn.config.rules"><BnReimbursementLimitsPage /></BnFeatureGate>} />
      <Route path="/bn/config/medical/expense-types" element={<BnFeatureGate flag="bn.config.rules"><BnExpenseTypeConfiguration /></BnFeatureGate>} />
      <Route path="/bn/config/medical/review-rules" element={<BnFeatureGate flag="bn.config.rules"><BnMedicalReviewRulesPage /></BnFeatureGate>} />
      <Route path="/bn/config/medical/documents" element={<BnFeatureGate flag="bn.config.rules"><BnMedicalDocumentsPage /></BnFeatureGate>} />

      {/* Benefit Simulation Engine */}
      <Route path="/bn/simulation" element={<BnFeatureGate flag="bn.simulation"><BnSimulationDashboard /></BnFeatureGate>} />
      <Route path="/bn/simulation/new" element={<BnFeatureGate flag="bn.simulation"><BnScenarioBuilder /></BnFeatureGate>} />
      <Route path="/bn/simulation/edit/:id" element={<BnFeatureGate flag="bn.simulation"><BnScenarioBuilder /></BnFeatureGate>} />
      <Route path="/bn/simulation/:id" element={<BnFeatureGate flag="bn.simulation"><BnRunSimulation /></BnFeatureGate>} />
      <Route path="/bn/simulation/:id/run/:runId" element={<BnFeatureGate flag="bn.simulation"><BnSimulationResult /></BnFeatureGate>} />


      {/* Benefit Application Form
          Epic 0.2: INVESTIGATE — needs :benefitType→query param mapping shim before redirect */}
      <Route path="/nbenefit/application/:benefitType" element={<BenefitApplicationFormPage />} />

      {/* Claim Approval — Epic 0.2 redirect */}
      <Route path="/nbenefit/claim-approval" element={<Navigate to="/bn/approval" replace />} />

      {/* Benefit Rules Configuration — Epic 0.2 redirect (:id variants remain INVESTIGATE) */}
      <Route path="/nbenefit/config/rules" element={<Navigate to="/bn/config/rules" replace />} />
      <Route path="/nbenefit/config/rules/:id" element={<BenefitRuleEditor />} />
      <Route path="/nbenefit/config/rules/:id/edit" element={<BenefitRuleEditor />} />

      {/* Short-Term Benefits — INVESTIGATE (bespoke sub-routers, plan §4.2 High risk) */}
      <Route path="/nbenefit/short-term/sickness/*" element={<SicknessBenefit />} />
      <Route path="/nbenefit/short-term/employment-injury/*" element={<EmploymentInjuryBenefit />} />
      <Route path="/nbenefit/short-term/maternity/*" element={<MaternityBenefit />} />
      <Route path="/nbenefit/short-term/funeral-grant/*" element={<FuneralGrantBenefit />} />

      {/* Long-Term Benefits — INVESTIGATE (bespoke sub-routers) */}
      <Route path="/nbenefit/long-term/age-benefit/*" element={<AgeBenefit />} />
      <Route path="/nbenefit/long-term/invalidity/*" element={<InvalidityBenefit />} />
      <Route path="/nbenefit/long-term/assistance/*" element={<AssistanceBenefit />} />
      <Route path="/nbenefit/long-term/survivors/*" element={<SurvivorsBenefit />} />

      {/* Non-Contributory Pensions — INVESTIGATE */}
      <Route path="/nbenefit/non-contributory/assistance-pension/*" element={<AssistancePension />} />
      <Route path="/nbenefit/non-contributory/invalidity-assistance/*" element={<InvalidityAssistance />} />

      {/* Shared Config & Tools — Epic 0.2 redirects */}
      <Route path="/nbenefit/shared/common-eligibility-rules" element={<Navigate to="/bn/config/rules" replace />} />
      <Route path="/nbenefit/shared/calculation-engines" element={<Navigate to="/bn/engine" replace />} />
      <Route path="/nbenefit/config/medical-rules" element={<Navigate to="/bn/config/medical" replace />} />
      <Route path="/nbenefit/long-term/registry" element={<Navigate to="/bn/awards" replace />} />
      {/* INVESTIGATE: :id param not interpolated by <Navigate> */}
      <Route path="/nbenefit/long-term/beneficiary/:id" element={<BeneficiaryDetail />} />
      <Route path="/nbenefit/long-term/life-certificates" element={<Navigate to="/bn/life-certificates" replace />} />
      <Route path="/nbenefit/shared/document-templates" element={<Navigate to="/admin/notification-templates?tab=core&module=BENEFITS" replace />} />
      {/* INVESTIGATE: workflow scope not confirmed */}
      <Route path="/nbenefit/shared/workflows" element={<BenefitWorkflows />} />
      <Route path="/nbenefit/shared/registry-search" element={<Navigate to="/bn/person-360" replace />} />

      {/* Contribution Payments Module */}
      <Route path="/cashier/payment-data-entry" element={<PaymentDataEntry />} />
      <Route path="/cashier/payment-historical-entry" element={<PaymentHistoricalEntry />} />
      <Route path="/cashier/payment-history-mgmt" element={<PaymentHistoryManagement />} />
      <Route path="/cashier/transfer-payments" element={<TransferPayments />} />
      <Route path="/cashier/payment-history-report" element={<PaymentHistoryReport />} />
      <Route path="/cashier/vc-payment-update" element={<VCPaymentUpdate />} />

      {/* Cashier & Payments Routes */}
      {/* Traditional Payment Processing */}
      <Route path="/cashier/misc-payments" element={<MiscellaneousPayments />} />
      <Route path="/cashier/c3-payments" element={<C3Payments />} />
      
      {/* Accounts Payable & Benefit Payments */}
      <Route path="/finance/accounts-payable/pending" element={<APPendingPayables />} />
      <Route path="/finance/accounts-payable/create-batch" element={<APCreateBatch />} />
      <Route path="/finance/accounts-payable/batches" element={<APBatchList />} />
      <Route path="/finance/accounts-payable/batch/:batchId" element={<APBatchDetail />} />
      <Route path="/finance/accounts-payable/exceptions/:batchId" element={<APVerificationExceptions />} />
      <Route path="/finance/accounts-payable/accounts-verification" element={<APAccountsVerification />} />
      <Route path="/finance/accounts-payable/benefits-verification" element={<APBenefitsVerification />} />
      <Route path="/finance/accounts-payable/check-printing" element={<APCheckPrinting />} />
      <Route path="/finance/accounts-payable/dd-generation" element={<APDirectDepositGeneration />} />
      <Route path="/finance/accounts-payable/posting-history" element={<APPostingHistory />} />
      <Route path="/finance/accounts-payable/corrections" element={<APCorrections />} />
      <Route path="/finance/accounts-payable/reports" element={<APReports />} />
      <Route path="/finance/accounts-payable/pay-runs" element={<PayRunList />} />
      <Route path="/finance/accounts-payable/pay-runs/create" element={<CreatePayRun />} />
      <Route path="/finance/accounts-payable/generate-payments" element={<GeneratePayments />} />
      <Route path="/finance/accounts-payable/payment-inquiry" element={<PaymentInquiry />} />
      
      {/* Central Payment Arrangements */}
      <Route path="/finance/arrangements" element={<PaymentArrangementsPage />} />
      <Route path="/finance/arrangements/:id" element={<ArrangementDetail />} />
      
      <Route path="/cashier/eft-entry" element={<EFTEntry />} />
      <Route path="/cashier/cash-details" element={<CashDetails />} />
      <Route path="/cashier/funds-transfer" element={<FundsTransfer />} />
      <Route path="/cashier/check-management" element={<CheckManagement />} />
      <Route path="/cashier/receipt" element={<Receipt />} />
      
      {/* Invoice-Based Payment Processing */}
      <Route path="/cashier/create-invoice" element={<CreateInvoice />} />
      <Route path="/cashier/search-pay-invoices" element={<SearchPayInvoices />} />
      <Route path="/cashier/daily-invoice-report" element={<DailyInvoiceReport />} />
      
      {/* Day-End and Management */}
      <Route path="/cashier/batch-closing" element={<BatchClosing />} />
      <Route path="/cashier/card-machine-change-requests" element={<CardMachineChangeRequests />} />
      <Route path="/cashier/batch-management" element={<CashierBatchManagement />} />
      <Route path="/cashier/payment-module-config" element={<PaymentModuleConfig />} />
      <Route path="/cashier/card-machines" element={<PaymentModuleConfig />} />
      <Route path="/cashier/head-cashier-office-assignment" element={<HeadCashierOfficeAssignment />} />
      <Route path="/cashier/head-cashier-assignment" element={<HeadCashierAssignment />} />
      <Route path="/cashier/gl-posting" element={<GLPostingSummary />} />
      <Route path="/cashier/analytics" element={<PaymentAnalytics />} />
      <Route path="/cashier/reports" element={<CashierReports />} />
      
      {/* Sage Integration Routes */}
      <Route path="/cashier/chart-accounts-mapping" element={<ChartAccountsMapping />} />
      <Route path="/cashier/payment-types-mapping" element={<PaymentTypesMapping />} />
      <Route path="/cashier/sage-sync" element={<SageSynchronization />} />
      
      {/* Bank Account Mapping Routes */}
      <Route path="/cashier/current-accounts" element={<CurrentAccountsSetup />} />
      <Route path="/cashier/reconciliation-accounts" element={<BankReconciliationAccounts />} />
      
      {/* Collections Routes */}
      <Route path="/cashier/contribution-receipts" element={<ContributionReceipts />} />
      <Route path="/cashier/rent-receipts" element={<RentReceipts />} />
      <Route path="/cashier/loan-receipts" element={<LoanReceipts />} />
      <Route path="/cashier/service-receipts" element={<ServiceReceipts />} />

      {/* Legal Module Routes - SSB Legal (LEGACY BLOCK RETIRED)
          These routes were shadowed by the canonical /legal/* routes registered
          earlier inside <LegalRouteGuard>. Legacy handlers (SSBLegalDashboard,
          SSBCaseListPage, SSBCaseViewPage, LegalOrderRegistry, LegalDocumentCenter,
          SSBLegalReports) are marked @deprecated. Only /legal/auth and canonical
          redirects remain. */}
      <Route path="/legal/auth" element={<Suspense fallback={<div>Loading...</div>}><LegalAuth /></Suspense>} />
      <Route path="/legal/cases/:id" element={<LegacyLegalCaseRedirect />} />
      <Route path="/legal/cases/:id/edit" element={<Suspense fallback={<div>Loading...</div>}><LgCaseEdit /></Suspense>} />
      <Route path="/legal/orders" element={<Navigate to="/legal/lg/orders" replace />} />
      <Route path="/legal/documents" element={<Suspense fallback={<div>Loading...</div>}><LegalDocumentCenter /></Suspense>} />


      {/* BeMA Legacy Redirects */}
      <Route path="/bema/dashboard" element={<Navigate to="/compliance/workbench/manager" replace />} />
      <Route path="/bema/arrears" element={<Navigate to="/compliance/enforcement/arrangements" replace />} />
      <Route path="/bema/audits" element={<Navigate to="/compliance/field/audit-management" replace />} />
      <Route path="/bema/inspector-mobile" element={<Navigate to="/compliance/field/execution" replace />} />
      <Route path="/bema/contributors" element={<Navigate to="/compliance/field/employer-360" replace />} />
      <Route path="/bema/waivers" element={<Navigate to="/compliance/enforcement/waivers" replace />} />
      <Route path="/bema/reports" element={<Navigate to="/compliance/reports" replace />} />
      <Route path="/bema/zones" element={<Navigate to="/compliance/admin/geography/zones" replace />} />

      {/* Finance Module */}
      <Route path="/finance/dashboard" element={<FinanceDashboard />} />
      <Route path="/finance/batch-management" element={<BatchManagement />} />
      <Route path="/finance/payment-entry" element={<PaymentEntry />} />
      <Route path="/finance/receipt-search" element={<ReceiptSearch />} />
      <Route path="/finance/invoices" element={<InvoiceManagement />} />
      <Route path="/finance/gl-export" element={<GLExport />} />
      <Route path="/finance/daily-reports" element={<DailyReports />} />
      <Route path="/finance/reversals" element={<ReversalsAndPenalties />} />
      <Route path="/finance/admin-config" element={<AdminConfiguration />} />
      <Route path="/finance/user-management" element={<FinanceUserManagement />} />

      {/* Test Routes */}
      <Route path="/test/data-entry" element={<TestDataEntry />} />

      {/* Foundation Components Demo */}
      <Route path="/components-demo" element={<FoundationComponentsDemo />} />

      {/* Report Routes - Insured Persons */}
      <Route path="/person/reports/summary" element={<InsuredPersonsSummaryReport />} />
      <Route path="/person/reports/coverage-by-age" element={<CoverageByAgeReport />} />
      <Route path="/person/reports/contribution-history" element={<ContributionHistoryReport />} />
      
      {/* Report Routes - Employers */}
      <Route path="/employers/reports/registered-summary" element={<RegisteredSummaryReport />} />
      <Route path="/employers/reports/active-inactive" element={<ActiveInactiveReport />} />
      <Route path="/employers/reports/contribution-compliance" element={<ContributionComplianceReport />} />
      <Route path="/employers/reports/non-paying-3-months" element={<NonPaying3MonthsReport />} />
      <Route path="/employers/reports/non-paying-6-months" element={<NonPaying6MonthsReport />} />
      <Route path="/employers/reports/non-paying-9-months" element={<NonPaying9MonthsReport />} />
      <Route path="/employers/reports/top-missing-c3" element={<TopMissingC3Report />} />
      <Route path="/employers/reports/missing-c3-per-zone" element={<MissingC3PerZoneReport />} />
      <Route path="/employers/reports/c3-without-payment" element={<C3WithoutPaymentReport />} />
      <Route path="/employers/reports/no-payment-per-zone" element={<NoPaymentPerZoneReport />} />
      <Route path="/employers/reports/employee-turnover" element={<EmployeeTurnoverReport />} />
      <Route path="/employers/reports/by-employee-count" element={<ByEmployeeCountReport />} />
      <Route path="/employers/reports/by-monthly-contributions" element={<ByMonthlyContributionsReport />} />
      <Route path="/employers/reports/by-arrears" element={<ByArrearsReport />} />
      <Route path="/employers/reports/by-waivers" element={<ByWaiversReport />} />
      <Route path="/employers/reports/waivers-per-zone" element={<WaiversPerZoneReport />} />
      <Route path="/employers/reports/employees-per-zone" element={<EmployeesPerZoneReport />} />
      <Route path="/employers/reports/contributions-per-zone" element={<ContributionsPerZoneReport />} />
      <Route path="/employers/reports/queries-per-zone" element={<QueriesPerZoneReport />} />
      <Route path="/employers/reports/most-queries" element={<MostQueriesReport />} />
      <Route path="/employers/reports/by-litigation-count" element={<ByLitigationCountReport />} />
      <Route path="/employers/reports/arrears-per-zone" element={<ArrearsPerZoneReport />} />
      <Route path="/employers/reports/arrears-over-50k" element={<ArrearsOver50kReport />} />
      <Route path="/employers/reports/arrears-over-100k" element={<ArrearsOver100kReport />} />
      <Route path="/employers/reports/arrears-over-200k" element={<ArrearsOver200kReport />} />
      <Route path="/employers/reports/arrears-over-300k" element={<ArrearsOver300kReport />} />
      <Route path="/employers/reports/arrears-over-400k" element={<ArrearsOver400kReport />} />
      <Route path="/employers/reports/arrears-50k-by-zone" element={<Arrears50kByZoneReport />} />
      <Route path="/employers/reports/top-compliant" element={<TopCompliantReport />} />
      <Route path="/employers/reports/arrears-30-days" element={<Arrears30DaysReport />} />
      <Route path="/employers/reports/arrears-60-days" element={<Arrears60DaysReport />} />
      <Route path="/employers/reports/arrears-90-days" element={<Arrears90DaysReport />} />
      <Route path="/employers/reports/arrears-over-90-days" element={<ArrearsOver90DaysReport />} />
      <Route path="/employers/reports/under-litigation" element={<UnderLitigationReport />} />
      <Route path="/employers/reports/with-payment-plans" element={<WithPaymentPlansReport />} />
      <Route path="/employers/reports/defaulted-plans" element={<DefaultedPlansReport />} />
      <Route path="/employers/reports/ceased-employers" element={<CeasedEmployersReport />} />
      <Route path="/employers/reports/out-of-federation" element={<OutOfFederationReport />} />
      <Route path="/employers/reports/deceased-employers" element={<DeceasedEmployersReport />} />
      <Route path="/employers/reports/overseas-submissions" element={<OverseasSubmissionsReport />} />
      <Route path="/employers/reports/nil-returns-3-months" element={<NILReturns3MonthsReport />} />
      <Route path="/employers/reports/nil-returns-over-3-months" element={<NILReturnsOver3MonthsReport />} />

      {/* C3 Reports */}
      <Route path="/c3/reports/monthly-collections" element={<MonthlyCollectionsReport />} />
      <Route path="/c3/reports/arrears" element={<ArrearsReport />} />
      <Route path="/c3/reports/top-contributors" element={<TopContributorsReport />} />

      {/* Finance Reports */}
      <Route path="/finance/reports/contributions-vs-benefits" element={<ContributionsVsBenefitsReport />} />
      <Route path="/finance/reports/cash-flow" element={<CashFlowReport />} />
      <Route path="/finance/reports/investment-portfolio" element={<InvestmentPortfolioReport />} />
      
      {/* Report Routes - Benefits */}
      <Route path="/benefits/reports/payments-by-type" element={<PaymentsByTypeReport />} />
      <Route path="/benefits/reports/claims-volume" element={<ClaimsVolumeReport />} />
      <Route path="/benefits/reports/overpayments" element={<OverpaymentsReport />} />
      
      {/* Report Routes - Compliance */}
      <Route path="/compliance/reports/employer-status" element={<EmployerStatusReport />} />
      
      {/* Report Routes - Audit */}
      <Route path="/audit/reports/engagement-summary" element={<EngagementSummaryReport />} />
      <Route path="/audit/reports/communication-compliance" element={<CommunicationComplianceReport />} />
      <Route path="/audit/reports/plan-slippage" element={<PlanSlippageReport />} />
      <Route path="/audit/reports/overdue-actions" element={<OverdueActionsReport />} />
      <Route path="/audit/reports/carry-forward-aging" element={<CarryForwardAgingReport />} />
      
      {/* Report Routes - Admin */}
      <Route path="/admin/reports/account-roles" element={<AccountRolesReport />} />
      <Route path="/admin/reports/permission-changes" element={<PermissionChangesReport />} />
      <Route path="/admin/reports/configuration-audit" element={<ConfigurationAuditReport />} />
      
      {/* Fee Configuration */}
      <Route path="/admin/fee-configuration" element={<FeeConfiguration />} />

      {/* Enterprise Admin Routes - consolidated above in System Administration Routes */}
      
      {/* Profile Routes */}
      <Route path="/profile/change-password" element={<ProfileChangePassword />} />
      <Route path="/profile/notifications" element={<NotificationPreferences />} />
      <Route path="/profile/sessions" element={<ActiveSessions />} />
      
      {/* Notification Center */}
      <Route path="/notifications/center" element={<NotificationCenter />} />

      {/* Medical Module */}
      <Route path="/medical/applications" element={<DoctorApplicationsList />} />
      <Route path="/medical/applications/new" element={<NewManualApplication />} />
      <Route path="/medical/applications/:id" element={<DoctorApplicationDetail />} />
      <Route path="/medical/registry" element={<DoctorRegistry />} />
      <Route path="/medical/claims" element={<ClaimsByDoctors />} />

      {/* Sample Application Module */}
      <Route path="/sample-applications" element={<SampleApplicationList />} />
      <Route path="/sample-applications/new" element={<SampleApplicationForm />} />
      <Route path="/sample-applications/:id" element={<SampleApplicationView />} />
      <Route path="/sample-applications/:id/edit" element={<SampleApplicationForm />} />

      {/* Applications for Review */}
      <Route path="/workflow/applications-review" element={<ApplicationsReview />} />

      {/* Meetings Module */}
      <Route path="/meetings/manage" element={<ManageMeetingsPage />} />
      <Route path="/meetings/start/:meetingId" element={<StartMeetingPage />} />


      {/* Workflow Instances */}
      <Route path="/admin/workflow-instances" element={<WorkflowInstanceList />} />
      <Route path="/admin/workflow-instances/:id" element={<WorkflowInstanceDetail />} />

      {/* System Monitoring & Logs */}
      <Route path="/system-logs/technical" element={<TechnicalLogs />} />
      <Route path="/system-logs/errors" element={<ErrorLogs />} />
      <Route path="/system-logs/business" element={<BusinessEvents />} />
      <Route path="/system-logs/audit" element={<AuditTrail />} />
      <Route path="/system-logs/security" element={<SecurityLogs />} />
      <Route path="/system-logs/integration" element={<IntegrationLogs />} />
      <Route path="/system-logs/performance" element={<PerformanceMonitor />} />
      <Route path="/system-logs/workflows" element={<SystemWorkflowLogs />} />
      <Route path="/system-logs/login-security" element={<LoginSecurityLogs />} />

      {/* Data Access Control */}
      <Route path="/admin/data-access/scope-rules" element={<DataScopeRules />} />
      <Route path="/admin/data-access/field-security" element={<FieldSecurity />} />
      <Route path="/admin/data-access/role-policies" element={<RoleDataPolicies />} />
      <Route path="/admin/data-access/user-overrides" element={<UserDataOverrides />} />
      <Route path="/admin/data-access/test-console" element={<PolicyTestConsole />} />

      {/* System Cleanup & Refactoring */}
      <Route path="/admin/system-cleanup" element={<SystemCleanupDashboard />} />
      <Route path="/admin/system-cleanup/modules-inventory" element={<ActiveModulesInventory />} />
      <Route path="/admin/system-cleanup/dependency-scan" element={<DependencyScan />} />
      <Route path="/admin/system-cleanup/cleanup-review" element={<CleanupReview />} />
      <Route path="/admin/system-cleanup/rollback" element={<RollbackScreen />} />

      {/* Online Applications Module */}
      <Route path="/admin/api-configuration" element={<ApiConfiguration />} />
      <Route path="/online-applications/insured-person" element={<InsuredPersonApplications />} />
      <Route path="/online-applications/insured-person/:referenceNumber" element={<ApplicationDetailPage />} />
      <Route path="/online-applications/employer" element={<EmployerApplications />} />
      <Route path="/online-applications/employer/:applicationId" element={<EmployerApplicationDetailPage />} />
      <Route path="/online-applications/doctor" element={<DoctorApplications />} />
      <Route path="/online-applications/doctor/:applicationId" element={<DoctorApplicationDetailPage />} />

      {/* QA Framework */}
      <Route path="/admin/qa" element={<QADashboard />} />
      <Route path="/admin/qa/knowledge" element={<KnowledgeRepository />} />
      <Route path="/admin/qa/change-requests" element={<QAChangeRequests />} />
      {/* IP Registration Module - Primary route */}
      <Route path="/ip-registration" element={<IPRegistrationList />} />
      <Route path="/ip-registration/new" element={<IPRegistrationForm />} />
      <Route path="/ip-registration/edit/:uniqueUuid" element={<IPRegistrationForm />} />
      <Route path="/ip-registration/view/:uniqueUuid" element={<IPRegistrationForm />} />
      <Route path="/ip-registration/external" element={<ExternalApplicationsScreen />} />

      {/* Employer Registration Module */}
      <Route path="/employer-registration" element={<EmployerRegistrationList />} />
      <Route path="/employer-registration/new" element={<EmployerRegistrationForm />} />
      <Route path="/employer-registration/edit/:regno" element={<EmployerRegistrationForm />} />
      <Route path="/employer-registration/view/:regno" element={<EmployerRegistrationForm />} />




      {/* DB Diagram */}
      <Route path="/db-diagram" element={<Suspense fallback={<div className="flex items-center justify-center min-h-screen">Loading...</div>}><DbDiagramPage /></Suspense>} />
      <Route path="/db-diagram/:moduleCode" element={<Suspense fallback={<div className="flex items-center justify-center min-h-screen">Loading...</div>}><DbDiagramPage /></Suspense>} />

      </Route>

      {/* Maintenance / Lockdown */}
      <Route path="/maintenance" element={<Maintenance />} />

      {/* Unauthorized */}
      <Route path="/unauthorized" element={<Unauthorized />} />

      {/* External BN Portals — Public hub, Claimant / Employer / Doctor */}
      <Route path="/portal" element={<Suspense fallback={<div className="p-6 text-sm text-muted-foreground">Loading…</div>}><PortalHub /></Suspense>} />
      <Route path="/external/tasks" element={<Suspense fallback={<div className="p-6 text-sm text-muted-foreground">Loading…</div>}><ExternalTaskLanding /></Suspense>} />
      <Route path="/external/tasks/:token" element={<Suspense fallback={<div className="p-6 text-sm text-muted-foreground">Loading…</div>}><ExternalTaskLanding /></Suspense>} />
      <Route path="/claimant/*" element={<Suspense fallback={<div className="p-6 text-sm text-muted-foreground">Loading…</div>}><ClaimantPortal /></Suspense>} />
      <Route path="/employer/*" element={<Suspense fallback={<div className="p-6 text-sm text-muted-foreground">Loading…</div>}><EmployerPortal /></Suspense>} />
      <Route path="/doctor/*" element={<Suspense fallback={<div className="p-6 text-sm text-muted-foreground">Loading…</div>}><DoctorPortal /></Suspense>} />

      <Route path="*" element={<NotFound />} />
      </Routes>
    </Suspense>
  );
};

const ProtectedLegalRoute = ({ children }: { children: React.ReactNode }) => {
  const { user, loading } = useLegalAuth();
  
  if (loading) {
    return <div className="flex items-center justify-center min-h-screen">Loading...</div>;
  }
  
  if (!user) {
    return <Navigate to="/legal/auth" replace />;
  }
  
  return <>{children}</>;
};
