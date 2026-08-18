/**
 * Omni-Comms Templates — business-oriented catalogue view.
 *
 * Renders MODULE → BUSINESS OBJECT → BUSINESS EVENT → COMMUNICATION ACTION,
 * with every supported channel visible inline on the action row. Grouping and
 * ordering come from governed catalogue metadata; template codes are never
 * parsed. Presentation only — all mutations stay in the parent page.
 */
import React from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { TemplateChannel } from "@/platform/omni-comms/application/templateCatalogueTypes";
import {
  CHANNEL_LABEL,
  CHANNEL_STATE_GLYPH,
  CHANNEL_STATE_LABEL,
  channelRow,
  scopeSourceLabel,
  summariseBusinessObject,
  type CatalogueAction,
  type TemplateBusinessCatalogue as Catalogue,
} from "@/platform/omni-comms/domain/templateBusinessCatalogue";

const STATE_CLASS: Record<string, string> = {
  published: "text-primary",
  approved: "text-primary/80",
  draft: "text-amber-600",
  retired: "text-destructive",
  missing: "text-muted-foreground",
};

const ChannelChips: React.FC<{
  action: CatalogueAction;
  onOpen: (action: CatalogueAction, channel: TemplateChannel) => void;
}> = ({ action, onOpen }) => (
  <div className="flex flex-wrap gap-1" data-testid={`action-channels-${action.code}`}>
    {channelRow(action).map(({ channel, state, variant }) => (
      <button
        key={channel}
        type="button"
        onClick={() => onOpen(action, channel)}
        data-testid={`channel-cell-${action.code}-${channel}`}
        data-state={state}
        title={`${CHANNEL_LABEL[channel]} — ${CHANNEL_STATE_LABEL[state]}`}
        className={cn(
          "inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs transition-colors hover:bg-muted",
          state === "missing" ? "border-dashed" : "border-border",
          STATE_CLASS[state],
        )}
      >
        <span aria-hidden="true">{CHANNEL_STATE_GLYPH[state]}</span>
        <span className="text-foreground">{CHANNEL_LABEL[channel]}</span>
        {variant?.version_number != null && (
          <span className="font-mono">v{variant.version_number}</span>
        )}
      </button>
    ))}
  </div>
);

const ActionBlock: React.FC<{
  action: CatalogueAction;
  onOpen: (action: CatalogueAction, channel: TemplateChannel) => void;
}> = ({ action, onOpen }) => (
  <div className="rounded-md border p-3 space-y-2" data-testid={`action-${action.code}`}>
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-sm font-medium">{action.name}</span>
      <Badge variant="outline" className="font-normal">
        {scopeSourceLabel(action.scope_type)}
      </Badge>
      <span className="font-mono text-[11px] text-muted-foreground">{action.code}</span>
    </div>
    <ChannelChips action={action} onOpen={onOpen} />
  </div>
);

export interface TemplateBusinessCatalogueProps {
  catalogue: Catalogue;
  loading?: boolean;
  onOpenChannel: (action: CatalogueAction, channel: TemplateChannel) => void;
}

export const TemplateBusinessCatalogueView: React.FC<TemplateBusinessCatalogueProps> = ({
  catalogue,
  loading,
  onOpenChannel,
}) => {
  const [collapsed, setCollapsed] = React.useState<Record<string, boolean>>({});
  const toggle = (key: string) =>
    setCollapsed((s) => ({ ...s, [key]: !s[key] }));

  if (loading) {
    return (
      <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">
        <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />Loading catalogue…
      </CardContent></Card>
    );
  }

  const empty = catalogue.modules.length === 0 && catalogue.shared.length === 0;
  if (empty) {
    return (
      <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">
        No communications match the current filters.
      </CardContent></Card>
    );
  }

  return (
    <div className="space-y-4" data-testid="template-business-catalogue">
      {catalogue.modules.map((m) => (
        <Card key={m.module_code} data-testid={`catalogue-module-${m.module_code}`}>
          <CardContent className="space-y-3 pt-4">
            <div className="flex items-center gap-2">
              <h2 className="text-base font-semibold">{m.module_name}</h2>
              <span className="font-mono text-[11px] text-muted-foreground">
                {m.module_code}
              </span>
            </div>

            {m.business_objects.map((b) => {
              const key = `${m.module_code}:${b.code}`;
              const isCollapsed = collapsed[key] ?? false;
              const s = summariseBusinessObject(b);
              return (
                <div key={key} className="rounded-md border" data-testid={`catalogue-object-${m.module_code}-${b.code}`}>
                  <Button
                    variant="ghost"
                    className="flex w-full items-center justify-between px-3 py-2"
                    onClick={() => toggle(key)}
                    data-testid={`catalogue-object-toggle-${b.code}`}
                  >
                    <span className="flex items-center gap-2">
                      {isCollapsed
                        ? <ChevronRight className="h-4 w-4" />
                        : <ChevronDown className="h-4 w-4" />}
                      <span className="font-medium">{b.name}</span>
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {s.events} events · {s.configured} configured · {s.incomplete} incomplete
                    </span>
                  </Button>

                  {!isCollapsed && (
                    <div className="space-y-3 border-t p-3">
                      {b.events.map((ev) => (
                        <div key={ev.id} className="space-y-2" data-testid={`catalogue-event-${ev.code}`}>
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-semibold">{ev.name}</span>
                            <span className="font-mono text-[11px] text-muted-foreground">
                              {ev.code}
                            </span>
                          </div>
                          {ev.actions.length === 0 ? (
                            <p className="text-xs text-muted-foreground">
                              No communication action configured for this event.
                            </p>
                          ) : (
                            ev.actions.map((a) => (
                              <ActionBlock key={a.id} action={a} onOpen={onOpenChannel} />
                            ))
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </CardContent>
        </Card>
      ))}

      {catalogue.shared.length > 0 && (
        <Card data-testid="catalogue-shared-group">
          <CardContent className="space-y-3 pt-4">
            <div>
              <h2 className="text-base font-semibold">Shared / General</h2>
              <p className="text-xs text-muted-foreground">
                Reusable organisation communications that belong to no single
                business event.
              </p>
            </div>
            {catalogue.shared.map((a) => (
              <ActionBlock key={a.id} action={a} onOpen={onOpenChannel} />
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default TemplateBusinessCatalogueView;
