/**
 * Payment Exceptions Management (Screen 17)
 *
 * Business Purpose: Handle Stop/Void/Reissue/Stale-Date exceptions
 * with supervisor approval and full audit trail.
 *
 * Tables: bn_payment_exception, bn_issue_record, bn_claim_event
 * Legacy: cl_cheques (status update only via adapter)
 */
import React, { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from '@/components/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import {
  AlertTriangle, Ban, RotateCcw, Clock, CheckCircle2, XCircle,
  Search, X, Loader2, ShieldAlert, FileText, Eye, Hand, StopCircle,
} from 'lucide-react';
import { BnStatusBadge } from '@/components/bn/shared/BnStatusBadge';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { formatDateForDisplay } from '@/lib/format-config';

import { formatNumber } from '@/lib/culture/culture';
import { useActorUserCode } from '@/hooks/bn/useActorUserCode';
const db = supabase as any;

// ─── Types ──────────────────────────────────────────────────────────

type ExceptionType =
  | 'DUPLICATE_PAYMENT'
  | 'ISSUE_FAILURE'
  | 'POST_ISSUE_FAILURE'
  | 'VOID_REQUEST'
  | 'STOP_REQUEST'
  | 'REISSUE_REQUEST'
  | 'STALE_DATED'
  | 'AMOUNT_MISMATCH'
  | 'BANK_REJECT'
  | 'ADDRESS_INVALID';

type ExceptionStatus = 'OPEN' | 'UNDER_REVIEW' | 'APPROVED' | 'RESOLVED' | 'REJECTED' | 'CANCELLED';

interface PaymentException {
  id: string;
  instruction_id: string | null;
  batch_id: string | null;
  exception_type: ExceptionType;
  description: string;
  status: ExceptionStatus;
  raised_by: string;
  raised_at: string;
  assigned_to: string | null;
  resolution_action: string | null;
  resolution_notes: string | null;
  resolved_by: string | null;
  resolved_at: string | null;
  supervisor_approval: boolean;
  approved_by: string | null;
  approved_at: string | null;
  related_issue_id: string | null;
  related_cheque_no: string | null;
  ssn: string | null;
  claim_number: string | null;
  amount: number | null;
  created_at: string;
}

interface ExceptionFilters {
  status?: ExceptionStatus;
  exception_type?: ExceptionType;
  search?: string;
}

const EXCEPTION_TYPE_LABELS: Record<string, string> = {
  DUPLICATE_PAYMENT: 'Duplicate Payment',
  ISSUE_FAILURE: 'Issue Failure',
  POST_ISSUE_FAILURE: 'Post-Issue Failure',
  VOID_REQUEST: 'Void Request',
  STOP_REQUEST: 'Stop Request',
  REISSUE_REQUEST: 'Reissue Request',
  STALE_DATED: 'Stale Dated',
  AMOUNT_MISMATCH: 'Amount Mismatch',
  BANK_REJECT: 'Bank Rejection',
  ADDRESS_INVALID: 'Invalid Address',
};

const STATUS_LABELS: Record<string, string> = {
  OPEN: 'Open',
  UNDER_REVIEW: 'Under Review',
  APPROVED: 'Approved',
  RESOLVED: 'Resolved',
  REJECTED: 'Rejected',
  CANCELLED: 'Cancelled',
};

const RESOLUTION_ACTIONS = [
  { value: 'VOID_AND_REISSUE', label: 'Void & Reissue' },
  { value: 'VOID_ONLY', label: 'Void Only (No Reissue)' },
  { value: 'STOP_PAYMENT', label: 'Stop Payment' },
  { value: 'REISSUE_NEW', label: 'Reissue New Cheque' },
  { value: 'MANUAL_CORRECTION', label: 'Manual Correction' },
  { value: 'NO_ACTION', label: 'No Action Required' },
  { value: 'ESCALATE', label: 'Escalate to Management' },
];

const STAT_CARDS = [
  { key: 'open', label: 'Open', icon: AlertTriangle, color: 'text-amber-600' },
  { key: 'underReview', label: 'Under Review', icon: Clock, color: 'text-blue-600' },
  { key: 'approved', label: 'Approved', icon: CheckCircle2, color: 'text-green-600' },
  { key: 'resolved', label: 'Resolved', icon: CheckCircle2, color: 'text-emerald-600' },
  { key: 'rejected', label: 'Rejected', icon: XCircle, color: 'text-destructive' },
];

// ─── Hooks ──────────────────────────────────────────────────────────

function useExceptions(filters: ExceptionFilters) {
  return useQuery({
    queryKey: ['bn', 'exceptions', filters],
    queryFn: async () => {
      let query = db.from('bn_payment_exception').select('*').order('created_at', { ascending: false });
      if (filters.status) query = query.eq('status', filters.status);
      if (filters.exception_type) query = query.eq('exception_type', filters.exception_type);
      if (filters.search) {
        query = query.or(`ssn.ilike.%${filters.search}%,claim_number.ilike.%${filters.search}%,related_cheque_no.ilike.%${filters.search}%,description.ilike.%${filters.search}%`);
      }
      const { data, error } = await query;
      if (error) throw error;
      return (data || []) as PaymentException[];
    },
    refetchInterval: 15_000,
  });
}

function useResolveException() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: {
      exceptionId: string;
      action: string;
      notes: string;
      userCode: string;
      requiresApproval: boolean;
    }) => {
      const newStatus = params.requiresApproval ? 'UNDER_REVIEW' : 'RESOLVED';
      const { error } = await db.from('bn_payment_exception').update({
        status: newStatus,
        resolution_action: params.action,
        resolution_notes: params.notes,
        resolved_by: params.requiresApproval ? null : params.userCode,
        resolved_at: params.requiresApproval ? null : new Date().toISOString(),
        assigned_to: params.requiresApproval ? 'SUPERVISOR' : params.userCode,
      }).eq('id', params.exceptionId);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['bn', 'exceptions'] }),
  });
}

function useApproveException() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: { exceptionId: string; approved: boolean; userCode: string; notes?: string }) => {
      const update: any = {
        status: params.approved ? 'APPROVED' : 'REJECTED',
        supervisor_approval: params.approved,
        approved_by: params.userCode,
        approved_at: new Date().toISOString(),
      };
      if (params.notes) update.resolution_notes = params.notes;
      const { error } = await db.from('bn_payment_exception').update(update).eq('id', params.exceptionId);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['bn', 'exceptions'] }),
  });
}

function useRaiseException() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: {
      exception_type: ExceptionType;
      description: string;
      ssn?: string;
      claim_number?: string;
      related_cheque_no?: string;
      amount?: number;
      userCode: string;
    }) => {
      const { error } = await db.from('bn_payment_exception').insert({
        exception_type: params.exception_type,
        description: params.description,
        status: 'OPEN',
        raised_by: params.userCode,
        raised_at: new Date().toISOString(),
        ssn: params.ssn || null,
        claim_number: params.claim_number || null,
        related_cheque_no: params.related_cheque_no || null,
        amount: params.amount || null,
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['bn', 'exceptions'] }),
  });
}

// ─── Component ──────────────────────────────────────────────────────

export default function PaymentExceptions() {
  // Writes must name a person, never the 'CURRENT_USER' placeholder.
  const { actor } = useActorUserCode();

  const [filters, setFilters] = useState<ExceptionFilters>({});
  const [selectedEx, setSelectedEx] = useState<PaymentException | null>(null);
  const [showResolve, setShowResolve] = useState(false);
  const [showRaise, setShowRaise] = useState(false);
  const [showApproval, setShowApproval] = useState(false);

  // Resolve form
  const [resolveAction, setResolveAction] = useState('');
  const [resolveNotes, setResolveNotes] = useState('');
  const [requiresApproval, setRequiresApproval] = useState(true);

  // Raise form
  const [raiseType, setRaiseType] = useState<ExceptionType>('VOID_REQUEST');
  const [raiseDesc, setRaiseDesc] = useState('');
  const [raiseSsn, setRaiseSsn] = useState('');
  const [raiseClaim, setRaiseClaim] = useState('');
  const [raiseCheque, setRaiseCheque] = useState('');
  const [raiseAmount, setRaiseAmount] = useState('');

  const { data: exceptions = [], isLoading } = useExceptions(filters);
  const resolveMut = useResolveException();
  const approveMut = useApproveException();
  const raiseMut = useRaiseException();

  const stats = useMemo(() => ({
    open: exceptions.filter(e => e.status === 'OPEN').length,
    underReview: exceptions.filter(e => e.status === 'UNDER_REVIEW').length,
    approved: exceptions.filter(e => e.status === 'APPROVED').length,
    resolved: exceptions.filter(e => e.status === 'RESOLVED').length,
    rejected: exceptions.filter(e => e.status === 'REJECTED').length,
  }), [exceptions]);

  const handleResolve = async () => {
    if (!selectedEx || !resolveAction) return;
    try {
      await resolveMut.mutateAsync({
        exceptionId: selectedEx.id,
        action: resolveAction,
        notes: resolveNotes,
        userCode: actor(),
        requiresApproval,
      });
      toast.success(requiresApproval ? 'Sent for supervisor approval' : 'Exception resolved');
      setShowResolve(false);
      setSelectedEx(null);
      setResolveAction('');
      setResolveNotes('');
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const handleApproval = async (approved: boolean) => {
    if (!selectedEx) return;
    try {
      await approveMut.mutateAsync({
        exceptionId: selectedEx.id,
        approved,
        userCode: actor(),
      });
      toast.success(approved ? 'Exception approved' : 'Exception rejected');
      setShowApproval(false);
      setSelectedEx(null);
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const handleRaise = async () => {
    if (!raiseDesc.trim()) return;
    try {
      await raiseMut.mutateAsync({
        exception_type: raiseType,
        description: raiseDesc,
        ssn: raiseSsn || undefined,
        claim_number: raiseClaim || undefined,
        related_cheque_no: raiseCheque || undefined,
        amount: raiseAmount ? parseFloat(raiseAmount) : undefined,
        userCode: actor(),
      });
      toast.success('Exception raised');
      setShowRaise(false);
      setRaiseDesc('');
      setRaiseSsn('');
      setRaiseClaim('');
      setRaiseCheque('');
      setRaiseAmount('');
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const hasFilters = Object.values(filters).some(Boolean);

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-destructive/10">
            <ShieldAlert className="h-6 w-6 text-destructive" />
          </div>
          <div>
            <h1 className="t-page-title">Payment Exceptions</h1>
            <p className="t-page-subtitle mt-1">
              Stop, Void, Reissue, and exception management with supervisor approval
            </p>
          </div>
        </div>
        <Button onClick={() => setShowRaise(true)} className="gap-2">
          <AlertTriangle className="h-4 w-4" /> Raise Exception
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {STAT_CARDS.map(({ key, label, icon: Icon, color }) => (
          <Card key={key}>
            <CardContent className="p-3 text-center">
              <Icon className={`h-5 w-5 mx-auto mb-1 ${color}`} />
              <div className="text-lg font-bold">{stats[key as keyof typeof stats]}</div>
              <div className="text-[10px] text-muted-foreground uppercase tracking-wider">{label}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search SSN / Claim / Cheque..."
            value={filters.search || ''}
            onChange={(e) => setFilters({ ...filters, search: e.target.value || undefined })}
            className="pl-8 w-56"
          />
        </div>
        <Select
          value={filters.status || '__all'}
          onValueChange={(v) => setFilters({ ...filters, status: v === '__all' ? undefined : v as ExceptionStatus })}
        >
          <SelectTrigger className="w-40"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all">All Statuses</SelectItem>
            {Object.entries(STATUS_LABELS).map(([k, v]) => (
              <SelectItem key={k} value={k}>{v}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={filters.exception_type || '__all'}
          onValueChange={(v) => setFilters({ ...filters, exception_type: v === '__all' ? undefined : v as ExceptionType })}
        >
          <SelectTrigger className="w-44"><SelectValue placeholder="Type" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all">All Types</SelectItem>
            {Object.entries(EXCEPTION_TYPE_LABELS).map(([k, v]) => (
              <SelectItem key={k} value={k}>{v}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {hasFilters && (
          <Button variant="ghost" size="sm" onClick={() => setFilters({})} className="gap-1 text-xs">
            <X className="h-3.5 w-3.5" /> Clear
          </Button>
        )}
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : exceptions.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              No exceptions found.
            </div>
          ) : (
            <div className="overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead className="font-semibold text-xs">Type</TableHead>
                    <TableHead className="font-semibold text-xs">SSN</TableHead>
                    <TableHead className="font-semibold text-xs">Claim</TableHead>
                    <TableHead className="font-semibold text-xs">Cheque</TableHead>
                    <TableHead className="font-semibold text-xs text-right">Amount</TableHead>
                    <TableHead className="font-semibold text-xs">Status</TableHead>
                    <TableHead className="font-semibold text-xs">Raised</TableHead>
                    <TableHead className="font-semibold text-xs">Resolution</TableHead>
                    <TableHead className="font-semibold text-xs w-[100px]">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {exceptions.map((ex) => (
                    <TableRow key={ex.id} className="cursor-pointer hover:bg-muted/30" onClick={() => setSelectedEx(ex)}>
                      <TableCell>
                        <Badge variant="outline" className="text-[10px]">
                          {EXCEPTION_TYPE_LABELS[ex.exception_type] || ex.exception_type}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-mono text-xs">{ex.ssn || '—'}</TableCell>
                      <TableCell className="text-xs">{ex.claim_number || '—'}</TableCell>
                      <TableCell className="font-mono text-xs">{ex.related_cheque_no || '—'}</TableCell>
                      <TableCell className="text-right font-mono text-xs">
                        {ex.amount ? formatNumber(ex.amount, 2) : '—'}
                      </TableCell>
                      <TableCell><BnStatusBadge status={ex.status} size="sm" dot /></TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {formatDateForDisplay(ex.raised_at || ex.created_at)}
                      </TableCell>
                      <TableCell className="text-xs">
                        {ex.resolution_action ? RESOLUTION_ACTIONS.find(a => a.value === ex.resolution_action)?.label || ex.resolution_action : '—'}
                      </TableCell>
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <div className="flex gap-1">
                          {ex.status === 'OPEN' && (
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { setSelectedEx(ex); setShowResolve(true); }}>
                              <FileText className="h-3.5 w-3.5" />
                            </Button>
                          )}
                          {ex.status === 'UNDER_REVIEW' && (
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { setSelectedEx(ex); setShowApproval(true); }}>
                              <CheckCircle2 className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Detail Sheet */}
      <Sheet open={!!selectedEx && !showResolve && !showApproval} onOpenChange={(v) => !v && setSelectedEx(null)}>
        <SheetContent className="sm:max-w-lg overflow-y-auto">
          {selectedEx && (
            <>
              <SheetHeader>
                <SheetTitle className="flex items-center gap-2">
                  <ShieldAlert className="h-5 w-5 text-destructive" />
                  Exception Detail
                </SheetTitle>
              </SheetHeader>
              <div className="space-y-4 mt-4">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-[10px] text-muted-foreground uppercase">Type</p>
                    <p className="text-sm font-medium">{EXCEPTION_TYPE_LABELS[selectedEx.exception_type]}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-muted-foreground uppercase">Status</p>
                    <BnStatusBadge status={selectedEx.status} size="sm" dot />
                  </div>
                  <div>
                    <p className="text-[10px] text-muted-foreground uppercase">SSN</p>
                    <p className="font-mono text-sm">{selectedEx.ssn || '—'}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-muted-foreground uppercase">Claim</p>
                    <p className="text-sm">{selectedEx.claim_number || '—'}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-muted-foreground uppercase">Cheque #</p>
                    <p className="font-mono text-sm">{selectedEx.related_cheque_no || '—'}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-muted-foreground uppercase">Amount</p>
                    <p className="font-mono text-sm">{selectedEx.amount != null ? formatNumber(selectedEx.amount, 2) : '—'}</p>
                  </div>
                </div>

                <div>
                  <p className="text-[10px] text-muted-foreground uppercase mb-1">Description</p>
                  <p className="text-sm bg-muted/50 rounded p-2">{selectedEx.description}</p>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-[10px] text-muted-foreground uppercase">Raised By</p>
                    <p className="text-sm">{selectedEx.raised_by}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-muted-foreground uppercase">Raised At</p>
                    <p className="text-sm">{formatDateForDisplay(selectedEx.raised_at || selectedEx.created_at)}</p>
                  </div>
                </div>

                {selectedEx.resolution_action && (
                  <div className="border-t pt-3 space-y-2">
                    <p className="text-xs font-semibold">Resolution</p>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <p className="text-[10px] text-muted-foreground uppercase">Action</p>
                        <p className="text-sm">{RESOLUTION_ACTIONS.find(a => a.value === selectedEx.resolution_action)?.label}</p>
                      </div>
                      <div>
                        <p className="text-[10px] text-muted-foreground uppercase">Resolved By</p>
                        <p className="text-sm">{selectedEx.resolved_by || '—'}</p>
                      </div>
                    </div>
                    {selectedEx.resolution_notes && (
                      <div>
                        <p className="text-[10px] text-muted-foreground uppercase">Notes</p>
                        <p className="text-sm bg-muted/50 rounded p-2">{selectedEx.resolution_notes}</p>
                      </div>
                    )}
                  </div>
                )}

                {selectedEx.approved_by && (
                  <div className="border-t pt-3">
                    <p className="text-xs font-semibold mb-2">Supervisor Approval</p>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <p className="text-[10px] text-muted-foreground uppercase">Approved By</p>
                        <p className="text-sm">{selectedEx.approved_by}</p>
                      </div>
                      <div>
                        <p className="text-[10px] text-muted-foreground uppercase">Decision</p>
                        <BnStatusBadge status={selectedEx.supervisor_approval ? 'APPROVED' : 'REJECTED'} size="sm" dot />
                      </div>
                    </div>
                  </div>
                )}

                <div className="flex gap-2 pt-3 border-t">
                  {selectedEx.status === 'OPEN' && (
                    <Button size="sm" onClick={() => setShowResolve(true)} className="gap-1.5">
                      <FileText className="h-3.5 w-3.5" /> Resolve
                    </Button>
                  )}
                  {selectedEx.status === 'UNDER_REVIEW' && (
                    <Button size="sm" onClick={() => setShowApproval(true)} className="gap-1.5">
                      <CheckCircle2 className="h-3.5 w-3.5" /> Review
                    </Button>
                  )}
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      {/* Resolve Dialog */}
      <Dialog open={showResolve} onOpenChange={(v) => !v && setShowResolve(false)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Resolve Exception</DialogTitle>
            <DialogDescription>
              Select a resolution action and provide notes.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label className="text-xs">Resolution Action</Label>
              <Select value={resolveAction} onValueChange={setResolveAction}>
                <SelectTrigger><SelectValue placeholder="Select action..." /></SelectTrigger>
                <SelectContent>
                  {RESOLUTION_ACTIONS.map(a => (
                    <SelectItem key={a.value} value={a.value}>{a.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Notes</Label>
              <Textarea value={resolveNotes} onChange={(e) => setResolveNotes(e.target.value)} rows={3} placeholder="Resolution details..." />
            </div>
            <div className="flex items-center gap-2">
              <input type="checkbox" id="reqApproval" checked={requiresApproval} onChange={(e) => setRequiresApproval(e.target.checked)} />
              <Label htmlFor="reqApproval" className="text-xs">Requires supervisor approval</Label>
            </div>
            {['VOID_AND_REISSUE', 'VOID_ONLY', 'STOP_PAYMENT'].includes(resolveAction) && (
              <div className="rounded bg-amber-50 dark:bg-amber-950/20 border border-amber-200 p-2 text-xs text-amber-700 dark:text-amber-400">
                <AlertTriangle className="h-3 w-3 inline mr-1" />
                This action will modify legacy payment records. Supervisor approval is recommended.
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowResolve(false)}>Cancel</Button>
            <Button onClick={handleResolve} disabled={!resolveAction || resolveMut.isPending}>
              {resolveMut.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
              {requiresApproval ? 'Submit for Approval' : 'Resolve'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Approval Dialog */}
      <Dialog open={showApproval} onOpenChange={(v) => !v && setShowApproval(false)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Supervisor Review</DialogTitle>
            <DialogDescription>
              Review and approve or reject the proposed resolution.
            </DialogDescription>
          </DialogHeader>
          {selectedEx && (
            <div className="space-y-3 py-2">
              <div className="rounded border p-3 space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Type:</span>
                  <span className="font-medium">{EXCEPTION_TYPE_LABELS[selectedEx.exception_type]}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Proposed Action:</span>
                  <span className="font-medium">
                    {RESOLUTION_ACTIONS.find(a => a.value === selectedEx.resolution_action)?.label}
                  </span>
                </div>
                {selectedEx.resolution_notes && (
                  <div className="text-xs bg-muted/50 rounded p-2 mt-1">{selectedEx.resolution_notes}</div>
                )}
              </div>
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => handleApproval(false)} disabled={approveMut.isPending}>
              <XCircle className="h-4 w-4 mr-1" /> Reject
            </Button>
            <Button onClick={() => handleApproval(true)} disabled={approveMut.isPending}>
              {approveMut.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
              <CheckCircle2 className="h-4 w-4 mr-1" /> Approve
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Raise Exception Dialog */}
      <Dialog open={showRaise} onOpenChange={(v) => !v && setShowRaise(false)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Raise Payment Exception</DialogTitle>
            <DialogDescription>
              Create a new exception for stop, void, reissue, or other issues.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label className="text-xs">Exception Type</Label>
              <Select value={raiseType} onValueChange={(v) => setRaiseType(v as ExceptionType)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(EXCEPTION_TYPE_LABELS).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">SSN (optional)</Label>
                <Input value={raiseSsn} onChange={(e) => setRaiseSsn(e.target.value)} placeholder="SSN" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Claim # (optional)</Label>
                <Input value={raiseClaim} onChange={(e) => setRaiseClaim(e.target.value)} placeholder="Claim" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Cheque # (optional)</Label>
                <Input value={raiseCheque} onChange={(e) => setRaiseCheque(e.target.value)} placeholder="Cheque" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Amount (optional)</Label>
                <Input type="number" value={raiseAmount} onChange={(e) => setRaiseAmount(e.target.value)} placeholder="0.00" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Description</Label>
              <Textarea value={raiseDesc} onChange={(e) => setRaiseDesc(e.target.value)} rows={3} placeholder="Describe the exception..." />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowRaise(false)}>Cancel</Button>
            <Button onClick={handleRaise} disabled={!raiseDesc.trim() || raiseMut.isPending}>
              {raiseMut.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
              Raise Exception
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
