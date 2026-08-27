import { Suspense, lazy } from 'react';
import { BrowserRouter as Router } from 'react-router-dom';
import { QueryClient, QueryClientProvider, MutationCache, QueryCache } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { Toaster } from '@/components/ui/toaster';
import { Toaster as SonnerToaster } from '@/components/ui/sonner';
import { AuthProvider } from '@/contexts/AuthContext';
import { NewBenefitAuthProvider } from '@/contexts/NewBenefitAuthContext';
import { LegalAuthProvider } from '@/contexts/LegalAuthContext';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { GlobalBlockingProvider } from '@/contexts/GlobalBlockingContext';
import { BlockingOverlay } from '@/components/ui/BlockingOverlay';
import { LegalCaseProvider } from '@/contexts/LegalCaseContext';
import { LegalRoleProvider } from '@/contexts/LegalRoleContext';
import { SupabaseAuthProvider } from '@/contexts/SupabaseAuthContext';
import { SystemLoggingProvider } from '@/providers/SystemLoggingProvider';
import { SystemSettingsProvider } from '@/contexts/SystemSettingsContext';
import { SecurityPolicyProvider } from '@/contexts/SecurityPolicyContext';
import { PIIMaskingProvider } from '@/contexts/PIIMaskingContext';
import { PIIUnlockDialog } from '@/components/security/PIIUnlockDialog';
import ErrorBoundary from '@/components/ErrorBoundary';
import { setupGlobalErrorHandlers, logApplicationError } from '@/lib/globalErrorHandler';
import { IPAccessGate } from '@/components/security/IPAccessGate';
import { logAuditEntry, parseMutationKey, extractEntityId, clearAuditUserCache, inferEntityTypeFromVariables, resolveRouteContext, classifyActionFromVariables } from '@/services/globalAuditInterceptor';
import { supabase } from '@/integrations/supabase/client';
import { BenefitsQueryLifecycle } from '@/components/bn/BenefitsQueryLifecycle';


// Lightweight router shell: renders public/auth routes immediately and
// only lazy-loads the large protected route graph for non-public paths.
const PublicRoutes = lazy(() =>
  import('@/components/routing/PublicRoutes').then((m) => ({ default: m.PublicRoutes }))
);

const RoutesFallback = () => (
  <div className="min-h-screen flex items-center justify-center bg-background">
    <div className="text-center space-y-4">
      <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto" />
      <p className="text-muted-foreground text-sm">Loading…</p>
    </div>
  </div>
);
import './App.css';

// Setup global window error handlers
setupGlobalErrorHandlers();

// Clear audit cache on auth state change
supabase.auth.onAuthStateChange(() => {
  clearAuditUserCache();
});

// Create QueryClient with global error logging AND automatic audit trail for all mutations
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Navigation should feel instant — cached data is shown immediately;
      // background refetch only when truly stale.
      staleTime: 60_000,           // 1 min default freshness
      gcTime: 10 * 60_000,         // keep cached data 10 min after unmount
      refetchOnWindowFocus: false, // do not reload everything when user switches tabs
      refetchOnReconnect: false,   // do not reload everything on network blip
      refetchOnMount: false,       // re-render uses cache; explicit invalidation refetches
      // Retrying broad reads during a backend slowdown amplifies connection
      // pressure and can starve authentication. Mutations already never retry.
      retry: (failureCount, error) => {
        const status = Number((error as { status?: unknown } | null)?.status ?? 0);
        return failureCount < 1 && status !== 401 && status !== 403;
      },
      retryDelay: 2_000,
    },
    mutations: {
      retry: 0,
    },
  },
  mutationCache: new MutationCache({
    onSuccess: (data, variables, _context, mutation) => {
      // Skip logging for audit-internal or system_audit_trail writes to avoid loops
      const keyStr = mutation.options.mutationKey?.map(String).join('/') || '';
      if (keyStr.includes('audit') || keyStr.includes('system_log')) return;

      const parsed = parseMutationKey(mutation.options.mutationKey);
      const entityId = extractEntityId(variables);
      const route = typeof window !== 'undefined' ? window.location.pathname : undefined;

      // Resolve entity type: explicit key > variable inference > route default
      const routeCtx = route ? resolveRouteContext(route) : undefined;
      const entityType = parsed.entityType
        || inferEntityTypeFromVariables(variables)
        || routeCtx?.entityType;

      // Smart action classification when mutationKey is missing
      const action = parsed.action !== 'mutation'
        ? parsed.action
        : classifyActionFromVariables(variables, data);

      // Extract beforeValue from variables if present; strip internal fields from afterValue
      const rawVars = variables && typeof variables === 'object' ? variables as Record<string, any> : {};
      const beforeValue = rawVars.oldValues || rawVars.beforeValue || null;

      const INTERNAL_FIELDS = new Set([
        'oldValues', 'beforeValue', 'userCode', 'userName', 'user_code', 'user_name',
        'slabId', 'slab_id', 'oldValue', 'newValue', 'id',
      ]);
      const cleanAfter: Record<string, any> = {};
      for (const [k, v] of Object.entries(rawVars)) {
        if (!INTERNAL_FIELDS.has(k)) cleanAfter[k] = v;
      }

      // Fire-and-forget audit log — never blocks the UI
      logAuditEntry({
        action,
        entityType,
        entityId,
        module: parsed.module || routeCtx?.module,
        route,
        beforeValue,
        afterValue: Object.keys(cleanAfter).length > 0 ? cleanAfter : undefined,
        metadata: {
          source: 'MutationCache_global',
          mutationKey: mutation.options.mutationKey?.map(String),
        },
      });
    },
    onError: (error, variables, _context, mutation) => {
      logApplicationError(error, {
        module: 'MUTATION',
        action: mutation.options.mutationKey?.join('/') || 'unknown_mutation',
      });
      const keyStr = mutation.options.mutationKey?.map(String).join('/') || '';
      if (keyStr.includes('audit') || keyStr.includes('system_log')) return;

      const parsed = parseMutationKey(mutation.options.mutationKey);
      const entityId = extractEntityId(variables);
      const errRoute = typeof window !== 'undefined' ? window.location.pathname : undefined;
      const errRouteCtx = errRoute ? resolveRouteContext(errRoute) : undefined;
      const errEntityType = parsed.entityType
        || inferEntityTypeFromVariables(variables)
        || errRouteCtx?.entityType;

      const errAction = parsed.action !== 'mutation'
        ? `${parsed.action}_failed`
        : `${classifyActionFromVariables(variables, undefined)}_failed`;

      logAuditEntry({
        action: errAction,
        entityType: errEntityType,
        entityId,
        module: parsed.module || errRouteCtx?.module,
        route: errRoute,
        metadata: {
          source: 'MutationCache_global',
          error: error instanceof Error ? error.message : String(error),
          mutationKey: mutation.options.mutationKey?.map(String),
        },
      });
    },
  }),
  queryCache: new QueryCache({
    onError: (error, query) => {
      logApplicationError(error, {
        module: 'QUERY',
        action: query.queryKey?.join('/') || 'unknown_query',
      });
    },
  }),
});

function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <GlobalBlockingProvider>
          <SupabaseAuthProvider>
            <BenefitsQueryLifecycle />
            <IPAccessGate>

              <SystemSettingsProvider>
                <AuthProvider>
                  <NewBenefitAuthProvider>
                    <LegalAuthProvider>
                      <LegalCaseProvider>
                        <Router>
                          <SecurityPolicyProvider>
                            <PIIMaskingProvider>
                              <SystemLoggingProvider>
                                <div className="min-h-screen bg-background">
                                  <Suspense fallback={<RoutesFallback />}>
                                    <PublicRoutes />
                                  </Suspense>
                                  <Toaster />
                                  <SonnerToaster />
                                  <PIIUnlockDialog />
                                  <BlockingOverlay />
                                </div>
                              </SystemLoggingProvider>
                            </PIIMaskingProvider>
                          </SecurityPolicyProvider>
                        </Router>
                      </LegalCaseProvider>
                    </LegalAuthProvider>
                  </NewBenefitAuthProvider>
                </AuthProvider>
              </SystemSettingsProvider>
            </IPAccessGate>
          </SupabaseAuthProvider>
          </GlobalBlockingProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

export default App;
