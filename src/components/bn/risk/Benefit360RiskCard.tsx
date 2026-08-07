/**
 * Benefit 360 — privacy-safe risk indicator.
 *
 * Deliberately shows ONLY whether a risk review is live. Categories, rules,
 * narrative, evidence and links are never exposed on the 360 view: those
 * belong to the Risk workspace and its own permissions.
 */
import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ShieldAlert } from 'lucide-react';
import { riskQueryService } from '@/services/bn/risk/riskQueryService';

interface Props {
  personId: number | null | undefined;
}

export const Benefit360RiskCard: React.FC<Props> = ({ personId }) => {
  const summary = useQuery({
    queryKey: ['bn-risk-person-safe-summary', personId],
    queryFn: async () => {
      const result = await riskQueryService.personSafeSummary(personId as number);
      if (result.status !== 'OK' || !result.data) return null;
      return result.data;
    },
    enabled: !!personId,
  });

  if (!personId) return null;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center gap-2 space-y-0">
        <ShieldAlert className="h-4 w-4 text-muted-foreground" />
        <CardTitle className="text-base">Risk review</CardTitle>
      </CardHeader>
      <CardContent className="text-sm">
        {summary.isLoading && <Skeleton className="h-5 w-40" />}
        {!summary.isLoading && !summary.data && (
          <span className="text-muted-foreground">Not available to you.</span>
        )}
        {summary.data && (
          <Badge
            variant={summary.data.review_state === 'NO_ACTIVE_REVIEW' ? 'secondary' : 'destructive'}
          >
            {summary.data.review_state_label}
          </Badge>
        )}
      </CardContent>
    </Card>
  );
};
