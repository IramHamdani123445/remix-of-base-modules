/**
 * CH-SIMPLE-P4 — Shared workspace context for Communication Hub Go-Live pages.
 *
 * One provider owns the module / event / channel selection for Operations,
 * Readiness, Revalidation and Audit. Selection is mirrored into the URL
 * (?module=…&event=…&channel=email) so direct URLs restore state and tab
 * switches keep the selection.
 *
 * This provider does NOT own the runtime contract — that stays on
 * `RuntimeContractProvider`, which is mounted once by the workspace layout
 * so tab switches trigger zero extra provider audits.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useSearchParams } from "react-router-dom";

export interface WorkspaceSelection {
  moduleCode: string;
  eventCode: string;
  channel: string;
}

interface WorkspaceContextValue extends WorkspaceSelection {
  hasSelection: boolean;
  setModuleCode: (m: string) => void;
  setEventCode: (e: string) => void;
  setChannel: (c: string) => void;
  setSelection: (s: Partial<WorkspaceSelection>) => void;
  clearSelection: () => void;
}

const Ctx = createContext<WorkspaceContextValue | undefined>(undefined);

const DEFAULT_CHANNEL = "email";

export function CommunicationHubWorkspaceProvider({ children }: { children: ReactNode }) {
  const [search, setSearch] = useSearchParams();
  const [moduleCode, setModuleCodeState] = useState<string>(search.get("module") ?? "");
  const [eventCode, setEventCodeState] = useState<string>(search.get("event") ?? "");
  const [channel, setChannelState] = useState<string>(search.get("channel") ?? DEFAULT_CHANNEL);

  // Sync state → URL (replace so it never bloats history).
  useEffect(() => {
    const next = new URLSearchParams(search);
    if (moduleCode) next.set("module", moduleCode); else next.delete("module");
    if (eventCode) next.set("event", eventCode); else next.delete("event");
    if (channel && channel !== DEFAULT_CHANNEL) next.set("channel", channel);
    else next.delete("channel");
    const nextStr = next.toString();
    const curStr = search.toString();
    if (nextStr !== curStr) {
      setSearch(next, { replace: true });
    }
    // We intentionally exclude `search` from deps to avoid feedback loops.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moduleCode, eventCode, channel, setSearch]);

  // Sync URL → state on external nav (browser back/forward, deep link).
  useEffect(() => {
    const urlModule = search.get("module") ?? "";
    const urlEvent = search.get("event") ?? "";
    const urlChannel = search.get("channel") ?? DEFAULT_CHANNEL;
    if (urlModule !== moduleCode) setModuleCodeState(urlModule);
    if (urlEvent !== eventCode) setEventCodeState(urlEvent);
    if (urlChannel !== channel) setChannelState(urlChannel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const setModuleCode = useCallback((m: string) => {
    setModuleCodeState(m);
    setEventCodeState("");
  }, []);

  const setEventCode = useCallback((e: string) => setEventCodeState(e), []);
  const setChannel = useCallback((c: string) => setChannelState(c || DEFAULT_CHANNEL), []);

  const setSelection = useCallback((s: Partial<WorkspaceSelection>) => {
    if (typeof s.moduleCode === "string") {
      setModuleCodeState(s.moduleCode);
      if (s.eventCode === undefined) setEventCodeState("");
    }
    if (typeof s.eventCode === "string") setEventCodeState(s.eventCode);
    if (typeof s.channel === "string") setChannelState(s.channel || DEFAULT_CHANNEL);
  }, []);

  const clearSelection = useCallback(() => {
    setModuleCodeState("");
    setEventCodeState("");
    setChannelState(DEFAULT_CHANNEL);
  }, []);

  const value = useMemo<WorkspaceContextValue>(() => ({
    moduleCode,
    eventCode,
    channel,
    hasSelection: !!moduleCode && !!eventCode,
    setModuleCode,
    setEventCode,
    setChannel,
    setSelection,
    clearSelection,
  }), [moduleCode, eventCode, channel, setModuleCode, setEventCode, setChannel, setSelection, clearSelection]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCommunicationHubWorkspace(): WorkspaceContextValue {
  const v = useContext(Ctx);
  if (!v) {
    throw new Error(
      "useCommunicationHubWorkspace must be used inside CommunicationHubWorkspaceProvider",
    );
  }
  return v;
}
