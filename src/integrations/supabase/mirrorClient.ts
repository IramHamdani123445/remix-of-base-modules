// Mirror-mode backend client.
//
// This file is ONLY used when the app is started with `--mode mirror`
// (see vite.config.ts alias). In that mode every `@/integrations/supabase/client`
// import resolves here instead of the auto-generated client, so the whole
// application talks to the mirrored target Supabase project while the live
// Lovable Cloud project stays completely untouched.
//
// Nothing here changes normal `npm run dev` / `npm run build` behaviour.
import { createClient } from '@supabase/supabase-js';
import type { Database } from './types';
import { brokeredPreviewStorage } from './previewAuthStorage';

const MIRROR_URL = import.meta.env.VITE_MIRROR_SUPABASE_URL;
const MIRROR_KEY = import.meta.env.VITE_MIRROR_SUPABASE_PUBLISHABLE_KEY;

if (!MIRROR_URL || !MIRROR_KEY) {
  throw new Error(
    'Mirror mode is active but VITE_MIRROR_SUPABASE_URL / VITE_MIRROR_SUPABASE_PUBLISHABLE_KEY are not set. ' +
      'Copy .env.mirror.example to .env.mirror and fill in the target project values.',
  );
}

// Separate auth storage namespace so a mirror session never overwrites the
// session held for the live project (and vice versa).
export const supabase = createClient<Database>(MIRROR_URL, MIRROR_KEY, {
  auth: {
    storage: brokeredPreviewStorage(),
    storageKey: 'sb-mirror-auth-token',
    persistSession: true,
    autoRefreshToken: true,
  },
});

// Unmistakable visual marker so nobody confuses a mirror session with production.
if (typeof document !== 'undefined') {
  const mount = () => {
    if (document.getElementById('mirror-mode-banner')) return;
    const el = document.createElement('div');
    el.id = 'mirror-mode-banner';
    el.textContent = `MIRROR TEST BACKEND — ${new URL(MIRROR_URL).host}`;
    el.style.cssText = [
      'position:fixed',
      'bottom:0',
      'left:0',
      'right:0',
      'z-index:2147483647',
      'padding:4px 8px',
      'font:600 11px/1.4 ui-sans-serif,system-ui,sans-serif',
      'letter-spacing:0.08em',
      'text-align:center',
      'background:#7c2d12',
      'color:#fff7ed',
      'pointer-events:none',
    ].join(';');
    document.body.appendChild(el);
  };
  if (document.body) mount();
  else document.addEventListener('DOMContentLoaded', mount);
}
