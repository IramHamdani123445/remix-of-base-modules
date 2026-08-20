/**
 * Omni-Comms C5A.1 — typed technical test-content forms.
 *
 * There is deliberately NO raw JSON editor. Each channel renders typed
 * fields, and the bounded payload object is built here before the existing
 * preflight service is called. Server-side payload validation is unchanged
 * and remains authoritative.
 *
 * Pure presentation: no provider SDK, no send facade, no network call.
 */
import React from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Field } from './channelFormPrimitives';
import type { TestCentreChannel } from '@/platform/omni-comms/application/channelTestCentreTypes';

export const WHATSAPP_MAX_SAMPLE_VARIABLES = 20;

/** Typed, channel-specific form state. */
export interface TestContentForm {
  subject: string;
  body: string;
  text: string;
  templateCode: string;
  languageCode: string;
  variables: string[];
  title: string;
  deepLink: string;
  documentTitle: string;
  sampleText: string;
}

export function defaultTestContentForm(_channel: TestCentreChannel): TestContentForm {
  return {
    subject: 'Configuration preflight',
    body: 'Technical configuration preflight only. No message is sent.',
    text: 'Technical configuration preflight only.',
    templateCode: 'preflight_check',
    languageCode: 'en',
    variables: [],
    title: 'Configuration preflight',
    deepLink: '',
    documentTitle: 'Configuration preflight',
    sampleText: 'Technical configuration preflight only.',
  };
}


/**
 * Builds the bounded payload object accepted by the preflight RPC. Only keys
 * allowed for the channel are emitted.
 */
export function buildTestPayload(
  channel: TestCentreChannel,
  f: TestContentForm,
): Record<string, unknown> {
  switch (channel) {
    case 'email':
      return { subject: f.subject, body: f.body };
    case 'sms':
      return { text: f.text };
    case 'whatsapp':
      // Session (free-form) message. The technical test centre sends exactly the
      // content that passed the preflight, so the same shape is used end to end.
      return { text: f.text };

    case 'push':
      return { title: f.title, body: f.body };
    case 'in_app':
      return f.deepLink.trim().length > 0
        ? { title: f.title, body: f.body, deep_link: f.deepLink.trim() }
        : { title: f.title, body: f.body };
    case 'print':
    default:
      return { document_title: f.documentTitle, sample_text: f.sampleText };
  }
}

const TextAreaField: React.FC<{
  label: string;
  value: string;
  onChange: (v: string) => void;
  rows?: number;
  testId: string;
}> = ({ label, value, onChange, rows = 4, testId }) => (
  <div className="space-y-1">
    <Label>{label}</Label>
    <Textarea
      rows={rows}
      value={value}
      data-testid={testId}
      onChange={(e) => onChange(e.target.value)}
    />
  </div>
);

export const TestContentFields: React.FC<{
  channel: TestCentreChannel;
  value: TestContentForm;
  onChange: (next: TestContentForm) => void;
}> = ({ channel, value, onChange }) => {
  const set = (patch: Partial<TestContentForm>) => onChange({ ...value, ...patch });

  if (channel === 'email') {
    return (
      <div className="space-y-3" data-testid="omni-comms-test-content-email">
        <Field label="Subject" value={value.subject} onChange={(v) => set({ subject: v })} />
        <TextAreaField
          label="Plain-text body"
          value={value.body}
          onChange={(v) => set({ body: v })}
          rows={5}
          testId="omni-comms-test-content-email-body"
        />
      </div>
    );
  }
  if (channel === 'sms') {
    return (
      <div className="space-y-3" data-testid="omni-comms-test-content-sms">
        <TextAreaField
          label="Message text"
          value={value.text}
          onChange={(v) => set({ text: v })}
          rows={4}
          testId="omni-comms-test-content-sms-text"
        />
      </div>
    );
  }
  if (channel === 'whatsapp') {
    return (
      <div className="space-y-3" data-testid="omni-comms-test-content-whatsapp">
        <TextAreaField
          label="Message text"
          value={value.text}
          onChange={(v) => set({ text: v })}
          rows={4}
          testId="omni-comms-test-content-whatsapp-text"
        />
        <p className="text-xs text-muted-foreground">
          Technical session message. The recipient must have an open WhatsApp session
          with the sender; approved provider templates are used for business sending.
        </p>
      </div>
    );
  }

  if (channel === 'push') {
    return (
      <div className="space-y-3" data-testid="omni-comms-test-content-push">
        <Field label="Title" value={value.title} onChange={(v) => set({ title: v })} />
        <TextAreaField
          label="Body"
          value={value.body}
          onChange={(v) => set({ body: v })}
          testId="omni-comms-test-content-push-body"
        />
      </div>
    );
  }
  if (channel === 'in_app') {
    return (
      <div className="space-y-3" data-testid="omni-comms-test-content-in_app">
        <Field label="Title" value={value.title} onChange={(v) => set({ title: v })} />
        <TextAreaField
          label="Body"
          value={value.body}
          onChange={(v) => set({ body: v })}
          testId="omni-comms-test-content-in_app-body"
        />
        <Field
          label="Deep-link reference (optional)"
          value={value.deepLink}
          onChange={(v) => set({ deepLink: v })}
          placeholder="Optional in-product reference"
        />
      </div>
    );
  }
  return (
    <div className="space-y-3" data-testid="omni-comms-test-content-print">
      <Field
        label="Document title"
        value={value.documentTitle}
        onChange={(v) => set({ documentTitle: v })}
      />
      <TextAreaField
        label="Sample text"
        value={value.sampleText}
        onChange={(v) => set({ sampleText: v })}
        rows={5}
        testId="omni-comms-test-content-print-sample"
      />
    </div>
  );
};

export default TestContentFields;
