/**
 * Omni-Comms — template authoring domain helpers.
 *
 * Pure functions only: no React, no Supabase, no side effects. These describe
 * how each channel is authored by a business user (labelled fields instead of
 * raw JSON) and how the lifecycle of a version maps to an edit affordance.
 */
import {
  TEMPLATE_CHANNEL_KEYS,
  type TemplateChannel,
  type TemplateVersionStatus,
  type TemplateVersionListItem,
} from "../application/templateCatalogueTypes";

// ─── Channel authoring field specs ───────────────────────────────────────────

export type AuthoringFieldKind = "text" | "textarea" | "html";

export interface AuthoringFieldSpec {
  /** Content key persisted in the version JSON (server-validated). */
  key: string;
  label: string;
  kind: AuthoringFieldKind;
  required: boolean;
  help?: string;
  placeholder?: string;
}

/** Extra, non-content guidance rendered beside the editor for that channel. */
export interface ChannelAuthoringSpec {
  title: string;
  description: string;
  fields: AuthoringFieldSpec[];
  /** Presentation-owned aspects the author cannot type into the template. */
  presentationNotes: string[];
}

export const CHANNEL_AUTHORING: Record<TemplateChannel, ChannelAuthoringSpec> = {
  email: {
    title: "Email message",
    description: "Subject line, preview text and message body sent to the recipient.",
    fields: [
      { key: "subject", label: "Subject", kind: "text", required: true, placeholder: "Your claim {{claim.reference}} has been approved" },
      { key: "preheader", label: "Preheader", kind: "text", required: false, help: "Short preview text shown in the inbox list." },
      { key: "html", label: "Message body", kind: "html", required: false, help: "Rich body. Layout, letterhead and footer are added by the effective email layout." },
      { key: "text", label: "Plain text", kind: "textarea", required: false, help: "Fallback for clients that cannot show the rich body." },
    ],
    presentationNotes: [
      "Header, logo, footer and disclaimer come from the effective Email layout.",
      "Sender address and reply-to come from the channel configuration.",
    ],
  },
  print: {
    title: "Printed letter",
    description: "Formal correspondence produced as a PDF on the resolved letterhead.",
    fields: [
      { key: "subject", label: "Document title", kind: "text", required: true, placeholder: "Notice of claim decision" },
      { key: "html", label: "Formal letter body", kind: "html", required: false, help: "The body of the letter. Letterhead, signature block and footer are applied by the print layout." },
      { key: "text", label: "Plain text", kind: "textarea", required: false, help: "Accessible plain-text rendition retained with the archived document." },
    ],
    presentationNotes: [
      "Letterhead, signatory and footer resolve from Branding & Layouts (organisation → module → department → event).",
      "Page size, margins and address block belong to the letter layout, not the template.",
    ],
  },
  sms: {
    title: "SMS message",
    description: "One short text message. Keep it under two segments where possible.",
    fields: [
      { key: "body", label: "Message", kind: "textarea", required: true, placeholder: "SSB: your claim {{claim.reference}} was approved." },
    ],
    presentationNotes: ["Sender ID comes from the SMS channel configuration."],
  },
  whatsapp: {
    title: "WhatsApp message",
    description: "Conversational message with an optional header, media, footer and buttons.",
    fields: [
      { key: "header", label: "Header", kind: "text", required: false, help: "Optional short heading, up to 60 characters." },
      { key: "body", label: "Body", kind: "textarea", required: true, placeholder: "Your claim {{claim.reference}} has been approved." },
      { key: "footer", label: "Footer", kind: "text", required: false, help: "Optional small print, up to 60 characters." },
      { key: "media_url", label: "Media", kind: "text", required: false, help: "Secure https link to an image or document.", placeholder: "https://…" },
    ],
    presentationNotes: [
      "Buttons are authored below and travel with the message content.",
      "The sending business number comes from the WhatsApp channel configuration.",
      "Provider template registration and approval are managed separately from this content.",
    ],
  },
  in_app: {
    title: "In-app notification",
    description:
      "Notification delivered to the recipient's portal inbox, with an optional in-product action.",
    fields: [
      { key: "title", label: "Title", kind: "text", required: true, placeholder: "Claim {{claim.reference}} approved" },
      { key: "body", label: "Message", kind: "textarea", required: true },
      {
        key: "severity",
        label: "Severity",
        kind: "text",
        required: false,
        help: "info, success, warning or critical. Defaults to info.",
        placeholder: "info",
      },
      {
        key: "category",
        label: "Category",
        kind: "text",
        required: false,
        help: "Optional grouping label shown in the notification centre.",
      },
      {
        key: "action_label",
        label: "Action button label",
        kind: "text",
        required: false,
        help: "Shown only when an action link is supplied.",
        placeholder: "Open claim",
      },
      {
        key: "action_url",
        label: "Action link",
        kind: "text",
        required: false,
        help: "Must be an in-product path such as /benefits/claims/{{claim.id}}. External links are refused.",
        placeholder: "/benefits/claims/{{claim.id}}",
      },
    ],
    presentationNotes: [
      "Icon and colour are derived from the severity you choose.",
      "The action link always stays inside the portal; external destinations are rejected on save.",
    ],
  },
  push: {
    title: "Push notification",
    description: "Device push notification.",
    fields: [
      { key: "title", label: "Title", kind: "text", required: true },
      { key: "body", label: "Body", kind: "textarea", required: true },
    ],
    presentationNotes: [
      "Icon, image, category and deep link come from the push presentation profile.",
    ],
  },
};

/** Content object with every allowed key present (empty string when unset). */
export function normaliseContentForChannel(
  channel: TemplateChannel,
  content: Record<string, string> | null | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of TEMPLATE_CHANNEL_KEYS[channel].allowed) {
    out[key] = (content?.[key] ?? "") as string;
  }
  return out;
}

/** Drop blank optional keys so the server validator never sees empty noise. */
export function contentForSave(
  channel: TemplateChannel,
  content: Record<string, string>,
): Record<string, string> {
  const spec = TEMPLATE_CHANNEL_KEYS[channel];
  const out: Record<string, string> = {};
  for (const key of spec.allowed) {
    const value = content[key] ?? "";
    if (spec.required.includes(key) || value.trim().length > 0) out[key] = value;
  }
  return out;
}

export function missingRequiredFields(
  channel: TemplateChannel,
  content: Record<string, string>,
): string[] {
  return TEMPLATE_CHANNEL_KEYS[channel].required.filter(
    (k) => (content[k] ?? "").trim().length === 0,
  );
}

// ─── Lifecycle → edit affordance ─────────────────────────────────────────────

export type EditAffordance =
  | { kind: "edit_draft"; label: string }
  | { kind: "new_draft_from_published"; label: string }
  | { kind: "read_only"; label: string; reason: string };

export function editAffordanceFor(status: TemplateVersionStatus): EditAffordance {
  switch (status) {
    case "draft":
      return { kind: "edit_draft", label: "Continue editing" };
    case "published":
      return { kind: "new_draft_from_published", label: "Edit" };
    case "approved":
      return {
        kind: "read_only",
        label: "View content",
        reason: "Approved content is locked until it is published or returned to draft.",
      };
    default:
      return {
        kind: "read_only",
        label: "View content",
        reason: "Retired content is read-only.",
      };
  }
}

/** Versions for one channel + locale, newest first. */
export function versionsForChannelLocale(
  versions: TemplateVersionListItem[],
  channel: TemplateChannel,
  locale: string,
): TemplateVersionListItem[] {
  return versions
    .filter((v) => v.channel === channel && v.locale === locale)
    .sort((a, b) => b.version_number - a.version_number);
}

/** Distinct locales configured for a channel (always includes the default). */
export function localesForChannel(
  versions: TemplateVersionListItem[],
  channel: TemplateChannel,
  fallback = "en-US",
): string[] {
  const set = new Set(versions.filter((v) => v.channel === channel).map((v) => v.locale));
  if (set.size === 0) set.add(fallback);
  return [...set].sort();
}

// ─── SMS metrics ─────────────────────────────────────────────────────────────

const GSM7 =
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?" +
  "¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";
const GSM7_EXT = "^{}\\[~]|€";

export interface SmsMetrics {
  characters: number;
  encoding: "GSM-7" | "UCS-2";
  segments: number;
  charactersRemainingInSegment: number;
}

export function smsMetrics(body: string): SmsMetrics {
  const text = body ?? "";
  let gsm = true;
  let units = 0;
  for (const ch of text) {
    if (GSM7.includes(ch)) units += 1;
    else if (GSM7_EXT.includes(ch)) units += 2;
    else { gsm = false; break; }
  }
  if (!gsm) units = [...text].length;
  const single = gsm ? 160 : 70;
  const multi = gsm ? 153 : 67;
  const segments = units === 0 ? 0 : units <= single ? 1 : Math.ceil(units / multi);
  const capacity = segments <= 1 ? single : segments * multi;
  return {
    characters: units,
    encoding: gsm ? "GSM-7" : "UCS-2",
    segments,
    charactersRemainingInSegment: Math.max(0, capacity - units),
  };
}
