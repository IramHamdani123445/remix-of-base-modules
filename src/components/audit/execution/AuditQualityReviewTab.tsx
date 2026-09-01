import React, { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, ShieldCheck, X } from 'lucide-react';
import { StatusBadge, DataTable } from '@/components/common';
import type { DataTableColumn } from '@/components/common';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { AuditEmptyState } from '@/components/audit/workspace/AuditEmptyState';
import { formatDateForDisplay } from '@/lib/format-config';
import { useStartQualityReview, useConcludeQualityReview } from '@/hooks/useAuditLifecycleCommands';

const REVIEW_TYPES = ['Engagement QA', 'Report QA', 'Hot Review', 'Cold Review'];
const RATINGS = ['Excellent', 'Satisfactory', 'Needs Improvement', 'Unsatisfactory'];

interface AuditQualityReviewTabProps {
  auditId: string;
}

/**
 * Quality Review stage of the governed audit lifecycle.
 *
 * Both transitions (start / conclude) run through Wave-2 SECURITY DEFINER
 * commands — this component never writes `ia_quality_reviews` directly.
 */
export function AuditQualityReviewTab({ auditId }: AuditQualityReviewTabProps) {
  const startReview = useStartQualityReview();
  const concludeReview = useConcludeQualityReview();

  const { data: reviews = [], isLoading } = useQuery({
    queryKey: ['ia_quality_reviews', auditId],
    enabled: !!auditId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('ia_quality_reviews')
        .select('*')
        .eq('engagement_id', auditId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const [reviewType, setReviewType] = useState(REVIEW_TYPES[0]);
  const [concludeRecord, setConcludeRecord] = useState<any>(null);
  const [outcome, setOutcome] = useState<'Cleared' | 'Rework Required'>('Cleared');
  const [rating, setRating] = useState(RATINGS[1]);
  const [notes, setNotes] = useState('');

  const openReview = reviews.find((r) => !r.cleared_at && r.status !== 'Concluded' && r.status !== 'Cleared');

  const submitConclusion = () => {
    if (!concludeRecord) return;
    concludeReview.mutate(
      { reviewId: concludeRecord.id, outcome, qualityRating: outcome === 'Cleared' ? rating : null, notes: notes || null },
      { onSuccess: () => { setConcludeRecord(null); setNotes(''); } },
    );
  };

  const columns: DataTableColumn<any>[] = [
    { key: 'review_type', header: 'Type', render: (r) => <span className="text-sm font-medium">{r.review_type || '—'}</span> },
    { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.cleared_at ? 'Cleared' : (r.status || 'In Review')} /> },
    { key: 'quality_rating', header: 'Rating', render: (r) => <span className="text-sm">{r.quality_rating || '—'}</span> },
    { key: 'required_rework', header: 'Rework', render: (r) => <span className="text-sm">{r.required_rework ? 'Yes' : 'No'}</span> },
    { key: 'reviewer_id', header: 'Reviewer', render: (r) => <span className="text-xs">{r.reviewer_id || '—'}</span> },
    { key: 'review_date', header: 'Reviewed', render: (r) => (r.review_date ? formatDateForDisplay(r.review_date) : '—') },
  ];

  if (isLoading) return <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {reviews.length} quality review(s){openReview ? ' · one review in progress' : ''}
        </p>
        <div className="flex items-center gap-2">
          <Select value={reviewType} onValueChange={setReviewType}>
            <SelectTrigger className="h-9 w-[180px]"><SelectValue /></SelectTrigger>
            <SelectContent>{REVIEW_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
          </Select>
          <Button
            size="sm"
            disabled={!!openReview || startReview.isPending}
            onClick={() => startReview.mutate({ engagementId: auditId, reviewType })}
          >
            {startReview.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}Start quality review
          </Button>
        </div>
      </div>

      {concludeRecord && (
        <Card className="border-primary/40">
          <CardContent className="p-4 space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold">Conclude quality review</p>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setConcludeRecord(null)}><X className="h-4 w-4" /></Button>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div><Label>Outcome *</Label>
                <Select value={outcome} onValueChange={(v) => setOutcome(v as 'Cleared' | 'Rework Required')}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Cleared">Cleared</SelectItem>
                    <SelectItem value="Rework Required">Rework Required</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {outcome === 'Cleared' && (
                <div><Label>Quality rating</Label>
                  <Select value={rating} onValueChange={setRating}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{RATINGS.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              )}
            </div>
            <div>
              <Label>{outcome === 'Cleared' ? 'Reviewer observations' : 'Rework required *'}</Label>
              <Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
            <div className="flex gap-2">
              <Button
                onClick={submitConclusion}
                disabled={concludeReview.isPending || (outcome === 'Rework Required' && !notes.trim())}
              >
                {concludeReview.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}Record outcome
              </Button>
              <Button variant="outline" onClick={() => setConcludeRecord(null)}>Cancel</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {reviews.length === 0 ? (
        <AuditEmptyState
          icon={ShieldCheck}
          title="No quality review started"
          description="Quality review is the independent check performed before the final report can be issued and the audit closed."
        />
      ) : (
        <Card><CardContent className="pt-4">
          <DataTable
            columns={columns}
            data={reviews}
            emptyMessage="No quality reviews."
            renderActions={(row) => (
              <div className="flex gap-1">
                {!row.cleared_at && row.status !== 'Concluded' && (
                  <Button size="sm" variant="outline" onClick={() => { setConcludeRecord(row); setOutcome('Cleared'); setNotes(''); }}>
                    Conclude
                  </Button>
                )}
              </div>
            )}
          />
        </CardContent></Card>
      )}
    </div>
  );
}
