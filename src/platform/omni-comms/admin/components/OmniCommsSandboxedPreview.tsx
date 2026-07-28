/**
 * OmniCommsSandboxedPreview — hardened iframe for rendered template HTML.
 *
 * Isolation contract:
 *  • Uses `srcdoc` (never `src`) so nothing hits the network.
 *  • `sandbox=""` — the empty string is the strictest possible policy:
 *    no scripts, no forms, no top-level navigation, no plugins, no popups,
 *    no same-origin, no pointer lock, no downloads, no modals.
 *  • `referrerPolicy="no-referrer"` — no header leakage.
 *  • Inline Content-Security-Policy blocks every remote resource class:
 *    scripts, styles, images, fonts, frames, objects, forms, connections,
 *    plugins. Images may only come from `data:` URIs.
 *  • `<base target="_self">` disables link navigation entirely because the
 *    sandbox forbids top-level navigation anyway.
 *
 * The parent application NEVER uses `dangerouslySetInnerHTML` for template
 * HTML. All template HTML flows through this iframe boundary.
 */
import React from "react";

export interface OmniCommsSandboxedPreviewProps {
  html: string;
  title?: string;
  className?: string;
  /** Fixed height so the iframe cannot grow to expose parent layout. */
  heightPx?: number;
  /** Optional test id for automated assertions. */
  testId?: string;
}

const RESTRICTIVE_CSP = [
  "default-src 'none'",
  "script-src 'none'",
  "style-src 'unsafe-inline'",
  "img-src data:",
  "font-src 'none'",
  "connect-src 'none'",
  "frame-src 'none'",
  "object-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
  "navigate-to 'none'",
  "child-src 'none'",
].join("; ");

function buildSrcDoc(html: string, title: string): string {
  // NOTE: `html` here is the template-rendered HTML from the approved
  // renderer. It is inserted verbatim inside the sandbox — no escaping
  // and no sanitisation happens here, because the sandbox + CSP is the
  // trust boundary. If the parent ever wants a SOURCE view, it must use
  // the escaped-source view rendered elsewhere in the page (never this
  // component).
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta http-equiv="Content-Security-Policy" content="${RESTRICTIVE_CSP}" />
    <meta name="referrer" content="no-referrer" />
    <title>${title.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string))}</title>
    <base target="_self" />
    <style>
      html, body { margin: 0; padding: 12px; font-family: system-ui, sans-serif; color: #111; background: #fff; }
      * { max-width: 100%; }
    </style>
  </head>
  <body>${html}</body>
</html>`;
}

export const OmniCommsSandboxedPreview: React.FC<OmniCommsSandboxedPreviewProps> = ({
  html,
  title = "Template preview",
  className,
  heightPx = 420,
  testId = "omni-comms-sandboxed-preview",
}) => {
  const srcDoc = React.useMemo(() => buildSrcDoc(html, title), [html, title]);
  return (
    <iframe
      data-testid={testId}
      title={title}
      // Empty string is the maximally restrictive sandbox policy.
      sandbox=""
      referrerPolicy="no-referrer"
      loading="lazy"
      srcDoc={srcDoc}
      className={className}
      style={{
        width: "100%",
        height: `${heightPx}px`,
        border: "1px solid hsl(var(--border))",
        borderRadius: 6,
        background: "#fff",
      }}
    />
  );
};

export default OmniCommsSandboxedPreview;
