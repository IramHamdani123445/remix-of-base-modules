import { supabase } from '@/integrations/supabase/client';
import type { Session } from '@supabase/supabase-js';

/** Read persisted auth state without triggering auth-js refresh behaviour. */
export function getPersistedSessionSnapshot(): Session | null {
  if (typeof window === 'undefined') return null;
  try {
    const configuredKey = (supabase.auth as typeof supabase.auth & { storageKey?: string }).storageKey;
    const backendUrl = import.meta.env.VITE_SUPABASE_URL;
    const backendRef = backendUrl ? new URL(backendUrl).hostname.split('.')[0] : null;
    const storageKey = configuredKey ?? (backendRef ? `sb-${backendRef}-auth-token` : null);
    if (!storageKey) return null;
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Session | { currentSession?: Session; session?: Session };
    const candidate = 'access_token' in parsed
      ? parsed
      : parsed.currentSession ?? parsed.session ?? null;
    return candidate?.access_token ? candidate : null;
  } catch {
    return null;
  }
}