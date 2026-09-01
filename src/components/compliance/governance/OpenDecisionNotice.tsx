import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Info } from 'lucide-react';

interface Props {
  /** Decision codes from the compliance open-decision register. */
  codes: string[];
  className?: string;
}

interface DecisionRow {
  decision_code: string;
  title: string;
  status: string;
  blocker_class: string;
  current_safe_behaviour: string | null;
  client_answer_required: string | null;
}

/**
 * Checkpoint F — surfaces any OPEN client decision that affects the screen the
 * user is looking at, so provisional configuration is never mistaken for
 * confirmed policy.
 */
export default function OpenDecisionNotice({ codes, className }: Props) {
  const { data } = useQuery({
    queryKey: ['ce_open_decision_notice', codes.join(',')],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ce_open_business_decision')
        .select('decision_code,title,status,blocker_class,current_safe_behaviour,client_answer_required')
        .in('decision_code', codes)
        .eq('status', 'OPEN');
      if (error) throw error;
      return (data ?? []) as DecisionRow[];
    },
    enabled: codes.length > 0,
  });

  if (!data || data.length === 0) return null;

  return (
    <div className={className}>
      {data.map((d) => (
        <Alert key={d.decision_code} className="mb-2">
          <Info className="h-4 w-4" />
          <AlertTitle className="text-xs flex items-center gap-2">
            Provisional configuration — awaiting client decision
            <Badge variant="outline" className="text-[10px]">{d.decision_code}</Badge>
            <Badge variant="secondary" className="text-[10px]">
              {d.blocker_class.replace(/_/g, ' ')}
            </Badge>
          </AlertTitle>
          <AlertDescription className="text-xs space-y-1">
            <div>{d.title}</div>
            {d.current_safe_behaviour && (
              <div className="text-muted-foreground">Safe behaviour: {d.current_safe_behaviour}</div>
            )}
            {d.client_answer_required && (
              <div className="text-muted-foreground">Client must confirm: {d.client_answer_required}</div>
            )}
          </AlertDescription>
        </Alert>
      ))}
    </div>
  );
}
