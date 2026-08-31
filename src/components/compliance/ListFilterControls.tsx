import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Building2, Check, ChevronsUpDown } from 'lucide-react';

/**
 * Shared enterprise list-filter controls used by the Compliance list surfaces
 * (Case Register, Case Queue) so filters look and behave identically.
 */

export const titleise = (v: string) =>
  v.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

/** Searchable employer picker driven by employers present in the caller's authorised scope. */
export function EmployerCombobox({
  value, options, onChange, width = 'w-[240px]',
}: {
  value?: string;
  options: { id: string; name: string }[];
  onChange: (v?: string) => void;
  width?: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.id === value);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className={`h-9 ${width} justify-between font-normal`}>
          <span className="flex items-center gap-1.5 truncate">
            <Building2 className="h-3.5 w-3.5 shrink-0 opacity-70" />
            <span className="truncate">
              {selected ? `${selected.name} — ${selected.id}` : value ? value : 'All employers'}
            </span>
          </span>
          <ChevronsUpDown className="ml-1 h-3.5 w-3.5 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[320px] p-0" align="start">
        <Command>
          <CommandInput placeholder="Search employer or registration no." />
          <CommandList>
            <CommandEmpty>No employer found.</CommandEmpty>
            <CommandGroup>
              <CommandItem value="all-employers" onSelect={() => { onChange(undefined); setOpen(false); }}>
                <Check className={`mr-2 h-4 w-4 ${!value ? 'opacity-100' : 'opacity-0'}`} />
                All employers
              </CommandItem>
              {options.map((o) => (
                <CommandItem key={o.id} value={`${o.name} ${o.id}`} onSelect={() => { onChange(o.id); setOpen(false); }}>
                  <Check className={`mr-2 h-4 w-4 ${value === o.id ? 'opacity-100' : 'opacity-0'}`} />
                  <span className="truncate">{o.name}</span>
                  <span className="ml-2 font-mono text-xs text-muted-foreground">{o.id}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/** Multi-select popover for canonical vocabularies (status / priority / risk band). */
export function MultiSelect({
  label, values, options, onToggle, width = 'w-[200px]', format = titleise, searchable = false,
}: {
  label: string;
  values: string[];
  options: string[];
  onToggle: (v: string) => void;
  width?: string;
  format?: (v: string) => string;
  searchable?: boolean;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className={`h-9 ${width} justify-between font-normal`}>
          <span className="truncate">
            {values.length === 0 ? label : `${label}: ${values.length}`}
          </span>
          <ChevronsUpDown className="ml-1 h-3.5 w-3.5 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[260px] p-0" align="start">
        <Command>
          {searchable && <CommandInput placeholder={`Search ${label.toLowerCase()}`} />}
          <CommandList>
            <CommandEmpty>No options available.</CommandEmpty>
            <CommandGroup>
              {options.map((o) => (
                <CommandItem key={o} value={o} onSelect={() => onToggle(o)} className="gap-2">
                  <Checkbox checked={values.includes(o)} className="pointer-events-none" />
                  <span className="truncate">{format(o)}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
