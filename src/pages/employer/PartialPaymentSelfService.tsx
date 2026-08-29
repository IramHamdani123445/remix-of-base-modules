import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Info, HandCoins } from 'lucide-react';
import { PartialPaymentRequestDialog } from '@/components/compliance/payments/PartialPaymentRequestDialog';

/**
 * Employer self-service path for DR-004 partial payments.
 *
 * The employer offers what they can pay now against one wage period. Nothing is
 * posted until compliance approves and issues a payment authority — and the
 * approval never moves the statutory payment deadline or stops penalties.
 */
export default function PartialPaymentSelfService() {
  const [open, setOpen] = useState(false);

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Request a partial payment</h1>
        <p className="text-muted-foreground">
          Tell the Social Security Board what you can pay now against an outstanding wage period.
        </p>
      </div>

      <Alert>
        <Info className="h-4 w-4" />
        <AlertDescription>
          A partial payment request does not change the legal due date for the period. Penalties,
          interest and enforcement continue to apply to whatever remains unpaid after the statutory
          deadline, whether or not this request is approved.
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <HandCoins className="h-5 w-5" /> Start a request
          </CardTitle>
          <CardDescription>
            You will need your employer registration number, the wage period and the amount you can pay
            now. A compliance officer reviews every request; a payment authority is issued if it is
            approved, and only then may the counter accept the part payment.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={() => setOpen(true)}>Request a partial payment</Button>
        </CardContent>
      </Card>

      <PartialPaymentRequestDialog open={open} onOpenChange={setOpen} />
    </div>
  );
}
