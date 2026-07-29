/**
 * Omni-Comms shared tenant selector.
 *
 * Replaces the previous Channels-only manual UUID entry / localStorage +
 * `window.location.reload()` workflow. Selection is held in the tenant
 * context and updates propagate to consumers without a full-page reload.
 */
import React from "react";
import { AlertCircle } from "lucide-react";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useOmniCommsTenant } from "../../context/OmniCommsTenantContext";

export interface OmniCommsTenantSelectorProps {
  showDepartment?: boolean;
  disabled?: boolean;
}

const NONE_VALUE = "__none__";

export const OmniCommsTenantSelector: React.FC<OmniCommsTenantSelectorProps> = ({
  showDepartment = true,
  disabled = false,
}) => {
  const {
    organizationId,
    departmentId,
    availableOrganizations,
    availableDepartments,
    loading,
    error,
    setOrganizationId,
    setDepartmentId,
  } = useOmniCommsTenant();

  return (
    <div
      data-testid="omni-comms-tenant-selector"
      className="flex flex-col gap-3 sm:flex-row sm:items-end"
    >
      <div className="flex-1 min-w-[240px]">
        <Label className="text-xs uppercase text-muted-foreground">
          Organisation
        </Label>
        <Select
          value={organizationId ?? NONE_VALUE}
          onValueChange={(v) => setOrganizationId(v === NONE_VALUE ? null : v)}
          disabled={disabled || loading || availableOrganizations.length === 0}
        >
          <SelectTrigger
            data-testid="omni-comms-tenant-selector-org"
            className="mt-1"
          >
            <SelectValue placeholder={loading ? "Loading…" : "Select organisation"} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE_VALUE}>—</SelectItem>
            {availableOrganizations.map((o) => (
              <SelectItem key={o.id} value={o.id}>
                {o.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {showDepartment ? (
        <div className="flex-1 min-w-[240px]">
          <Label className="text-xs uppercase text-muted-foreground">
            Department
          </Label>
          <Select
            value={departmentId ?? NONE_VALUE}
            onValueChange={(v) => setDepartmentId(v === NONE_VALUE ? null : v)}
            disabled={
              disabled || loading || !organizationId ||
              availableDepartments.length === 0
            }
          >
            <SelectTrigger
              data-testid="omni-comms-tenant-selector-dept"
              className="mt-1"
            >
              <SelectValue
                placeholder={
                  !organizationId ? "Select organisation first" : "All departments"
                }
              />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE_VALUE}>All departments</SelectItem>
              {availableDepartments.map((d) => (
                <SelectItem key={d.id} value={d.id}>
                  {d.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}

      {error ? (
        <Alert variant="destructive" className="sm:max-w-sm">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription className="text-xs">{error}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
};

export default OmniCommsTenantSelector;
