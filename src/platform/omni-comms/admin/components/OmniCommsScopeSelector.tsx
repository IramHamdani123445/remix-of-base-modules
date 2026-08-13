/**
 * Omni-Comms — single organisation/workspace selector for the module shell.
 *
 * Renders NOTHING when the authorised user has one organisation (the normal
 * case). Never renders a department selector: department is an override
 * dimension, not a global filter.
 */
import React from 'react';
import { AlertCircle } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useOmniCommsScope } from '../../context/OmniCommsScopeContext';

export const OmniCommsScopeSelector: React.FC = () => {
  const {
    organizationId,
    requiresOrganizationChoice,
    availableOrganizations,
    loading,
    error,
    setOrganizationId,
  } = useOmniCommsScope();

  if (error) {
    return (
      <Alert variant="destructive" className="sm:max-w-sm">
        <AlertCircle className="h-4 w-4" />
        <AlertDescription className="text-xs">{error}</AlertDescription>
      </Alert>
    );
  }

  // One organisation (or still resolving): no selector at all.
  if (!requiresOrganizationChoice) return null;

  return (
    <div data-testid="omni-comms-scope-selector" className="max-w-xs">
      <Select
        value={organizationId ?? undefined}
        onValueChange={(v) => setOrganizationId(v)}
        disabled={loading}
      >
        <SelectTrigger
          aria-label="Workspace"
          data-testid="omni-comms-scope-selector-org"
          className="h-9"
        >
          <SelectValue placeholder={loading ? 'Loading…' : 'Select workspace'} />
        </SelectTrigger>
        <SelectContent>
          {availableOrganizations.map((o) => (
            <SelectItem key={o.id} value={o.id}>
              {o.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
};

export default OmniCommsScopeSelector;
