/**
 * Epic 7 – Organization Foundation service.
 * Wraps legacy office/department/designation tables via compatibility views
 * and reads/writes core organization tables. Never expose raw table names.
 */
import { supabase } from '@/integrations/supabase/client';
import type {
  Office, Department, Designation, OrganizationProfile, OfficeLocation, CalendarHoliday,
  OrganizationFilters, DepartmentFormValues, DesignationFormValues,
  OrganizationProfileFormValues, OfficeLocationFormValues, CalendarHolidayFormValues,
} from './organizationTypes';

// --- helpers ---
const notLegacy = (name: string) => name; // opaque; do not expose to UI

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const anyClient = supabase as any;

function mapOffice(row: Record<string, unknown>): Office {
  return {
    officeCode: String(row.office_code ?? ''),
    officeName: String(row.office_name ?? ''),
    addressLine1: (row.address_line_1 as string | null) ?? null,
    addressLine2: (row.address_line_2 as string | null) ?? null,
    email: (row.email as string | null) ?? null,
    phone: (row.phone as string | null) ?? null,
    officeStartTime: (row.office_start_time as string | null) ?? null,
    officeEndTime: (row.office_end_time as string | null) ?? null,
    isActive: Boolean(row.is_active ?? true),
  };
}

function mapDepartment(row: Record<string, unknown>): Department {
  return {
    departmentId: String(row.department_id ?? row.id ?? ''),
    officeCode: (row.office_code as string | null) ?? null,
    departmentName: String(row.department_name ?? row.name ?? ''),
    description: (row.description as string | null) ?? null,
    isActive: Boolean(row.is_active ?? true),
    createdAt: (row.created_at as string | null) ?? null,
    updatedAt: (row.updated_at as string | null) ?? null,
  };
}

function mapDesignation(row: Record<string, unknown>): Designation {
  return {
    designationId: String(row.designation_id ?? row.id ?? ''),
    designationName: String(row.designation_name ?? row.name ?? ''),
    description: (row.description as string | null) ?? null,
    isActive: Boolean(row.is_active ?? true),
    createdAt: (row.created_at as string | null) ?? null,
    updatedAt: (row.updated_at as string | null) ?? null,
  };
}

// ============== Offices (backed by tb_office via core_offices_v) ==============
export async function getOffices(filters: OrganizationFilters = {}): Promise<Office[]> {
  let q = anyClient.from(notLegacy('core_offices_v')).select('*').order('office_code');
  if (filters.isActive !== undefined) q = q.eq('is_active', filters.isActive);
  if (filters.search) q = q.ilike('office_name', `%${filters.search}%`);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []).map(mapOffice);
}

export async function getOffice(officeCode: string): Promise<Office | null> {
  const { data, error } = await anyClient
    .from(notLegacy('core_offices_v'))
    .select('*')
    .eq('office_code', officeCode)
    .maybeSingle();
  if (error) throw error;
  return data ? mapOffice(data) : null;
}

export async function createOffice(payload: Office): Promise<Office> {
  const { data, error } = await anyClient
    .from(notLegacy('tb_office'))
    .insert({
      code: payload.officeCode,
      description: payload.officeName,
      address1: payload.addressLine1,
      address2: payload.addressLine2,
      office_email: payload.email,
      office_phone: payload.phone,
      office_start_time: payload.officeStartTime,
      office_end_time: payload.officeEndTime,
      is_active: payload.isActive,
    })
    .select()
    .single();
  if (error) throw error;
  return mapOffice({
    office_code: data.code, office_name: data.description,
    address_line_1: data.address1, address_line_2: data.address2,
    email: data.office_email, phone: data.office_phone,
    office_start_time: data.office_start_time, office_end_time: data.office_end_time,
    is_active: data.is_active,
  });
}

export async function updateOffice(officeCode: string, payload: Partial<Office>): Promise<void> {
  const patch: Record<string, unknown> = {};
  if (payload.officeName !== undefined) patch.description = payload.officeName;
  if (payload.addressLine1 !== undefined) patch.address1 = payload.addressLine1;
  if (payload.addressLine2 !== undefined) patch.address2 = payload.addressLine2;
  if (payload.email !== undefined) patch.office_email = payload.email;
  if (payload.phone !== undefined) patch.office_phone = payload.phone;
  if (payload.officeStartTime !== undefined) patch.office_start_time = payload.officeStartTime;
  if (payload.officeEndTime !== undefined) patch.office_end_time = payload.officeEndTime;
  if (payload.isActive !== undefined) patch.is_active = payload.isActive;
  const { error } = await anyClient.from(notLegacy('tb_office')).update(patch).eq('code', officeCode);
  if (error) throw error;
}

export const deactivateOffice = (officeCode: string) => updateOffice(officeCode, { isActive: false });
export const reactivateOffice = (officeCode: string) => updateOffice(officeCode, { isActive: true });

// ============== Departments (backed by tb_office_departments) ==============
export async function getDepartments(filters: OrganizationFilters = {}): Promise<Department[]> {
  let q = anyClient.from(notLegacy('core_departments_v')).select('*').order('department_name');
  if (filters.isActive !== undefined) q = q.eq('is_active', filters.isActive);
  if (filters.officeCode) q = q.eq('office_code', filters.officeCode);
  if (filters.search) q = q.ilike('department_name', `%${filters.search}%`);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []).map(mapDepartment);
}

export async function getDepartment(departmentId: string): Promise<Department | null> {
  const { data, error } = await anyClient
    .from(notLegacy('core_departments_v'))
    .select('*')
    .eq('department_id', departmentId)
    .maybeSingle();
  if (error) throw error;
  return data ? mapDepartment(data) : null;
}

export async function createDepartment(payload: DepartmentFormValues): Promise<Department> {
  const { data, error } = await anyClient
    .from(notLegacy('tb_office_departments'))
    .insert({
      office_code: payload.officeCode,
      name: payload.departmentName,
      description: payload.description,
      is_active: payload.isActive,
    })
    .select()
    .single();
  if (error) throw error;
  return mapDepartment(data);
}

export async function updateDepartment(
  departmentId: string,
  payload: Partial<DepartmentFormValues>,
): Promise<void> {
  const patch: Record<string, unknown> = {};
  if (payload.officeCode !== undefined) patch.office_code = payload.officeCode;
  if (payload.departmentName !== undefined) patch.name = payload.departmentName;
  if (payload.description !== undefined) patch.description = payload.description;
  if (payload.isActive !== undefined) patch.is_active = payload.isActive;
  const { error } = await anyClient
    .from(notLegacy('tb_office_departments'))
    .update(patch)
    .eq('id', departmentId);
  if (error) throw error;
}

export const deactivateDepartment = (id: string) => updateDepartment(id, { isActive: false });
export const reactivateDepartment = (id: string) => updateDepartment(id, { isActive: true });

// ============== Designations (backed by tb_designations) ==============
export async function getDesignations(filters: OrganizationFilters = {}): Promise<Designation[]> {
  let q = anyClient.from(notLegacy('core_designations_v')).select('*').order('designation_name');
  if (filters.isActive !== undefined) q = q.eq('is_active', filters.isActive);
  if (filters.search) q = q.ilike('designation_name', `%${filters.search}%`);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []).map(mapDesignation);
}

export async function getDesignation(id: string): Promise<Designation | null> {
  const { data, error } = await anyClient
    .from(notLegacy('core_designations_v'))
    .select('*')
    .eq('designation_id', id)
    .maybeSingle();
  if (error) throw error;
  return data ? mapDesignation(data) : null;
}

export async function createDesignation(payload: DesignationFormValues): Promise<Designation> {
  const { data, error } = await anyClient
    .from(notLegacy('tb_designations'))
    .insert({
      name: payload.designationName,
      description: payload.description,
      is_active: payload.isActive,
    })
    .select()
    .single();
  if (error) throw error;
  return mapDesignation(data);
}

export async function updateDesignation(
  id: string,
  payload: Partial<DesignationFormValues>,
): Promise<void> {
  const patch: Record<string, unknown> = {};
  if (payload.designationName !== undefined) patch.name = payload.designationName;
  if (payload.description !== undefined) patch.description = payload.description;
  if (payload.isActive !== undefined) patch.is_active = payload.isActive;
  const { error } = await anyClient.from(notLegacy('tb_designations')).update(patch).eq('id', id);
  if (error) throw error;
}

export const deactivateDesignation = (id: string) => updateDesignation(id, { isActive: false });
export const reactivateDesignation = (id: string) => updateDesignation(id, { isActive: true });

// ============== Organization Profile (core_organization_profile) ==============
function mapOrgProfile(row: Record<string, unknown>): OrganizationProfile {
  return {
    id: String(row.id),
    organizationCode: String(row.organization_code ?? 'SSB'),
    organizationName: String(row.organization_name ?? ''),
    legalName: (row.legal_name as string | null) ?? null,
    shortName: (row.short_name as string | null) ?? null,
    registrationNumber: (row.registration_number as string | null) ?? null,
    taxIdentifier: (row.tax_identifier as string | null) ?? null,
    mainPhone: (row.main_phone as string | null) ?? null,
    mainEmail: (row.main_email as string | null) ?? null,
    website: (row.website as string | null) ?? null,
    addressLine1: (row.address_line_1 as string | null) ?? null,
    addressLine2: (row.address_line_2 as string | null) ?? null,
    city: (row.city as string | null) ?? null,
    district: (row.district as string | null) ?? null,
    country: (row.country as string | null) ?? null,
    logoUrl: (row.logo_url as string | null) ?? null,
    brandingPrimaryColor: (row.branding_primary_color as string | null) ?? null,
    brandingSecondaryColor: (row.branding_secondary_color as string | null) ?? null,
    effectiveFrom: (row.effective_from as string | null) ?? null,
    effectiveTo: (row.effective_to as string | null) ?? null,
    isActive: Boolean(row.is_active ?? true),
    createdAt: String(row.created_at ?? ''),
    updatedAt: String(row.updated_at ?? ''),
  };
}

export async function getOrganizationProfile(): Promise<OrganizationProfile | null> {
  const { data, error } = await anyClient
    .from('core_organization_profile')
    .select('*')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data ? mapOrgProfile(data) : null;
}

export async function createOrUpdateOrganizationProfile(
  payload: OrganizationProfileFormValues,
): Promise<OrganizationProfile> {
  const existing = await getOrganizationProfile();
  const row = {
    organization_code: payload.organizationCode,
    organization_name: payload.organizationName,
    legal_name: payload.legalName,
    short_name: payload.shortName,
    registration_number: payload.registrationNumber,
    tax_identifier: payload.taxIdentifier,
    main_phone: payload.mainPhone,
    main_email: payload.mainEmail,
    website: payload.website,
    address_line_1: payload.addressLine1,
    address_line_2: payload.addressLine2,
    city: payload.city,
    district: payload.district,
    country: payload.country,
    logo_url: payload.logoUrl,
    branding_primary_color: payload.brandingPrimaryColor,
    branding_secondary_color: payload.brandingSecondaryColor,
    effective_from: payload.effectiveFrom,
    effective_to: payload.effectiveTo,
    is_active: payload.isActive,
  };
  if (existing) {
    const { data, error } = await anyClient
      .from('core_organization_profile')
      .update(row)
      .eq('id', existing.id)
      .select()
      .single();
    if (error) throw error;
    return mapOrgProfile(data);
  }
  const { data, error } = await anyClient
    .from('core_organization_profile')
    .insert(row)
    .select()
    .single();
  if (error) throw error;
  return mapOrgProfile(data);
}

// ============== Office Locations (core_office_locations) ==============
function mapLocation(row: Record<string, unknown>): OfficeLocation {
  return {
    id: String(row.id),
    officeCode: String(row.office_code ?? ''),
    locationCode: (row.location_code as string | null) ?? null,
    locationName: String(row.location_name ?? ''),
    locationType: (row.location_type as OfficeLocation['locationType']) ?? 'OFFICE',
    addressLine1: (row.address_line_1 as string | null) ?? null,
    addressLine2: (row.address_line_2 as string | null) ?? null,
    city: (row.city as string | null) ?? null,
    district: (row.district as string | null) ?? null,
    country: (row.country as string | null) ?? null,
    latitude: (row.latitude as number | null) ?? null,
    longitude: (row.longitude as number | null) ?? null,
    phone: (row.phone as string | null) ?? null,
    email: (row.email as string | null) ?? null,
    isPrimary: Boolean(row.is_primary ?? false),
    isActive: Boolean(row.is_active ?? true),
    createdAt: String(row.created_at ?? ''),
    updatedAt: String(row.updated_at ?? ''),
  };
}

export async function getOfficeLocations(filters: OrganizationFilters = {}): Promise<OfficeLocation[]> {
  let q = anyClient.from('core_office_locations').select('*').order('location_name');
  if (filters.officeCode) q = q.eq('office_code', filters.officeCode);
  if (filters.locationType) q = q.eq('location_type', filters.locationType);
  if (filters.isActive !== undefined) q = q.eq('is_active', filters.isActive);
  if (filters.search) q = q.ilike('location_name', `%${filters.search}%`);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []).map(mapLocation);
}

export async function createOfficeLocation(payload: OfficeLocationFormValues): Promise<OfficeLocation> {
  const { data, error } = await anyClient
    .from('core_office_locations')
    .insert({
      office_code: payload.officeCode,
      location_code: payload.locationCode,
      location_name: payload.locationName,
      location_type: payload.locationType,
      address_line_1: payload.addressLine1,
      address_line_2: payload.addressLine2,
      city: payload.city,
      district: payload.district,
      country: payload.country,
      latitude: payload.latitude,
      longitude: payload.longitude,
      phone: payload.phone,
      email: payload.email,
      is_primary: payload.isPrimary,
      is_active: payload.isActive,
    })
    .select()
    .single();
  if (error) throw error;
  return mapLocation(data);
}

export async function updateOfficeLocation(
  id: string,
  payload: Partial<OfficeLocationFormValues>,
): Promise<void> {
  const patch: Record<string, unknown> = {};
  const keyMap: Record<string, string> = {
    officeCode: 'office_code', locationCode: 'location_code', locationName: 'location_name',
    locationType: 'location_type', addressLine1: 'address_line_1', addressLine2: 'address_line_2',
    city: 'city', district: 'district', country: 'country', latitude: 'latitude', longitude: 'longitude',
    phone: 'phone', email: 'email', isPrimary: 'is_primary', isActive: 'is_active',
  };
  for (const [k, v] of Object.entries(payload)) {
    if (keyMap[k] && v !== undefined) patch[keyMap[k]] = v;
  }
  const { error } = await anyClient.from('core_office_locations').update(patch).eq('id', id);
  if (error) throw error;
}

export const deactivateOfficeLocation = (id: string) => updateOfficeLocation(id, { isActive: false });
export const reactivateOfficeLocation = (id: string) => updateOfficeLocation(id, { isActive: true });

// ============== Calendar Holidays (core_calendar_holidays) ==============
function mapHoliday(row: Record<string, unknown>): CalendarHoliday {
  return {
    id: String(row.id),
    holidayDate: String(row.holiday_date ?? ''),
    holidayName: String(row.holiday_name ?? ''),
    holidayType: (row.holiday_type as CalendarHoliday['holidayType']) ?? 'PUBLIC',
    officeCode: (row.office_code as string | null) ?? null,
    appliesNationally: Boolean(row.applies_nationally ?? true),
    affectsWorkflowDeadlines: Boolean(row.affects_workflow_deadlines ?? true),
    affectsPaymentProcessing: Boolean(row.affects_payment_processing ?? false),
    description: (row.description as string | null) ?? null,
    isActive: Boolean(row.is_active ?? true),
    createdAt: String(row.created_at ?? ''),
    updatedAt: String(row.updated_at ?? ''),
  };
}

export async function getCalendarHolidays(filters: OrganizationFilters = {}): Promise<CalendarHoliday[]> {
  let q = anyClient.from('core_calendar_holidays').select('*').order('holiday_date');
  if (filters.officeCode) q = q.eq('office_code', filters.officeCode);
  if (filters.holidayType) q = q.eq('holiday_type', filters.holidayType);
  if (filters.isActive !== undefined) q = q.eq('is_active', filters.isActive);
  if (filters.search) q = q.ilike('holiday_name', `%${filters.search}%`);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []).map(mapHoliday);
}

export async function createCalendarHoliday(payload: CalendarHolidayFormValues): Promise<CalendarHoliday> {
  const { data, error } = await anyClient
    .from('core_calendar_holidays')
    .insert({
      holiday_date: payload.holidayDate,
      holiday_name: payload.holidayName,
      holiday_type: payload.holidayType,
      office_code: payload.officeCode,
      applies_nationally: payload.appliesNationally,
      affects_workflow_deadlines: payload.affectsWorkflowDeadlines,
      affects_payment_processing: payload.affectsPaymentProcessing,
      description: payload.description,
      is_active: payload.isActive,
    })
    .select()
    .single();
  if (error) throw error;
  return mapHoliday(data);
}

export async function updateCalendarHoliday(
  id: string,
  payload: Partial<CalendarHolidayFormValues>,
): Promise<void> {
  const patch: Record<string, unknown> = {};
  const keyMap: Record<string, string> = {
    holidayDate: 'holiday_date', holidayName: 'holiday_name', holidayType: 'holiday_type',
    officeCode: 'office_code', appliesNationally: 'applies_nationally',
    affectsWorkflowDeadlines: 'affects_workflow_deadlines',
    affectsPaymentProcessing: 'affects_payment_processing',
    description: 'description', isActive: 'is_active',
  };
  for (const [k, v] of Object.entries(payload)) {
    if (keyMap[k] && v !== undefined) patch[keyMap[k]] = v;
  }
  const { error } = await anyClient.from('core_calendar_holidays').update(patch).eq('id', id);
  if (error) throw error;
}

export const deactivateCalendarHoliday = (id: string) => updateCalendarHoliday(id, { isActive: false });
export const reactivateCalendarHoliday = (id: string) => updateCalendarHoliday(id, { isActive: true });

// ============== Departments — canonical core_department reader ==============
/**
 * Returns authoritative core_department rows for a given organisation.
 *
 * Used by cross-module admin surfaces (Omni-Comms Templates, etc.) that need
 * true `core_department.id` UUIDs rather than the Legacy office-department
 * composite. Feature components MUST call this instead of querying
 * `core_department` directly.
 *
 * - Filters by organisation.
 * - Excludes inactive departments unless `includeIds` names a specific row
 *   (used when a stored reference points to a since-deactivated department).
 */
export interface ActiveDepartmentOption {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
}
export async function listActiveDepartmentsForOrganization(
  organizationId: string,
  options: { includeIds?: readonly string[] } = {},
): Promise<ActiveDepartmentOption[]> {
  if (!organizationId) return [];
  const includeIds = (options.includeIds ?? []).filter(Boolean);
  const orClauses = ['is_active.eq.true'];
  if (includeIds.length > 0) {
    orClauses.push(`id.in.(${includeIds.join(',')})`);
  }
  const { data, error } = await anyClient
    .from('core_department')
    .select('id, code, name, is_active')
    .eq('organization_id', organizationId)
    .or(orClauses.join(','))
    .order('sort_order', { ascending: true, nullsFirst: false })
    .order('name', { ascending: true });
  if (error) throw error;
  return ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
    id: String(row.id ?? ''),
    code: String(row.code ?? ''),
    name: String(row.name ?? ''),
    isActive: Boolean(row.is_active),
  }));
}
