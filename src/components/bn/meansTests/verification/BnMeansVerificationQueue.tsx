/**
 * MEANS-TEST EPIC 8 — verification queue.
 *
 * Submitted assessments carrying outstanding verification work. Scope,
 * counts and ordering are all produced by the governed queue query; nothing
 * here is derived in the browser.
 */
import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { AlertTriangle, ShieldAlert } from 'lucide-react';
import { meansQueryService } from '@/services/bn/meansTests/meansQueryService';
import { humaniseMeansCode } from '@/types/bn/meansTests/meansFieldContract';
import {
  BN_MEANS_VERIFICATION_QUEUE_SCOPES,
  type BnMeansVerificationQueueRow,
  type BnMeansVerificationQueueScope,
} from '@/types/bn/meansTests/meansVerification';

export interface BnMeansVerificationQueueProps {
  readonly onOpen: (assessmentId: string) => void;
}

export const BnMeansVerificationQueue: React.FC<BnMeansVerificationQueueProps> = ({ onOpen }) => {
  const [scope, setScope] = React.useState<BnMeansVerificationQueueScope>('OUTSTANDING');
  const [search, setSearch] = React.useState('');

  const queue = useQuery({
    queryKey: ['bn-means-verification-queue', scope, search],
    queryFn: () => meansQueryService.verificationQueue({ scope, search: search || undefined }),
  });

  const rows = (queue.data?.status === 'OK' ? queue.data.data ?? [] : []) as readonly BnMeansVerificationQueueRow[];
  const definition = BN_MEANS_VERIFICATION_QUEUE_SCOPES.find((s) => s.code === scope)!;

  return (
    <Card data-testid="means-verification-queue">
      <CardHeader>
        <CardTitle>Verification queue</CardTitle>
        <CardDescription>{definition.description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-end gap-2">
          {BN_MEANS_VERIFICATION_QUEUE_SCOPES.map((s) => (
            <Button
              key={s.code}
              size="sm"
              variant={s.code === scope ? 'default' : 'outline'}
              onClick={() => setScope(s.code)}
              data-testid={`means-verification-scope-${s.code}`}
            >
              {s.label}
            </Button>
          ))}
          <div className="ml-auto space-y-1">
            <Label htmlFor="mt-verify-search" className="text-xs">Reference search</Label>
            <Input
              id="mt-verify-search"
              className="w-56"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="MT-2026-…"
            />
          </div>
        </div>

        {queue.isLoading ? (
          <Skeleton className="h-32 w-full" />
        ) : queue.data && queue.data.status === 'DENIED' ? (
          <Alert variant="destructive" data-testid="means-verification-queue-denied">
            <ShieldAlert className="h-4 w-4" />
            <AlertTitle>Access denied</AlertTitle>
            <AlertDescription>You do not hold permission to view verification work.</AlertDescription>
          </Alert>
        ) : queue.isError || (queue.data && queue.data.status !== 'OK') ? (
          <Alert variant="destructive" data-testid="means-verification-queue-failed">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>The verification queue could not be loaded</AlertTitle>
            <AlertDescription>{queue.data?.detail ?? queue.data?.code ?? 'Unknown error'}</AlertDescription>
          </Alert>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing is waiting in this view.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Reference</TableHead>
                <TableHead>Programme</TableHead>
                <TableHead>Submitted</TableHead>
                <TableHead>Version</TableHead>
                <TableHead>To decide</TableHead>
                <TableHead>Awaiting clarification</TableHead>
                <TableHead>Mine</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.assessment_version_id} data-testid={`means-verification-row-${row.assessment_id}`}>
                  <TableCell className="font-medium">{row.assessment_reference}</TableCell>
                  <TableCell>{humaniseMeansCode(row.benefit_programme)}</TableCell>
                  <TableCell className="text-xs">{String(row.frozen_at ?? '').slice(0, 10)}</TableCell>
                  <TableCell>
                    <Badge variant="outline">v{row.version_no}</Badge>
                  </TableCell>
                  <TableCell>{row.pending_work + row.in_progress_work}</TableCell>
                  <TableCell>{row.clarification_work}</TableCell>
                  <TableCell>{row.my_work}</TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" variant="ghost" onClick={() => onOpen(row.assessment_id)}>
                      Open
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
};

export default BnMeansVerificationQueue;
