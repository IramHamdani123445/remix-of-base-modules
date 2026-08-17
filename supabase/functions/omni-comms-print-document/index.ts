// Omni-Comms — secure Print document access.
//
// Purpose: an authorised operator can PREVIEW or OPEN & PRINT the exact
// immutable PDF archived for one `omni_comms_print_item`, without ever seeing
// a bucket name, a storage path or a permanent URL.
//
// Boundaries (permanent):
//   - Authorisation is decided SERVER-SIDE by the SECURITY DEFINER RPC
//     `omni_comms_print_document_access` running as the CALLER (tenant +
//     omni_comms view/operate capability + release control + physical state).
//   - The service role is used ONLY to mint a short-lived signed URL for the
//     path the RPC returned. It never widens who may read what.
//   - No Legal / lg_document_link authorisation is reused or weakened.
//   - The artefact served is the exact object whose checksum is recorded on
//     the Print Item; the checksum is returned so the client can display it.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

/** Signed URL lifetime — deliberately short. */
const SIGNED_URL_TTL_SECONDS = 180;

interface AccessRow {
  id: string;
  mode: string;
  letter_reference: string | null;
  bucket: string;
  path: string;
  checksum_sha256: string;
  byte_size: number | null;
  page_count: number | null;
  physical_status: string;
  version: number;
  attempt_id: string | null;
  attempt_count: number;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/** Maps a database exception into a stable Print error code. */
function errorCodeFrom(message: string): { code: string; status: number } {
  const known = [
    ["permission_denied", 403],
    ["authentication_required", 401],
    ["print_item_missing", 404],
    ["print_artefact_missing", 412],
    ["print_artefact_corrupt", 412],
    ["print_release_disabled", 412],
    ["print_item_held", 412],
    ["invalid_print_transition", 412],
    ["concurrent_update", 409],
    ["tenant_access_denied", 403],
    ["unknown_print_access_mode", 422],
  ] as const;
  for (const [code, status] of known) {
    if (message.includes(code)) return { code, status };
  }
  return { code: "print_access_failed", status: 400 };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  try {
    const authHeader = req.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return json({ ok: false, errorCode: "authentication_required" }, 401);
    }

    const body = await req.json().catch(() => ({}));
    const printItemId: string | undefined = body?.printItemId;
    const mode: string = body?.mode === "print" ? "print" : "preview";
    const expectedVersion: number | null =
      typeof body?.expectedVersion === "number" ? body.expectedVersion : null;

    if (!printItemId || typeof printItemId !== "string") {
      return json({ ok: false, errorCode: "print_item_missing" }, 400);
    }

    // 1. Authorise + (for `print`) open the governed physical attempt, as the caller.
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data, error } = await userClient.rpc(
      "omni_comms_print_document_access",
      {
        p_id: printItemId,
        p_mode: mode,
        p_expected_version: expectedVersion,
      },
    );
    if (error) {
      const mapped = errorCodeFrom(`${error.message} ${error.details ?? ""}`);
      return json(
        { ok: false, errorCode: mapped.code, detail: error.message },
        mapped.status,
      );
    }

    const access = data as AccessRow;

    // 2. Mint a short-lived signed URL for exactly that archived object.
    const admin = createClient(supabaseUrl, serviceKey);
    const signed = await admin.storage
      .from(access.bucket)
      .createSignedUrl(access.path, SIGNED_URL_TTL_SECONDS, {
        download: false,
      });

    if (signed.error || !signed.data?.signedUrl) {
      return json(
        {
          ok: false,
          errorCode: "print_artefact_missing",
          detail: signed.error?.message ?? "The archived PDF could not be opened.",
          printItem: {
            id: access.id,
            physicalStatus: access.physical_status,
            version: access.version,
          },
        },
        412,
      );
    }

    // 3. Also return the bytes inline (base64). Privacy/ad blockers commonly
    //    block direct storage object URLs in an iframe (ERR_BLOCKED_BY_CLIENT),
    //    which left operators with an empty preview. Inline bytes let the
    //    browser build a same-origin blob: URL with nothing to block.
    let inlineBase64: string | null = null;
    try {
      const download = await admin.storage.from(access.bucket).download(access.path);
      if (!download.error && download.data) {
        const buffer = new Uint8Array(await download.data.arrayBuffer());
        // 12 MB ceiling — beyond that the operator uses the signed link.
        if (buffer.byteLength <= 12 * 1024 * 1024) {
          let binary = "";
          const chunk = 0x8000;
          for (let i = 0; i < buffer.length; i += chunk) {
            binary += String.fromCharCode(...buffer.subarray(i, i + chunk));
          }
          inlineBase64 = btoa(binary);
        }
      }
    } catch (downloadError) {
      console.error("[omni-comms-print-document] inline download failed", downloadError);
    }

    return json({
      ok: true,
      mode: access.mode,
      url: signed.data.signedUrl,
      contentBase64: inlineBase64,
      contentType: "application/pdf",
      expiresInSeconds: SIGNED_URL_TTL_SECONDS,
      printItem: {
        id: access.id,
        letterReference: access.letter_reference,
        checksumSha256: access.checksum_sha256,
        byteSize: access.byte_size,
        pageCount: access.page_count,
        physicalStatus: access.physical_status,
        version: access.version,
        attemptId: access.attempt_id,
        attemptCount: access.attempt_count,
      },
    });
  } catch (err) {
    console.error("[omni-comms-print-document] unexpected failure", err);
    return json({ ok: false, errorCode: "print_access_failed" }, 500);
  }
});
