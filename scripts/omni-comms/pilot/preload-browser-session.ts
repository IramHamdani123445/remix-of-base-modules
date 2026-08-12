/**
 * Omni-Comms Benefits pilot runner — preload shim.
 *
 * Gives the real application modules the minimal browser surface they expect
 * (localStorage seeded with the operator's Supabase session) so the canonical
 * Benefits claim-intake service and the Omni-Comms producer can be executed
 * exactly as deployed. It contacts no provider and sends nothing.
 */
const store = new Map<string, string>();

const localStoragePolyfill = {
  getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
  setItem: (k: string, v: string) => void store.set(k, String(v)),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
  key: (i: number) => Array.from(store.keys())[i] ?? null,
  get length() {
    return store.size;
  },
};

const key = process.env.LOVABLE_BROWSER_SUPABASE_STORAGE_KEY;
const session = process.env.LOVABLE_BROWSER_SUPABASE_SESSION_JSON;
if (key && session) store.set(key, session);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).localStorage = localStoragePolyfill;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).window = (globalThis as any).window ?? {
  localStorage: localStoragePolyfill,
  location: { origin: 'http://localhost:8080', href: 'http://localhost:8080/' },
};
