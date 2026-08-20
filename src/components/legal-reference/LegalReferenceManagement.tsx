/**
 * LegalReferenceManagement — shared CRUD UI for the central legal_reference
 * master. Used by Benefits Country Pack and Legal Admin so both modules
 * present an identical management experience.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Plus, Pencil, Trash2, ExternalLink, History, Lock,
  Search, ChevronUp, ChevronDown, ChevronLeft, ChevronRight, X,
} from 'lucide-react';
import VersionHistoryDialog from './VersionHistoryDialog';

import { toast } from 'sonner';
import {
  useDeleteLegalReference,
  useLegalReferences,
  useLegalReferenceTypes,
  useSetLegalReferenceStatus,
  useUpsertLegalReference,
} from '@/hooks/legal-reference/useLegalReferences';
import type {
  LegalRefStatus,
  LegalReference,
} from '@/services/legal-reference/types';

const STATUS_OPTIONS: { value: LegalRefStatus; label: string }[] = [
  { value: 'DRAFT', label: 'Draft' },
  { value: 'ACTIVE', label: 'Active' },
  { value: 'SUPERSEDED', label: 'Superseded' },
  { value: 'REPEALED', label: 'Repealed' },
];

const statusVariant = (s: LegalRefStatus) =>
  s === 'ACTIVE' ? 'default' : s === 'DRAFT' ? 'secondary' : s === 'SUPERSEDED' ? 'outline' : 'destructive';

const PAGE_SIZE = 15;
const ALL = '__all__';

type SortKey = 'ref_code' | 'short_title' | 'act_name' | 'effective_from' | 'version_number' | 'status';

const SortHead: React.FC<{
  label: string;
  k: SortKey;
  sortKey: SortKey;
  sortDir: 'asc' | 'desc';
  onSort: (k: SortKey) => void;
}> = ({ label, k, sortKey, sortDir, onSort }) => (
  <TableHead className="cursor-pointer select-none" onClick={() => onSort(k)}>
    <span className="inline-flex items-center gap-1">
      {label}
      {sortKey === k && (sortDir === 'asc' ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />)}
    </span>
  </TableHead>
);

const empty = (countryCode: string): Partial<LegalReference> => ({
  country_code: countryCode,
  ref_code: '',
  ref_type: null,
  short_title: '',
  act_name: '',
  chapter: null,
  section: null,
  subsection: null,
  regulation: null,
  full_reference_text: null,
  ref_url: null,
  jurisdiction: null,
  source: null,
  effective_from: new Date().toISOString().slice(0, 10),
  effective_to: null,
  status: 'DRAFT',
  version_number: 1,
  supersedes_id: null,
  tags: null,
  notes: null,
  is_active: true,
});

export interface LegalReferenceManagementProps {
  countryCode: string;
  /** Optional default tag added to all refs created here (e.g. 'LG' for Legal). */
  defaultTag?: string;
  title?: string;
  subtitle?: string;
}

export const LegalReferenceManagement: React.FC<LegalReferenceManagementProps> = ({
  countryCode, defaultTag, title = 'Legal References',
  subtitle = 'Shared master of acts, chapters, sections and regulations',
}) => {
  const [showAllModules, setShowAllModules] = useState(false);
  const { data: refs = [], isLoading } = useLegalReferences(countryCode, {
    includeInactive: true,
    tags: defaultTag && !showAllModules ? [defaultTag] : undefined,
  });
  const { data: types = [] } = useLegalReferenceTypes();
  const upsert = useUpsertLegalReference();
  const remove = useDeleteLegalReference();
  const setStatus = useSetLegalReferenceStatus();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Partial<LegalReference>>(empty(countryCode));
  const [tagInput, setTagInput] = useState('');
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [versionsTarget, setVersionsTarget] = useState<{ id: string; code: string } | null>(null);

  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState(ALL);
  const [statusFilter, setStatusFilter] = useState(ALL);
  const [tagFilter, setTagFilter] = useState(ALL);
  const [sortKey, setSortKey] = useState<SortKey>('ref_code');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [page, setPage] = useState(1);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir('asc'); }
  };

  const allTags = useMemo(() => {
    const set = new Set<string>();
    refs.forEach((r) => (r.tags ?? []).forEach((t) => set.add(t)));
    return Array.from(set).sort();
  }, [refs]);

  const filteredSorted = useMemo(() => {
    const q = search.trim().toLowerCase();
    let rows = refs.filter((r) => {
      if (q) {
        const haystack = [r.ref_code, r.short_title, r.act_name, r.full_reference_text]
          .filter(Boolean).join(' ').toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      if (typeFilter !== ALL && r.ref_type !== typeFilter) return false;
      if (statusFilter !== ALL && r.status !== statusFilter) return false;
      if (tagFilter !== ALL && !(r.tags ?? []).includes(tagFilter)) return false;
      return true;
    });
    rows = [...rows].sort((a, b) => {
      const dir = sortDir === 'asc' ? 1 : -1;
      const av = a[sortKey] ?? '';
      const bv = b[sortKey] ?? '';
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return 0;
    });
    return rows;
  }, [refs, search, typeFilter, statusFilter, tagFilter, sortKey, sortDir]);

  useEffect(() => {
    setPage(1);
  }, [search, typeFilter, statusFilter, tagFilter, showAllModules]);

  const totalPages = Math.max(1, Math.ceil(filteredSorted.length / PAGE_SIZE));
  const pageRows = filteredSorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const filtersActive = !!search || typeFilter !== ALL || statusFilter !== ALL || tagFilter !== ALL;
  const clearFilters = () => { setSearch(''); setTypeFilter(ALL); setStatusFilter(ALL); setTagFilter(ALL); };

  const supersedeOptions = useMemo(
    () => refs.filter((r) => r.id !== form.id).map((r) => ({
      value: r.id,
      label: `${r.ref_code} v${r.version_number} · ${r.short_title}`,
    })),
    [refs, form.id],
  );

  const handleSave = async () => {
    if (!form.ref_code || !form.short_title || !form.effective_from) {
      toast.error('Reference code, short title and effective-from are required');
      return;
    }
    const parsedTags = tagInput
      ? tagInput.split(',').map((t) => t.trim()).filter(Boolean)
      : form.tags ?? [];
    const tags = defaultTag && !parsedTags.includes(defaultTag)
      ? [...parsedTags, defaultTag]
      : parsedTags;
    try {
      await upsert.mutateAsync({
        ref: {
          ...form,
          country_code: countryCode,
          ref_code: form.ref_code!,
          short_title: form.short_title!,
          effective_from: form.effective_from!,
          tags: tags.length ? tags : null,
        },
      });
      toast.success('Legal reference saved');
      setOpen(false);
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const openEdit = (r: LegalReference) => {
    setForm(r);
    setTagInput((r.tags ?? []).join(', '));
    setOpen(true);
  };

  const openNew = () => {
    setForm({
      ...empty(countryCode),
      tags: defaultTag ? [defaultTag] : null,
    });
    setTagInput(defaultTag ?? '');
    setOpen(true);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">{title}</h2>
          <p className="text-sm text-muted-foreground">{subtitle}</p>
        </div>
        <div className="flex items-center gap-4">
          {defaultTag && (
            <div className="flex items-center gap-2">
              <Switch id="show-all-modules" checked={showAllModules} onCheckedChange={setShowAllModules} />
              <Label htmlFor="show-all-modules" className="text-sm text-muted-foreground">
                Show all modules (not just {defaultTag})
              </Label>
            </div>
          )}
          <Button size="sm" onClick={openNew} disabled={!countryCode}>
            <Plus className="h-4 w-4 mr-1" />New Reference
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="p-3 flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by code, title, act…"
              className="pl-8"
            />
          </div>
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="w-40"><SelectValue placeholder="Type" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All Types</SelectItem>
              {types.map((t) => (
                <SelectItem key={t.code} value={t.code}>{t.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-40"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All Statuses</SelectItem>
              {STATUS_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={tagFilter} onValueChange={setTagFilter}>
            <SelectTrigger className="w-40"><SelectValue placeholder="Tag" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All Tags</SelectItem>
              {allTags.map((t) => (
                <SelectItem key={t} value={t}>{t}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {filtersActive && (
            <Button variant="ghost" size="sm" onClick={clearFilters}>
              <X className="h-3.5 w-3.5 mr-1" />Clear filters
            </Button>
          )}
          <span className="text-sm text-muted-foreground ml-auto">
            {filteredSorted.length} reference{filteredSorted.length === 1 ? '' : 's'}
          </span>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <SortHead label="Code" k="ref_code" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                <SortHead label="Short Title" k="short_title" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                <SortHead label="Act / Regulation" k="act_name" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                <TableHead>Chapter / Section</TableHead>
                <SortHead label="Effective" k="effective_from" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                <SortHead label="Version" k="version_number" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                <SortHead label="Status" k="status" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                <TableHead className="w-28">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pageRows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-mono text-sm">{r.ref_code}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      {r.short_title}
                      {r.ref_url && (
                        <a href={r.ref_url} target="_blank" rel="noopener noreferrer" aria-label="Open reference URL">
                          <ExternalLink className="h-3 w-3 text-muted-foreground" />
                        </a>
                      )}
                    </div>
                    {r.tags?.length ? (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {r.tags.map((t) => (
                          <Badge key={t} variant="outline" className="text-[10px]">{t}</Badge>
                        ))}
                      </div>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-sm">
                    {r.act_name ?? '—'}
                    {r.regulation && (
                      <div className="text-xs text-muted-foreground">Reg: {r.regulation}</div>
                    )}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {[r.chapter && `Ch. ${r.chapter}`, r.section && `§ ${r.section}`, r.subsection && `(${r.subsection})`]
                      .filter(Boolean)
                      .join(' · ') || '—'}
                  </TableCell>
                  <TableCell className="text-xs">
                    {r.effective_from}
                    {r.effective_to ? ` → ${r.effective_to}` : ''}
                  </TableCell>
                  <TableCell><Badge variant="outline">v{r.version_number}</Badge></TableCell>
                  <TableCell>
                    <Select
                      value={r.status}
                      onValueChange={(v) => setStatus.mutate({ id: r.id, status: v as LegalRefStatus })}
                    >
                      <SelectTrigger className="h-7 text-xs px-2 w-32">
                        <SelectValue>
                          <Badge variant={statusVariant(r.status)} className="text-[10px]">{r.status}</Badge>
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {STATUS_OPTIONS.map((o) => (
                          <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => { setVersionsTarget({ id: r.id, code: r.ref_code }); setVersionsOpen(true); }}
                        aria-label="Versions"
                        title="Version history"
                      >
                        <History className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => openEdit(r)}
                        aria-label="Edit"
                        title={r.status === 'ACTIVE' ? 'Published — open Versions to amend' : 'Edit'}
                      >
                        {r.status === 'ACTIVE'
                          ? <Lock className="h-4 w-4 text-muted-foreground" />
                          : <Pencil className="h-4 w-4" />}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={async () => {
                          if (!confirm('Delete this reference? It cannot be deleted if it is in use or published.')) return;
                          try {
                            await remove.mutateAsync(r.id);
                            toast.success('Deleted');
                          } catch (e: any) {
                            toast.error(e.message);
                          }
                        }}
                        aria-label="Delete"
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </TableCell>

                </TableRow>
              ))}
              {!filteredSorted.length && !isLoading && (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                    {filtersActive
                      ? 'No references match your search/filters'
                      : defaultTag && !showAllModules
                        ? `No ${defaultTag} legal references configured for this country yet`
                        : 'No legal references configured'}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">
            Page {page} of {totalPages}
          </span>
          <div className="flex gap-1">
            <Button variant="outline" size="icon" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="icon" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{form.id ? 'Edit' : 'New'} Legal Reference</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Reference Code *</Label>
              <Input value={form.ref_code || ''} onChange={(e) => setForm((f) => ({ ...f, ref_code: e.target.value.toUpperCase() }))} placeholder="SSA_CAP329_S12" />
            </div>
            <div>
              <Label>Type</Label>
              <Select
                value={form.ref_type ?? '__none__'}
                onValueChange={(v) => setForm((f) => ({ ...f, ref_type: v === '__none__' ? null : v }))}
              >
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">— None —</SelectItem>
                  {types.map((t) => (
                    <SelectItem key={t.code} value={t.code}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="col-span-2">
              <Label>Short Title *</Label>
              <Input value={form.short_title || ''} onChange={(e) => setForm((f) => ({ ...f, short_title: e.target.value }))} placeholder="Social Security Act §12 — Sickness Benefit" />
            </div>
            <div>
              <Label>Act Name</Label>
              <Input value={form.act_name || ''} onChange={(e) => setForm((f) => ({ ...f, act_name: e.target.value }))} placeholder="Social Security Act" />
            </div>
            <div>
              <Label>Jurisdiction</Label>
              <Input value={form.jurisdiction || ''} onChange={(e) => setForm((f) => ({ ...f, jurisdiction: e.target.value || null }))} placeholder="St. Kitts and Nevis" />
            </div>
            <div>
              <Label>Chapter</Label>
              <Input value={form.chapter || ''} onChange={(e) => setForm((f) => ({ ...f, chapter: e.target.value || null }))} placeholder="329" />
            </div>
            <div>
              <Label>Section</Label>
              <Input value={form.section || ''} onChange={(e) => setForm((f) => ({ ...f, section: e.target.value || null }))} placeholder="12" />
            </div>
            <div>
              <Label>Subsection</Label>
              <Input value={form.subsection || ''} onChange={(e) => setForm((f) => ({ ...f, subsection: e.target.value || null }))} placeholder="(a)(ii)" />
            </div>
            <div>
              <Label>Source</Label>
              <Input value={form.source || ''} onChange={(e) => setForm((f) => ({ ...f, source: e.target.value || null }))} placeholder="Official Gazette" />
            </div>
            <div className="col-span-2">
              <Label>Regulation</Label>
              <Input value={form.regulation || ''} onChange={(e) => setForm((f) => ({ ...f, regulation: e.target.value || null }))} placeholder="Social Security (Benefits) Regulations 1978" />
            </div>
            <div className="col-span-2">
              <Label>Full Reference Text</Label>
              <Textarea
                value={form.full_reference_text || ''}
                onChange={(e) => setForm((f) => ({ ...f, full_reference_text: e.target.value || null }))}
                rows={2}
                placeholder="Social Security Act, Cap. 329, §12(a)(ii), as amended"
              />
            </div>
            <div className="col-span-2">
              <Label>URL</Label>
              <Input value={form.ref_url || ''} onChange={(e) => setForm((f) => ({ ...f, ref_url: e.target.value || null }))} placeholder="https://…" />
            </div>
            <div>
              <Label>Effective From *</Label>
              <Input type="date" value={form.effective_from || ''} onChange={(e) => setForm((f) => ({ ...f, effective_from: e.target.value }))} />
            </div>
            <div>
              <Label>Effective To</Label>
              <Input type="date" value={form.effective_to || ''} onChange={(e) => setForm((f) => ({ ...f, effective_to: e.target.value || null }))} />
            </div>
            <div>
              <Label>Status</Label>
              <Select value={form.status || 'DRAFT'} onValueChange={(v) => setForm((f) => ({ ...f, status: v as LegalRefStatus }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Version *</Label>
              <Input type="number" value={form.version_number ?? 1} onChange={(e) => setForm((f) => ({ ...f, version_number: parseInt(e.target.value) || 1 }))} />
            </div>
            <div className="col-span-2">
              <Label>Supersedes</Label>
              <Select
                value={form.supersedes_id ?? '__none__'}
                onValueChange={(v) => setForm((f) => ({ ...f, supersedes_id: v === '__none__' ? null : v }))}
              >
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">— None —</SelectItem>
                  {supersedeOptions.map((o) => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="col-span-2">
              <Label>Tags (comma-separated)</Label>
              <Input value={tagInput} onChange={(e) => setTagInput(e.target.value)} placeholder="sickness, eligibility, LG" />
              {defaultTag && (
                <p className="text-xs text-muted-foreground mt-1">
                  Tag <code className="font-mono">{defaultTag}</code> will be added automatically.
                </p>
              )}
            </div>
            <div className="col-span-2">
              <Label>Notes</Label>
              <Textarea value={form.notes || ''} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value || null }))} rows={2} />
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={form.is_active ?? true} onCheckedChange={(v) => setForm((f) => ({ ...f, is_active: v }))} />
              <Label>Active</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={upsert.isPending}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {versionsTarget && (
        <VersionHistoryDialog
          open={versionsOpen}
          onOpenChange={(o) => { setVersionsOpen(o); if (!o) setVersionsTarget(null); }}
          masterId={versionsTarget.id}
          masterCode={versionsTarget.code}
        />
      )}
    </div>
  );
};

export default LegalReferenceManagement;
