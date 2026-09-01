/**
 * Claim Workbench — Section 6: Benefit-Specific Detail
 *
 * Source precedence (most → least authoritative for display):
 *   1. local in-memory edits (workbench)
 *   2. bn_claim_detail.detail_json (staff captured)
 *   3. bn_claim_application.raw_application_json.benefit_facts (citizen)
 *
 * Editability is driven by the central field ownership registry — citizen
 * fields are always read-only here, staff fields are editable only in the
 * correct status with the correct role, system-derived fields are locked.
 */
import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Stethoscope, Lock, User, ShieldCheck, Cpu } from 'lucide-react';
import { formatDateForDisplay } from '@/lib/format-config';
import {
  isFieldEditable,
  type FieldOwnership,
} from '@/lib/bn/fieldOwnership';
import { BENEFIT_FIELDS, normalizeBenefitKey } from '@/services/bn/forms/sectionCatalogue';

interface BenefitDetailSectionProps {
  category: string;
  detailJson: Record<string, any> | null;
  /** Current claim status — drives editability windows. */
  claimStatus: string;
  /** Roles of the current user — drives editability gates. */
  roles: string[];
  /** Product / benefit code — overlays the product's own captured fields. */
  productCode?: string | null;
  onDetailChange: (key: string, value: any) => void;
}

interface FieldDef {
  key: string;
  label: string;
  type: 'text' | 'date' | 'number' | 'checkbox';
  required: boolean;
}

// Canonical field list per category — keys must match the ownership registry.
const CATEGORY_FIELDS: Record<string, FieldDef[]> = {
  SHORT_TERM: [
    { key: 'illness_start_date', label: 'Illness Start Date', type: 'date', required: true },
    { key: 'last_worked_date', label: 'Last Worked Date', type: 'date', required: false },
    { key: 'expected_return_date', label: 'Expected Return Date', type: 'date', required: false },
    { key: 'diagnosis_code', label: 'Diagnosis Code', type: 'text', required: false },
    { key: 'doctor_name', label: 'Doctor Name', type: 'text', required: true },
    { key: 'doctor_reg_no', label: 'Doctor Reg. No', type: 'text', required: false },
    { key: 'hospital_clinic', label: 'Hospital/Clinic', type: 'text', required: false },
    { key: 'medical_cert_verified', label: 'Medical Cert Verified', type: 'checkbox', required: false },
    { key: 'work_related', label: 'Work Related', type: 'checkbox', required: false },
    { key: 'employer_notified', label: 'Employer Notified', type: 'checkbox', required: false },
  ],
  LONG_TERM: [
    { key: 'retirement_date', label: 'Retirement Date', type: 'date', required: true },
    { key: 'pension_type', label: 'Pension Type', type: 'text', required: true },
    { key: 'best_years_start', label: 'Best Years Start', type: 'number', required: false },
    { key: 'best_years_end', label: 'Best Years End', type: 'number', required: false },
    { key: 'total_contribution_weeks', label: 'Contribution Weeks', type: 'number', required: false },
  ],
  PENSION: [
    { key: 'retirement_date', label: 'Retirement Date', type: 'date', required: true },
    { key: 'pension_type', label: 'Pension Type', type: 'text', required: true },
    { key: 'tier_applied', label: 'Tier', type: 'text', required: false },
    { key: 'total_contribution_weeks', label: 'Contribution Weeks', type: 'number', required: false },
  ],
  INJURY: [
    { key: 'injury_date', label: 'Injury Date', type: 'date', required: true },
    { key: 'injury_description', label: 'Injury Description', type: 'text', required: true },
    { key: 'injury_location', label: 'Injury Location', type: 'text', required: true },
    { key: 'body_part_affected', label: 'Body Part Affected', type: 'text', required: false },
    { key: 'disablement_percentage', label: 'Disablement %', type: 'number', required: false },
    { key: 'is_temporary', label: 'Temporary Disability', type: 'checkbox', required: false },
    { key: 'employer_report_date', label: 'Employer Report Date', type: 'date', required: false },
  ],
  GRANT: [
    { key: 'deceased_ssn', label: 'Deceased SSN', type: 'text', required: true },
    { key: 'deceased_name', label: 'Deceased Name', type: 'text', required: true },
    { key: 'date_of_death', label: 'Date of Death', type: 'date', required: true },
    { key: 'relationship_to_claimant', label: 'Relationship', type: 'text', required: true },
    { key: 'funeral_date', label: 'Funeral Date', type: 'date', required: false },
    { key: 'funeral_home', label: 'Funeral Home', type: 'text', required: false },
    { key: 'is_employment_injury_death', label: 'EI-Related Death', type: 'checkbox', required: false },
  ],
  SURVIVOR: [
    { key: 'deceased_ssn', label: 'Deceased SSN', type: 'text', required: true },
    { key: 'deceased_name', label: 'Deceased Name', type: 'text', required: true },
    { key: 'date_of_death', label: 'Date of Death', type: 'date', required: true },
    { key: 'relationship', label: 'Relationship', type: 'text', required: true },
    { key: 'survivor_dob', label: 'Survivor DOB', type: 'date', required: false },
    { key: 'is_dependent_child', label: 'Dependent Child', type: 'checkbox', required: false },
    { key: 'school_name', label: 'School Name', type: 'text', required: false },
  ],
  NON_CONTRIBUTORY: [
    { key: 'means_test_date', label: 'Means Test Date', type: 'date', required: true },
    { key: 'monthly_income', label: 'Monthly Income (EC$)', type: 'number', required: true },
    { key: 'income_threshold', label: 'Income Threshold (EC$)', type: 'number', required: false },
    { key: 'means_test_passed', label: 'Means Test Passed', type: 'checkbox', required: false },
    { key: 'living_arrangement', label: 'Living Arrangement', type: 'text', required: false },
    { key: 'other_pension_amount', label: 'Other Pension Amount', type: 'number', required: false },
  ],
  ASSISTANCE: [
    { key: 'means_test_date', label: 'Means Test Date', type: 'date', required: true },
    { key: 'monthly_income', label: 'Monthly Income (EC$)', type: 'number', required: true },
    { key: 'means_test_passed', label: 'Means Test Passed', type: 'checkbox', required: false },
  ],
};

const OWNERSHIP_BADGE: Record<FieldOwnership, { label: string; className: string; Icon: React.ElementType }> = {
  CITIZEN_SUBMITTED: {
    label: 'Citizen',
    className: 'bg-blue-500/10 text-blue-700 border-blue-300',
    Icon: User,
  },
  STAFF_REVIEW: {
    label: 'Staff',
    className: 'bg-amber-500/10 text-amber-700 border-amber-300',
    Icon: ShieldCheck,
  },
  SUPERVISOR_DECISION: {
    label: 'Supervisor',
    className: 'bg-purple-500/10 text-purple-700 border-purple-300',
    Icon: ShieldCheck,
  },
  SYSTEM_DERIVED: {
    label: 'System',
    className: 'bg-muted text-muted-foreground border-border',
    Icon: Cpu,
  },
};

const FIELD_TYPE_MAP: Record<string, FieldDef['type']> = {
  DATE: 'date',
  TEXT: 'text',
  NUMBER: 'number',
  CHECKBOX: 'checkbox',
};

export const BenefitDetailSection: React.FC<BenefitDetailSectionProps> = ({
  category,
  detailJson,
  claimStatus,
  roles,
  productCode,
  onDetailChange,
}) => {
  const fields = React.useMemo<FieldDef[]>(() => {
    const base = CATEGORY_FIELDS[category] || CATEGORY_FIELDS.SHORT_TERM || [];
    const benefitKey = normalizeBenefitKey(productCode);
    const productFields = benefitKey ? BENEFIT_FIELDS[benefitKey] ?? [] : [];
    if (productFields.length === 0) return base;

    const seen = new Set(base.map((f) => f.key));
    const overlay: FieldDef[] = [];
    for (const f of productFields) {
      if (seen.has(f.field_code)) continue;
      seen.add(f.field_code);
      overlay.push({
        key: f.field_code,
        label: f.field_label,
        type: FIELD_TYPE_MAP[String(f.field_type).toUpperCase()] ?? 'text',
        required: false,
      });
    }
    return [...base, ...overlay];
  }, [category, productCode]);

  const data = detailJson || {};

  return (
    <TooltipProvider delayDuration={150}>
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-medium flex items-center gap-2">
            <Stethoscope className="h-4 w-4" /> Benefit-Specific Details
            <span className="text-xs text-muted-foreground font-normal">({category})</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {fields.length === 0 ? (
            <p className="text-sm text-muted-foreground">No benefit-specific fields defined for this category.</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {fields.map((field) => {
                const decision = isFieldEditable({
                  category,
                  fieldKey: field.key,
                  claimStatus,
                  roles,
                });
                const badge = OWNERSHIP_BADGE[decision.ownership];
                const BadgeIcon = badge.Icon;
                const editable = decision.editable;
                const value = data[field.key];

                const labelRow = (
                  <div className="flex items-center gap-2 mb-1">
                    <Label className="text-xs text-muted-foreground">
                      {field.label}
                      {field.required && <span className="text-destructive"> *</span>}
                    </Label>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Badge variant="outline" className={`gap-1 px-1.5 py-0 text-[10px] ${badge.className}`}>
                          <BadgeIcon className="h-2.5 w-2.5" />
                          {badge.label}
                        </Badge>
                      </TooltipTrigger>
                      <TooltipContent>{decision.reason}</TooltipContent>
                    </Tooltip>
                    {!editable && (
                      <Lock className="h-3 w-3 text-muted-foreground/60" aria-label="read-only" />
                    )}
                  </div>
                );

                if (field.type === 'checkbox') {
                  return (
                    <div key={field.key} className="flex flex-col gap-1 pt-1">
                      {labelRow}
                      <div className="flex items-center gap-2">
                        <Checkbox
                          id={field.key}
                          checked={!!value}
                          onCheckedChange={(v) => editable && onDetailChange(field.key, v)}
                          disabled={!editable}
                        />
                        <Label htmlFor={field.key} className="text-sm">
                          {value ? 'Yes' : 'No'}
                        </Label>
                      </div>
                    </div>
                  );
                }

                return (
                  <div key={field.key}>
                    {labelRow}
                    {editable ? (
                      <Input
                        type={field.type === 'date' ? 'date' : field.type === 'number' ? 'number' : 'text'}
                        value={value ?? ''}
                        onChange={(e) =>
                          onDetailChange(
                            field.key,
                            field.type === 'number' ? Number(e.target.value) : e.target.value,
                          )
                        }
                      />
                    ) : (
                      <p className="text-foreground text-sm border rounded px-2 py-1.5 bg-muted/30">
                        {field.type === 'date' && value
                          ? formatDateForDisplay(value)
                          : value === true
                            ? 'Yes'
                            : value === false
                              ? 'No'
                              : (value ?? '—')}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          <p className="text-xs text-muted-foreground mt-4 border-t pt-3">
            Stored in: bn_claim_detail.detail_json. Citizen-submitted values stay in bn_claim_application.raw_application_json and are never overwritten by Save.
          </p>
        </CardContent>
      </Card>
    </TooltipProvider>
  );
};
