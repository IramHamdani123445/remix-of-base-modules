import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { ArrowDownUp, Filter, RotateCcw, Search, X } from "lucide-react";
import { useEffect, useState } from "react";
import {
  WORK_QUEUE_SORTS,
  type WorkQueueFilters,
  type WorkQueueOptions,
} from "@/hooks/compliance/useComplianceWorkQueue";

const ANY = "__ANY__";

interface Props {
  filters: WorkQueueFilters;
  options: WorkQueueOptions;
  sort: string;
  dir: "asc" | "desc";
  activeFilterCount: number;
  total: number;
  grandTotal: number;
  scope?: string;
  showAssignmentChips?: boolean;
  onPatch: (patch: Partial<WorkQueueFilters>) => void;
  onReset: () => void;
  onSort: (sort: string) => void;
  onToggleDir: () => void;
}

/**
 * Shared enterprise filter / sort toolbar for the compliance work queues.
 * Every control feeds the server-side reader, so results reflect the whole
 * authorised set rather than the rows currently rendered.
 */
export function WorkQueueToolbar({
  filters, options, sort, dir, activeFilterCount, total, grandTotal, scope,
  showAssignmentChips = true, onPatch, onReset, onSort, onToggleDir,
}: Props) {
  const [searchDraft, setSearchDraft] = useState(filters.search ?? "");

  useEffect(() => {
    setSearchDraft(filters.search ?? "");
  }, [filters.search]);

  useEffect(() => {
    const t = setTimeout(() => {
      if ((filters.search ?? "") !== searchDraft) {
        onPatch({ search: searchDraft.trim() || undefined });
      }
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchDraft]);

  const sel = (value: string | undefined) => value ?? ANY;
  const toVal = (v: string) => (v === ANY ? undefined : v);

  const chip = (label: string, active: boolean, onClick: () => void) => (
    <Badge
      key={label}
      variant={active ? "default" : "outline"}
      className="cursor-pointer select-none"
      onClick={onClick}
    >
      {label}
    </Badge>
  );

  return (
    <div className="space-y-3 rounded-lg border bg-card/50 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[240px] flex-1">
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            value={searchDraft}
            onChange={(e) => setSearchDraft(e.target.value)}
            placeholder="Search employer, reference or employer number"
            className="pl-8"
          />
          {searchDraft && (
            <button
              type="button"
              aria-label="Clear search"
              className="absolute right-2 top-2.5 text-muted-foreground hover:text-foreground"
              onClick={() => setSearchDraft("")}
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        <div className="flex items-center gap-1">
          <Select value={sort} onValueChange={onSort}>
            <SelectTrigger className="w-[220px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {WORK_QUEUE_SORTS.map((s) => (
                <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="icon"
            onClick={onToggleDir}
            disabled={sort === "default"}
            title={dir === "asc" ? "Ascending" : "Descending"}
          >
            <ArrowDownUp className="h-4 w-4" />
          </Button>
        </div>

        <Button
          variant="ghost"
          size="sm"
          onClick={onReset}
          className="gap-1"
          disabled={activeFilterCount === 0}
        >
          <RotateCcw className="h-3.5 w-3.5" /> Reset
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {chip("Overdue", !!filters.overdue_only, () => onPatch({ overdue_only: !filters.overdue_only, due_today: undefined }))}
        {chip("Due today", !!filters.due_today, () => onPatch({ due_today: !filters.due_today, overdue_only: undefined }))}
        {chip("Critical", filters.priority === "CRITICAL", () => onPatch({ priority: filters.priority === "CRITICAL" ? undefined : "CRITICAL" }))}
        {chip("High", filters.priority === "HIGH", () => onPatch({ priority: filters.priority === "HIGH" ? undefined : "HIGH" }))}
        {chip("Assigned to me", !!filters.mine_only, () => onPatch({ mine_only: !filters.mine_only, unassigned_only: undefined }))}
        {showAssignmentChips &&
          chip("Unassigned", !!filters.unassigned_only, () => onPatch({ unassigned_only: !filters.unassigned_only, mine_only: undefined }))}
        {chip("Ageing 30+ days", filters.min_age_days === 30, () => onPatch({ min_age_days: filters.min_age_days === 30 ? undefined : 30 }))}
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <FilterSelect label="Work type" value={sel(filters.work_type)} onChange={(v) => onPatch({ work_type: toVal(v) })}
          items={options.work_types.map((w) => ({ value: w, label: w }))} />
        <FilterSelect label="Status" value={sel(filters.status)} onChange={(v) => onPatch({ status: toVal(v) })}
          items={options.statuses.map((s) => ({ value: s, label: s }))} />
        <FilterSelect label="Priority" value={sel(filters.priority)} onChange={(v) => onPatch({ priority: toVal(v) })}
          items={options.priorities.map((p) => ({ value: p, label: p }))} />
        <FilterSelect label="Owner" value={sel(filters.owner)} onChange={(v) => onPatch({ owner: toVal(v) })}
          items={options.owners.map((o) => ({ value: o.id, label: o.name }))} />
        <FilterSelect label="Zone" value={sel(filters.zone)} onChange={(v) => onPatch({ zone: toVal(v) })}
          items={options.zones.map((z) => ({ value: z.id, label: `${z.code} — ${z.name}` }))} />
        <FilterSelect label="Queue" value={sel(filters.queue)} onChange={(v) => onPatch({ queue: toVal(v) })}
          items={options.queues.map((q) => ({ value: q.id, label: `${q.name} (${q.type})` }))} />
        <FilterSelect label="Risk band" value={sel(filters.risk_band)} onChange={(v) => onPatch({ risk_band: toVal(v) })}
          items={options.risk_bands.map((r) => ({ value: r, label: r }))} />
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Due from</Label>
          <Input type="date" value={filters.due_from ?? ""} onChange={(e) => onPatch({ due_from: e.target.value || undefined })} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Due to</Label>
          <Input type="date" value={filters.due_to ?? ""} onChange={(e) => onPatch({ due_to: e.target.value || undefined })} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Created from</Label>
          <Input type="date" value={filters.created_from ?? ""} onChange={(e) => onPatch({ created_from: e.target.value || undefined })} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Created to</Label>
          <Input type="date" value={filters.created_to ?? ""} onChange={(e) => onPatch({ created_to: e.target.value || undefined })} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Employer number</Label>
          <Input value={filters.employer ?? ""} placeholder="Exact match"
            onChange={(e) => onPatch({ employer: e.target.value.trim() || undefined })} />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <Filter className="h-3.5 w-3.5" />
        <span>
          {total.toLocaleString()} of {grandTotal.toLocaleString()} items match
          {activeFilterCount > 0 ? ` (${activeFilterCount} filter${activeFilterCount === 1 ? "" : "s"})` : ""}
        </span>
        {scope && <Badge variant="outline" className="text-[10px] uppercase">{scope} view</Badge>}
      </div>
    </div>
  );
}

function FilterSelect({
  label, value, onChange, items,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  items: { value: string; label: string }[];
}) {
  return (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger><SelectValue placeholder="Any" /></SelectTrigger>
        <SelectContent className="max-h-72">
          <SelectItem value={ANY}>Any</SelectItem>
          {items.map((i) => (
            <SelectItem key={i.value} value={i.value}>{i.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

export function WorkQueuePagination({
  page, totalPages, pageSize, total, onPage, onPageSize, isFetching,
}: {
  page: number;
  totalPages: number;
  pageSize: number;
  total: number;
  onPage: (p: number) => void;
  onPageSize: (n: number) => void;
  isFetching?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 pt-3 text-sm">
      <div className="text-muted-foreground">
        Page {page} of {totalPages} · {total.toLocaleString()} items
        {isFetching ? " · refreshing…" : ""}
      </div>
      <div className="flex items-center gap-2">
        <Select value={String(pageSize)} onValueChange={(v) => onPageSize(Number(v))}>
          <SelectTrigger className="w-[110px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            {[25, 50, 100, 200].map((n) => (
              <SelectItem key={n} value={String(n)}>{n} / page</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</Button>
        <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => onPage(page + 1)}>Next</Button>
      </div>
    </div>
  );
}
