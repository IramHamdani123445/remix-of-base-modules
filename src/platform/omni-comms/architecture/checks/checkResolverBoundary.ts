/**
 * Rule 11 — OMNI_RESOLVER_RUNTIME_BOUNDARY.
 *
 * The Slice 2c-ii Batch B resolver package lives under
 *   supabase/functions/omni-comms-runtime/resolution/**
 * and is the ONLY authorised location for those modules. Their internal
 * runtime types (AggregateSnapshot, RuntimeResolutionResult, ChannelResolution,
 * etc.) must never leak into React/browser code, business modules, or the
 * publisher-facing service layer.
 *
 * Rule scope (Batch C hardening):
 *  - No file under src/ may import from
 *    supabase/functions/omni-comms-runtime/resolution.
 *  - No file under src/ may re-export the internal runtime symbols.
 *  - The browser transport must not call the SECURITY DEFINER RPCs
 *    omni_comms_priv_runtime_resolution_snapshot,
 *    omni_comms_priv_finalize_resolution,
 *    omni_comms_priv_load_persisted_resolution,
 *    omni_comms_priv_next_event_sequence, or
 *    omni_comms_priv_send_communication directly.
 *  - No file under src/ may read comm_asset_assignment directly; the
 *    canonical shared-assets RPCs are the only supported surface.
 *  - The resolution package may NOT import provider SDK packages —
 *    resolution is inputs-only, providers live behind adapters.
 *  - The resolution package may NOT insert/update/upsert/delete on the
 *    Slice 1 delivery runtime tables (message, dispatch_job,
 *    delivery_attempt); those belong to the send/dispatch spine.
 *  - Files under src/ (outside adapters/providers/**) may NOT construct a
 *    Supabase client using a service-role key — the trusted runtime is
 *    Edge-Function-only.
 */
import type {
  ArchitectureViolation,
  RepositoryScan,
} from '../architectureCheck.types';
import { isRuleMetadataFile } from '../architecturePolicy';

const RESOLVER_IMPORT_RE =
  /from\s+['"](?:[^'"]*\/)?supabase\/functions\/omni-comms-runtime\/resolution(?:\/[^'"]*)?['"]/g;

/** Slice 2c-iii: the rendering package is equally Edge-Function-only. */
const RENDERING_IMPORT_RE =
  /from\s+['"](?:[^'"]*\/)?supabase\/functions\/omni-comms-runtime\/rendering(?:\/[^'"]*)?['"]/g;

const FORBIDDEN_RPC_NAMES = [
  'omni_comms_priv_runtime_resolution_snapshot',
  'omni_comms_priv_finalize_resolution',
  'omni_comms_priv_load_persisted_resolution',
  'omni_comms_priv_next_event_sequence',
  'omni_comms_priv_send_communication',
  // Slice 2c-iii trusted rendering RPCs (service_role only).
  'omni_comms_priv_load_render_context',
  'omni_comms_priv_persist_rendered_messages',
];

/** Direct-read-forbidden shared surfaces (must go through shared RPCs). */
const FORBIDDEN_DIRECT_READ_TABLES = [
  'comm_asset_assignment',
];

/** Delivery-spine tables the resolution package must never mutate. */
const FORBIDDEN_RESOLUTION_WRITE_TABLES = [
  'omni_comms_message',
  'omni_comms_dispatch_job',
  'omni_comms_delivery_attempt',
];

/** Provider SDKs the resolution package must never import. */
const RESOLUTION_FORBIDDEN_PROVIDER_SDKS = [
  'resend', '@resend', 'twilio', '@twilio', 'nodemailer',
  '@sendgrid', 'firebase-admin', 'whatsapp-web.js',
];

/**
 * Slice 2c-iii determinism guards. The rendering package is a pure function of
 * persisted snapshots: no clock, no randomness, no I/O, no database access.
 */
const RENDERING_FORBIDDEN_PATTERNS: Array<{ re: RegExp; message: string }> = [
  { re: /\bDate\s*\.\s*now\s*\(/g, message: 'Date.now() is non-deterministic.' },
  { re: /\bnew\s+Date\s*\(/g, message: 'new Date() is non-deterministic.' },
  { re: /\bMath\s*\.\s*random\s*\(/g, message: 'Math.random() is non-deterministic.' },
  { re: /\bcrypto\s*\.\s*randomUUID\s*\(/g, message: 'crypto.randomUUID() is non-deterministic.' },
  { re: /(?<![.\w])fetch\s*\(/g, message: 'Network access is forbidden during rendering.' },
  { re: /\.rpc\s*\(/g, message: 'Database access is forbidden inside the rendering package.' },
  { re: /\.from\s*\(\s*['"`]/g, message: 'Database access is forbidden inside the rendering package.' },
  { re: /\bcreateClient\s*\(/g, message: 'Supabase clients are forbidden inside the rendering package.' },
];

const MUTATORS = ['insert', 'update', 'upsert', 'delete'];


function isBrowserOrServiceFile(filePath: string): boolean {
  const p = filePath.replace(/\\/g, '/');
  return p.startsWith('src/') && !p.startsWith('src/__tests__/');
}

function isInResolutionPackage(filePath: string): boolean {
  return filePath.replace(/\\/g, '/').includes(
    'supabase/functions/omni-comms-runtime/resolution/',
  );
}

function isInRenderingPackage(filePath: string): boolean {
  return filePath.replace(/\\/g, '/').includes(
    'supabase/functions/omni-comms-runtime/rendering/',
  );
}

function isInProviderAdapterRoot(filePath: string): boolean {
  return filePath
    .replace(/\\/g, '/')
    .startsWith('src/platform/omni-comms/adapters/providers/');
}

export function checkResolverBoundary(scan: RepositoryScan): ArchitectureViolation[] {
  const out: ArchitectureViolation[] = [];
  for (const f of scan.files) {
    if (isRuleMetadataFile(f.filePath)) continue;
    if (!/\.(ts|tsx|js|jsx)$/.test(f.filePath)) continue;

    // ─── src/** boundary checks ────────────────────────────────────────
    if (isBrowserOrServiceFile(f.filePath)) {
      // (a) imports of the resolver package
      let m: RegExpExecArray | null;
      RESOLVER_IMPORT_RE.lastIndex = 0;
      while ((m = RESOLVER_IMPORT_RE.exec(f.content)) !== null) {
        out.push({
          ruleId: 'OMNI_RESOLVER_RUNTIME_BOUNDARY',
          severity: 'error',
          filePath: f.filePath,
          evidence: m[0],
          message: 'src/** may not import the omni-comms-runtime resolution package.',
          remediation:
            'The resolver modules are Edge-Function-only. Call the trusted omni-comms-runtime Edge Function through the canonical façade instead.',
          baselineStatus: 'not_baselined',
        });
      }

      // (a2) imports of the Slice 2c-iii rendering package
      let rmi: RegExpExecArray | null;
      RENDERING_IMPORT_RE.lastIndex = 0;
      while ((rmi = RENDERING_IMPORT_RE.exec(f.content)) !== null) {
        out.push({
          ruleId: 'OMNI_RESOLVER_RUNTIME_BOUNDARY',
          severity: 'error',
          filePath: f.filePath,
          evidence: rmi[0],
          message: 'src/** may not import the omni-comms-runtime rendering package.',
          remediation:
            'The rendering modules are Edge-Function-only. Call the trusted omni-comms-runtime Edge Function through the canonical façade instead.',
          baselineStatus: 'not_baselined',
        });
      }



      // (b) direct .rpc(...) to service_role-only RPCs
      for (const rpc of FORBIDDEN_RPC_NAMES) {
        const rpcRe = new RegExp(
          String.raw`\.rpc\s*\(\s*['"\`]${rpc}['"\`]`,
          'g',
        );
        let rm: RegExpExecArray | null;
        while ((rm = rpcRe.exec(f.content)) !== null) {
          out.push({
            ruleId: 'OMNI_RESOLVER_RUNTIME_BOUNDARY',
            severity: 'error',
            filePath: f.filePath,
            evidence: rm[0],
            message: `Browser/service code may not call service_role-only RPC "${rpc}" directly.`,
            remediation:
              'Route through the omni-comms-runtime Edge Function via the canonical façade.',
            baselineStatus: 'not_baselined',
          });
        }
      }

      // (c) direct reads of forbidden shared surfaces (new-system scope only —
      //     the enterprise-wide readers outside src/platform/omni-comms/** are
      //     part of the wider Legacy shared-assets pipeline governed elsewhere).
      if (f.filePath.replace(/\\/g, '/').startsWith('src/platform/omni-comms/')) {
        for (const table of FORBIDDEN_DIRECT_READ_TABLES) {
          const re = new RegExp(
            String.raw`\.from\s*\(\s*['"\`]${table}['"\`]\s*\)`,
            'g',
          );
          let tm: RegExpExecArray | null;
          while ((tm = re.exec(f.content)) !== null) {
            out.push({
              ruleId: 'OMNI_RESOLVER_RUNTIME_BOUNDARY',
              severity: 'error',
              filePath: f.filePath,
              evidence: tm[0],
              message: `src/platform/omni-comms/** may not read shared-surface table "${table}" directly.`,
              remediation:
                'Use the canonical shared-assets RPCs (omni_comms_assignment_*).',
              baselineStatus: 'not_baselined',
            });
          }
        }
      }

      // (d) service-role client construction outside adapter root
      if (!isInProviderAdapterRoot(f.filePath)) {
        const srRe =
          /createClient\s*\([^)]*(?:SERVICE_ROLE|service_role|serviceRole)[^)]*\)/g;
        let sm: RegExpExecArray | null;
        while ((sm = srRe.exec(f.content)) !== null) {
          out.push({
            ruleId: 'OMNI_RESOLVER_RUNTIME_BOUNDARY',
            severity: 'error',
            filePath: f.filePath,
            evidence: sm[0].slice(0, 120),
            message:
              'Service-role Supabase clients are permitted only inside the trusted Edge Function boundary.',
            remediation:
              'Remove the service-role client from src/**. Use the trusted runtime Edge Function instead.',
            baselineStatus: 'not_baselined',
          });
        }
      }
    }

    // ─── resolution package internal checks ───────────────────────────
    if (isInResolutionPackage(f.filePath)) {
      // (e) provider SDK imports
      for (const pkg of RESOLUTION_FORBIDDEN_PROVIDER_SDKS) {
        const pkgRe = new RegExp(
          String.raw`from\s+['"]${pkg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:\/[^'"]*)?['"]`,
          'g',
        );
        let pm: RegExpExecArray | null;
        while ((pm = pkgRe.exec(f.content)) !== null) {
          out.push({
            ruleId: 'OMNI_RESOLVER_RUNTIME_BOUNDARY',
            severity: 'error',
            filePath: f.filePath,
            evidence: pm[0],
            message: `Provider SDK "${pkg}" may not be imported inside the resolution package.`,
            remediation:
              'Resolution is inputs-only; provider SDKs must live behind adapters/providers/**.',
            baselineStatus: 'not_baselined',
          });
        }
      }

      // (f) delivery-spine writes
      for (const table of FORBIDDEN_RESOLUTION_WRITE_TABLES) {
        for (const mut of MUTATORS) {
          const wre = new RegExp(
            String.raw`\.from\s*\(\s*['"\`]${table}['"\`]\s*\)[^;]{0,200}\.${mut}\s*\(`,
            'g',
          );
          let wm: RegExpExecArray | null;
          while ((wm = wre.exec(f.content)) !== null) {
            out.push({
              ruleId: 'OMNI_RESOLVER_RUNTIME_BOUNDARY',
              severity: 'error',
              filePath: f.filePath,
              evidence: wm[0].slice(0, 120),
              message: `Resolution package must not ${mut} delivery-spine table "${table}".`,
              remediation:
                'The resolution pipeline is read/resolve only. Delivery writes belong to the send/dispatch spine.',
              baselineStatus: 'not_baselined',
            });
          }
        }
      }
    }

    // ─── rendering package internal checks (Slice 2c-iii) ─────────────
    if (isInRenderingPackage(f.filePath)) {
      // (g) provider SDK imports
      for (const pkg of RESOLUTION_FORBIDDEN_PROVIDER_SDKS) {
        const pkgRe = new RegExp(
          String.raw`from\s+['"]${pkg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:\/[^'"]*)?['"]`,
          'g',
        );
        let gm: RegExpExecArray | null;
        while ((gm = pkgRe.exec(f.content)) !== null) {
          out.push({
            ruleId: 'OMNI_RESOLVER_RUNTIME_BOUNDARY',
            severity: 'error',
            filePath: f.filePath,
            evidence: gm[0],
            message: `Provider SDK "${pkg}" may not be imported inside the rendering package.`,
            remediation:
              'Rendering is snapshot-in / string-out. Provider SDKs must live behind adapters/providers/**.',
            baselineStatus: 'not_baselined',
          });
        }
      }

      // (h) determinism + no-I/O guards
      for (const guard of RENDERING_FORBIDDEN_PATTERNS) {
        guard.re.lastIndex = 0;
        let hm: RegExpExecArray | null;
        while ((hm = guard.re.exec(f.content)) !== null) {
          out.push({
            ruleId: 'OMNI_RESOLVER_RUNTIME_BOUNDARY',
            severity: 'error',
            filePath: f.filePath,
            evidence: hm[0].slice(0, 120),
            message: `Rendering package determinism violation: ${guard.message}`,
            remediation:
              'The rendering package must be a pure function of persisted snapshots. Move clocks, randomness and I/O to the orchestrating Edge Function boundary.',
            baselineStatus: 'not_baselined',
          });
        }
      }
    }
  }
  return out;
}
