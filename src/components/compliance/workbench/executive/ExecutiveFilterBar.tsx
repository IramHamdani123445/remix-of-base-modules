/**
 * Executive filter bar for the Compliance Head workbench.
 * Options come from configured Compliance reference data (zones, violation
 * types, risk bands) and the officer performance view.
 */
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { RotateCcw } from 'lucide-react';
import {
  defaultExecFilters,
  useExecFilterOptions,
  type ExecFilters,
} from '@/hooks/compliance/useExecutiveWorkbench';

interface Props {
  filters: ExecFilters;
  onChange: (next: ExecFilters) => void;
}

const ALL = '__all__';

export function ExecutiveFilterBar({ filters, onChange }: Props) {
  const { data: options } = useExecFilterOptions();
  const set = (patch: Partial<ExecFilters>) => onChange({ ...filters, ...patch });

  const selectField = (
    label: string,
    key: keyof ExecFilters,
    items: Array<{ value: string; label: string }> = [],
  ) => (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Select
        value={(filters[key] as string) || ALL}
        onValueChange={(v) => set({ [key]: v === ALL ? '' : v } as Partial<ExecFilters>)}
      >
        <SelectTrigger className="h-9 w-[170px]">
          <SelectValue placeholder={`All ${label.toLowerCase()}`} />
        </SelectTrigger>
        <SelectContent className="max-h-72">
          <SelectItem value={ALL}>All {label.toLowerCase()}</SelectItem>
          {items.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );

  return (
    <Card>
      <CardContent className="flex flex-wrap items-end gap-3 p-4">
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">From</Label>
          <Input
            type="date"
            value={filters.from}
            onChange={(e) => set({ from: e.target.value })}
            className="h-9 w-[150px]"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">To</Label>
          <Input
            type="date"
            value={filters.to}
            onChange={(e) => set({ to: e.target.value })}
            className="h-9 w-[150px]"
          />
        </div>
        {selectField('Zone', 'zoneId', options?.zones)}
        {selectField('Officer', 'officerId', options?.officers)}
        {selectField('Violation type', 'violationTypeId', options?.violationTypes)}
        {selectField('Risk band', 'riskBand', options?.riskBands)}
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Employer</Label>
          <Input
            placeholder="Employer name"
            value={filters.employer}
            onChange={(e) => set({ employer: e.target.value })}
            className="h-9 w-[190px]"
          />
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-9"
          onClick={() => onChange(defaultExecFilters())}
        >
          <RotateCcw className="mr-1 h-4 w-4" /> Reset filters
        </Button>
      </CardContent>
    </Card>
  );
}
