import { useCallback, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { supabase } from '@/integrations/supabase/client';

type SimulatorStep = {
  role: 'system' | 'caller';
  text: string;
};

type SimulateResponse = {
  callSid?: string;
  action?: string;
  text?: string;
  digits?: number | null;
  error?: string;
};

/**
 * Dial-free walkthrough of the inbound Voice/IVR self-service flow.
 *
 * Uses the same governed server-side state machine as the Twilio webhook, so
 * what is spoken here is exactly what a real caller would hear.
 */
export function InboundIvrSimulatorCard() {
  const [fromNumber, setFromNumber] = useState('');
  const [digits, setDigits] = useState('');
  const [callSid, setCallSid] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<SimulatorStep[]>([]);
  const [awaitingDigits, setAwaitingDigits] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const invoke = useCallback(
    async (payload: { callSid?: string | null; from?: string; digits?: string }) => {
      setBusy(true);
      setError(null);
      try {
        const { data, error: fnError } = await supabase.functions.invoke(
          'omni-comms-inbound-voice-simulate',
          {
            body: {
              callSid: payload.callSid ?? undefined,
              from: payload.from ?? undefined,
              digits: payload.digits ?? undefined,
            },
          },
        );
        if (fnError) {
          setError('The simulated call could not be handled. Please try again.');
          return;
        }
        const step = (data ?? {}) as SimulateResponse;
        if (step.error) {
          setError('The simulated call could not be handled. Please try again.');
          return;
        }
        setCallSid(step.callSid ?? null);
        setTranscript((prev) => [...prev, { role: 'system', text: step.text ?? '' }]);
        setAwaitingDigits(step.action === 'gather');
        setDigits('');
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  const startCall = useCallback(() => {
    setTranscript([]);
    setCallSid(null);
    void invoke({ callSid: null, from: fromNumber });
  }, [fromNumber, invoke]);

  const sendDigits = useCallback(() => {
    if (!callSid || digits.trim() === '') return;
    setTranscript((prev) => [...prev, { role: 'caller', text: `Keypad: ${digits.trim()}` }]);
    void invoke({ callSid, from: fromNumber, digits: digits.trim() });
  }, [callSid, digits, fromNumber, invoke]);

  return (
    <Card data-testid="omni-comms-inbound-ivr-simulator">
      <CardHeader>
        <CardTitle>Inbound IVR simulator</CardTitle>
        <CardDescription>
          Walk the inbound self-service flow without placing a phone call. It runs the same
          server-side state machine and live data as a real caller hears.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
          <div className="space-y-1.5">
            <Label htmlFor="omni-ivr-sim-from">Calling number (optional)</Label>
            <Input
              id="omni-ivr-sim-from"
              value={fromNumber}
              onChange={(event) => setFromNumber(event.target.value)}
              placeholder="e.g. 8691234567"
              disabled={busy}
            />
          </div>
          <Button type="button" onClick={startCall} disabled={busy}>
            Start simulated call
          </Button>
        </div>

        {transcript.length > 0 ? (
          <div className="space-y-2 rounded-md border p-3" data-testid="omni-comms-ivr-transcript">
            {transcript.map((step, index) => (
              <p
                key={`${index}-${step.text.slice(0, 12)}`}
                className={
                  step.role === 'system'
                    ? 'text-sm'
                    : 'text-sm font-medium text-muted-foreground'
                }
              >
                {step.role === 'system' ? '🔊 ' : '☎ '}
                {step.text}
              </p>
            ))}
          </div>
        ) : null}

        {awaitingDigits ? (
          <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
            <div className="space-y-1.5">
              <Label htmlFor="omni-ivr-sim-digits">Keypad entry</Label>
              <Input
                id="omni-ivr-sim-digits"
                value={digits}
                onChange={(event) => setDigits(event.target.value.replace(/\D/g, ''))}
                placeholder="Enter digits"
                disabled={busy}
              />
            </div>
            <Button type="button" variant="secondary" onClick={sendDigits} disabled={busy}>
              Send digits
            </Button>
          </div>
        ) : null}

        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </CardContent>
    </Card>
  );
}
