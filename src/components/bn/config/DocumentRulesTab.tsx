import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Plus, Trash2, Edit, Copy, Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useBnDocumentRules, useUpsertBnDocumentRule, useDeleteBnDocumentRule, useBnDocumentProfiles } from '@/hooks/bn/useBnConfig';
import { useBnProductVersions } from '@/hooks/bn/useBnProduct';
import { copyDocumentRequirements } from '@/services/bn/configService';
import { useQueryClient } from '@tanstack/react-query';
import type { BnDocumentRule, BnDocumentProfile } from '@/types/bn';
import { ReadOnlyVersionBanner } from './ReadOnlyVersionBanner';

interface Props { productId: string | undefined; versionId?: string | undefined; isReadOnly?: boolean; versionStatus?: string | null; }

const channelBadge = (c?: string) => {
  const v = (c ?? 'BOTH').toUpperCase();
  if (v === 'ONLINE') return <Badge>Online</Badge>;
  if (v === 'OFFLINE') return <Badge variant="secondary">Offline</Badge>;
  return <Badge variant="outline">Both</Badge>;
};

export function DocumentRulesTab({ productId, versionId, isReadOnly, versionStatus }: Props) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: rules = [], isLoading } = useBnDocumentRules(productId, versionId);
  const { data: versions = [] } = useBnProductVersions(productId);
  const { data: documentProfiles = [] } = useBnDocumentProfiles();
  const upsertMutation = useUpsertBnDocumentRule();
  const deleteMutation = useDeleteBnDocumentRule();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Partial<BnDocumentRule>>({});
  const [conditionText, setConditionText] = useState('');
  const [copyOpen, setCopyOpen] = useState(false);
  const [copySourceId, setCopySourceId] = useState('');
  const [copying, setCopying] = useState(false);

  if (!productId) return <Card><CardContent className="py-8 text-center text-muted-foreground">Save the product first to configure documents.</CardContent></Card>;

  const otherVersions = versions.filter(v => v.id !== versionId);

  const handleCopyFromVersion = async () => {
    if (!versionId || !copySourceId) return;
    setCopying(true);
    try {
      const n = await copyDocumentRequirements(copySourceId, versionId);
      toast({ title: 'Documents Copied', description: `Copied ${n} document requirement(s).` });
      setCopyOpen(false);
      setCopySourceId('');
      qc.invalidateQueries({ queryKey: ['bn', 'document-rules'] });
    } catch (err: any) {
      toast({ title: 'Copy Failed', description: err?.message, variant: 'destructive' });
    } finally {
      setCopying(false);
    }
  };

  const openNew = () => {
    setEditing({
      product_id: productId, product_version_id: versionId,
      document_type_code: '', document_name: '', description: '',
      is_mandatory: true, stage: 'INTAKE', sort_order: 0, is_active: true, max_file_size_mb: 10,
      channel_code: 'BOTH', public_visible: true, internal_visible: true,
      blocks_submission: false, blocks_decision: true, blocks_payment: false, condition_json: {},
    });
    setConditionText('');
    setDialogOpen(true);
  };
  const openEdit = (r: BnDocumentRule) => {
    setEditing({ ...r });
    setConditionText(r.condition_json ? JSON.stringify(r.condition_json, null, 2) : '');
    setDialogOpen(true);
  };
  const update = (f: string, v: unknown) => setEditing(p => ({ ...p, [f]: v }));

  const handleSave = async () => {
    if (!editing.document_type_code || !editing.document_name) {
      toast({ title: 'Validation', description: 'Type code and name are required.', variant: 'destructive' });
      return;
    }
    let condition: Record<string, unknown> = {};
    if (conditionText.trim()) {
      try { condition = JSON.parse(conditionText); }
      catch { toast({ title: 'Invalid Condition JSON', variant: 'destructive' }); return; }
    }
    try {
      await upsertMutation.mutateAsync({ ...editing, condition_json: condition });
      toast({ title: 'Saved' });
      setDialogOpen(false);
    } catch (err: any) {
      // Shielded errors (docs/bn/BENEFITS_MODULE_COMPLETE.md §12.4) — raw
      // Postgres/constraint text must never reach the user directly.
      console.warn('[DocumentRulesTab] save failed', err);
      const raw = String(err?.message ?? '');
      const description = raw.includes('uq_bn_doc_req_version_doc_stage_channel')
        ? 'A document rule for this document, stage, and channel already exists on this product version. Edit the existing one instead of adding a duplicate.'
        : 'Could not save this document rule. Please try again.';
      toast({ title: 'Error', description, variant: 'destructive' });
    }
  };

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Document Requirements</CardTitle>
            <CardDescription>
              Documents required at each stage. Channel and visibility flags control where the document appears
              and whether it blocks submission, decision, or payment.
            </CardDescription>
          </div>
          <div className="flex gap-2">
            {versionId && otherVersions.length > 0 && (
              <Button variant="outline" disabled={isReadOnly} onClick={() => setCopyOpen(true)} className="gap-2">
                <Copy className="h-4 w-4" /> Copy from another version
              </Button>
            )}
            <Button onClick={openNew} disabled={isReadOnly} className="gap-2"><Plus className="h-4 w-4" /> Add Document</Button>
          </div>
        </CardHeader>
        <CardContent>
          <ReadOnlyVersionBanner show={!!isReadOnly} status={versionStatus} />

          {isLoading ? <p className="text-muted-foreground py-4">Loading...</p> : rules.length === 0 ? (
            <p className="text-muted-foreground py-8 text-center">No document rules configured.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Code</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Stage</TableHead>
                    <TableHead>Level</TableHead>
                    <TableHead>Channel</TableHead>
                    <TableHead>Public</TableHead>
                    <TableHead>Internal</TableHead>
                    <TableHead>Blocks Sub</TableHead>
                    <TableHead>Blocks Dec</TableHead>
                    <TableHead>Blocks Pay</TableHead>
                    <TableHead>Cond</TableHead>
                    <TableHead className="w-20">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(() => {
                    // Group rows that share the same (doc_type, stage) AND same settings,
                    // differing only by channel. Collapses ONLINE+OFFLINE duplicates into one row.
                    const groups = new Map<string, BnDocumentRule[]>();
                    for (const r of rules as BnDocumentRule[]) {
                      const settingsKey = [
                        r.document_type_code, r.stage, r.is_mandatory,
                        !!r.blocks_submission, r.blocks_decision !== false, !!r.blocks_payment,
                        r.public_visible !== false, r.internal_visible !== false,
                      ].join('|');
                      const arr = groups.get(settingsKey) ?? [];
                      arr.push(r);
                      groups.set(settingsKey, arr);
                    }
                    return Array.from(groups.values()).map((grp) => {
                      const r = grp[0];
                      const hasCondition = r.condition_json && Object.keys(r.condition_json).length > 0;
                      const channels = new Set(grp.map(g => (g.channel_code ?? 'BOTH').toUpperCase()));
                      const channelDisplay =
                        channels.has('BOTH') || (channels.has('ONLINE') && channels.has('OFFLINE'))
                          ? <Badge variant="outline">Both</Badge>
                          : channels.has('ONLINE')
                            ? <Badge>Online</Badge>
                            : <Badge variant="secondary">Offline</Badge>;
                      return (
                        <TableRow key={grp.map(g => g.id).join('-')}>
                          <TableCell className="font-mono text-xs">{r.document_type_code}</TableCell>
                          <TableCell className="text-sm">{r.document_name}</TableCell>
                          <TableCell><Badge variant="outline">{r.stage}</Badge></TableCell>
                          <TableCell>
                            {r.is_mandatory
                              ? <Badge variant="destructive">Required</Badge>
                              : <Badge variant="secondary">Optional</Badge>}
                          </TableCell>
                          <TableCell>{channelDisplay}</TableCell>
                          <TableCell>{r.public_visible !== false ? '✓' : '—'}</TableCell>
                          <TableCell>{r.internal_visible !== false ? '✓' : '—'}</TableCell>
                          <TableCell>{r.blocks_submission ? '✓' : '—'}</TableCell>
                          <TableCell>{r.blocks_decision !== false ? '✓' : '—'}</TableCell>
                          <TableCell>{r.blocks_payment ? '✓' : '—'}</TableCell>
                          <TableCell>{hasCondition ? <Badge variant="outline">cond</Badge> : '—'}</TableCell>
                          <TableCell>
                            <div className="flex gap-1">
                              <Button variant="ghost" size="icon" disabled={isReadOnly} onClick={() => openEdit(r)}>
                                <Edit className="h-4 w-4" />
                              </Button>
                              <Button variant="ghost" size="icon" disabled={isReadOnly}
                                onClick={async () => {
                                  for (const g of grp) await deleteMutation.mutateAsync(g.id);
                                }}>
                                <Trash2 className="h-4 w-4 text-destructive" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    });
                  })()}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>{editing.id ? 'Edit' : 'Add'} Document Rule</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Document Type Code *</Label>
              <Select
                value={editing.document_type_code || ''}
                onValueChange={(v) => {
                  const profile = documentProfiles.find((p: BnDocumentProfile) => p.profile_code === v);
                  setEditing(prev => ({
                    ...prev,
                    document_type_code: v,
                    document_name: prev.document_name || profile?.profile_name || prev.document_name,
                  }));
                }}
              >
                <SelectTrigger><SelectValue placeholder="Select from Document Library" /></SelectTrigger>
                <SelectContent>
                  {editing.document_type_code && !documentProfiles.some((p: BnDocumentProfile) => p.profile_code === editing.document_type_code) && (
                    <SelectItem value={editing.document_type_code}>{editing.document_type_code} (not in Document Library)</SelectItem>
                  )}
                  {documentProfiles.map((p: BnDocumentProfile) => (
                    <SelectItem key={p.profile_code} value={p.profile_code}>{p.profile_code} — {p.profile_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Document Name *</Label>
              <Input value={editing.document_name || ''} onChange={e => update('document_name', e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Stage</Label>
              <Select value={editing.stage || 'INTAKE'} onValueChange={v => update('stage', v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="INTAKE">Intake</SelectItem>
                  <SelectItem value="EVIDENCE">Evidence Review</SelectItem>
                  <SelectItem value="REVIEW">Review</SelectItem>
                  <SelectItem value="AWARD">Award</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Channel</Label>
              <Select value={(editing.channel_code as string) || 'BOTH'} onValueChange={v => update('channel_code', v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="BOTH">Both</SelectItem>
                  <SelectItem value="ONLINE">Online only</SelectItem>
                  <SelectItem value="OFFLINE">Offline only</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Max File Size (MB)</Label>
              <Input type="number" value={editing.max_file_size_mb ?? 10}
                onChange={e => update('max_file_size_mb', parseFloat(e.target.value) || 10)} />
            </div>
            <div className="space-y-2">
              <Label>Sort Order</Label>
              <Input type="number" value={editing.sort_order ?? 0}
                onChange={e => update('sort_order', parseInt(e.target.value) || 0)} />
            </div>

            <div className="col-span-2 grid grid-cols-3 gap-2 rounded-md border p-3">
              {[
                ['is_mandatory', 'Mandatory'],
                ['is_active', 'Active'],
                ['public_visible', 'Public Visible'],
                ['internal_visible', 'Internal Visible'],
                ['blocks_submission', 'Blocks Submission'],
                ['blocks_decision', 'Blocks Decision'],
                ['blocks_payment', 'Blocks Payment'],
              ].map(([key, label]) => (
                <div key={key} className="flex items-center gap-2">
                  <Switch
                    checked={Boolean((editing as any)[key])}
                    onCheckedChange={v => update(key as string, v)}
                  />
                  <Label className="text-sm">{label}</Label>
                </div>
              ))}
            </div>

            <div className="col-span-2 space-y-2">
              <Label>Condition JSON (optional)</Label>
              <Textarea
                rows={4}
                placeholder='{"applicantAge": {">": 60}}'
                value={conditionText}
                onChange={e => setConditionText(e.target.value)}
                className="font-mono text-xs"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={upsertMutation.isPending}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={copyOpen} onOpenChange={(o) => { setCopyOpen(o); if (!o) setCopySourceId(''); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Copy Documents from Another Version</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Copy all document requirements from a source version into this version. Existing rows are kept; copied rows are added.
            </p>
            <div className="space-y-2">
              <Label>Source Version *</Label>
              <Select value={copySourceId} onValueChange={setCopySourceId}>
                <SelectTrigger><SelectValue placeholder="Select source version" /></SelectTrigger>
                <SelectContent>
                  {otherVersions.map(v => (
                    <SelectItem key={v.id} value={v.id}>
                      V{v.version_number} [{v.status}]
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setCopyOpen(false); setCopySourceId(''); }}>Cancel</Button>
            <Button onClick={handleCopyFromVersion} disabled={!copySourceId || copying} className="gap-2">
              {copying && <Loader2 className="h-4 w-4 animate-spin" />}
              Copy Documents
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
