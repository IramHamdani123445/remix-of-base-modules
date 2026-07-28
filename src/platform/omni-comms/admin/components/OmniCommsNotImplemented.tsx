/**
 * Shared "Not yet implemented" empty state for Omnichannel Communications
 * shell pages. Renders no business data, no metrics, no provider status, and
 * exposes no controls.
 */
import React from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Clock } from "lucide-react";

export interface OmniCommsNotImplementedProps {
  title: string;
  capability: string;
  description: string;
}

export const OmniCommsNotImplemented: React.FC<OmniCommsNotImplementedProps> = ({
  title,
  capability,
  description,
}) => {
  return (
    <div
      data-testid="omni-comms-not-implemented"
      className="container mx-auto p-6 space-y-6"
    >
      <div>
        <h1 className="text-2xl font-semibold">{title}</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Omnichannel Communications
        </p>
      </div>

      <Alert>
        <Clock className="h-4 w-4" />
        <AlertTitle>Not yet implemented</AlertTitle>
        <AlertDescription>
          This screen is part of the new Omnichannel Communications system and
          has not been built yet. No data is displayed and no operational
          controls are exposed.
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Future capability</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p>{description}</p>
          <p className="text-muted-foreground">
            Reserved capability: <code>{capability}</code>
          </p>
        </CardContent>
      </Card>
    </div>
  );
};

export default OmniCommsNotImplemented;
