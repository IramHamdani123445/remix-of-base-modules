/**
 * Omni-Comms Control Center — the PRINT surface.
 *
 * Print is produced by the in-platform print spool. It has no external
 * provider, no API credential, no sending domain, no DNS record and no
 * delivery callback, so the provider-oriented gates, the two-person delivery
 * proposal and the provider test-send used by Email and SMS DO NOT apply here
 * and are deliberately not rendered — showing them would be ambiguous.
 *
 * The single authoritative control is the Print readiness panel, whose switch
 * calls the trusted-path server RPC that re-verifies every real Print gate.
 */
import React from 'react';
import { Link } from 'react-router-dom';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Info, Printer } from 'lucide-react';
import PrintReadinessPanel from '../operations/PrintReadinessPanel';

const NOT_APPLICABLE_HERE = [
  'API credentials and credential verification',
  'Sending domain and DNS records',
  'Delivery callbacks / webhook signing',
  'Provider test send and two-person provider approval',
];

export const PrintControlSurface: React.FC = () => (
  <div className="space-y-6" data-testid="omni-comms-print-control-surface">
    <PrintReadinessPanel />

    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start gap-3">
          <Printer className="mt-1 h-5 w-5 text-primary" aria-hidden="true" />
          <div>
            <CardTitle className="text-base">Letters waiting to be produced</CardTitle>
            <CardDescription>
              Physical production, batching and reconciliation happen in the
              print queue.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <Button asChild size="sm" variant="outline">
          <Link to="/admin/omnichannel-communications/operations">
            Open print production queue
          </Link>
        </Button>
      </CardContent>
    </Card>

    <Alert>
      <Info className="h-4 w-4" />
      <AlertTitle>What does not apply to Print</AlertTitle>
      <AlertDescription>
        <ul className="ml-4 list-disc">
          {NOT_APPLICABLE_HERE.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
        <p className="mt-2">
          The print spool never contacts an external service, so these controls
          are not shown for Print. Proof of production is the archived PDF and
          the print queue record.
        </p>
      </AlertDescription>
    </Alert>
  </div>
);

export default PrintControlSurface;
