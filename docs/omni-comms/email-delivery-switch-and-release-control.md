# Omni-Comms — Enabling and Disabling Email Delivery (Release Control)

This is the complete operator procedure for turning automatic business Email
delivery ON and OFF, and for understanding what Release Control is and where it
lives.

---

## 1. What Release Control is

Release Control is the single governance record that decides whether Omni-Comms
is allowed to hand a rendered message to the email provider.

- One record per **organisation + channel** (today: `email`).
- It stores the delivery state, which business events may send, which caller
  modules may send, the volume limits, and the full approval history.
- Nothing in the platform can send email while this record is not `live`.
  Business modules, the runtime and the dispatcher all consult it.

### States

| State              | Meaning for the operator                                             |
| ------------------ | -------------------------------------------------------------------- |
| `configuration`    | Being set up. Never sends.                                             |
| `test_only`        | Configuration proven, safe tests only. Never sends business email.     |
| `controlled_pilot` | Historic limited-window pilot state. Superseded by the live switch.    |
| `live`             | ON. Configured business email is sent automatically.                   |
| `suspended`        | OFF. An operator turned delivery off. Queued work waits, nothing sends.|

Live has **no expiry**. Once ON it stays ON until someone turns it OFF or a
genuine safety gate invalidates it.

### Where to find it

- Normal operator surface (recommended):
  **Admin → Omnichannel Communications → Providers → Email → Delivery switch**
  (`/admin/omnichannel-communications/channels?channel=email`)
- Technical surface (read-only history, fingerprints, approvals):
  the **Release Control** panel on the same Channels page, reachable from
  *Technical details*.
- Evidence and queue outcomes:
  **Activity & Automation** (`/admin/omnichannel-communications/operations`).

---

## 2. Turning delivery ON (two people required)

Turning delivery on is a maker–checker action. The person who requests it can
never approve it. This is enforced in the database, not in the browser.

**Step 1 — Person A (any administrator with `omni_comms.configure` or
`omni_comms.operate`)**

1. Open **Providers → Email**.
2. Read the readiness indicators. Every one must be green:
   - Email provider account
   - Sender address and domain
   - Business events and letters
   - Automatic sending service
   - Delivery result tracking
   - Safety limits and approvals
3. Set the **Automatic Email delivery** switch to **ON**.
4. The card now shows *"Waiting for a second approver"*. Nothing has been sent.

**Step 2 — Person B (a different administrator)**

1. Open the same screen while signed in as a different user.
2. Set the switch to **ON**.
3. Because Person B is not the proposer, this click is recorded as the
   **approval** and the release becomes `live`.

The request expires after **24 hours** if no second person confirms it. After
that, Person A simply repeats Step 1.

**What happens immediately after ON**

- The automatic dispatcher's next tick claims any `held` job whose message is
  still `held`/`queued` — including messages that were queued while delivery
  was off.
- The chain becomes visible in **Activity & Automation → Email journeys**:
  business event → request → message → provider attempt → accepted → delivered
  callback.

---

## 3. Turning delivery OFF (one person)

Switching off is deliberately asymmetric: it needs only one administrator with
`omni_comms.operate`.

1. Open **Providers → Email**.
2. Set **Automatic Email delivery** to **OFF**.
3. The release moves to `suspended`, any pending proposal is cleared, and the
   event log records `release_suspended` with the actor and timestamp.

Nothing is deleted. Newly produced communications keep queueing as `held` and
will be delivered when delivery is switched on again.

---

## 4. If the switch will not turn on

The card lists bounded blocker codes in plain English. The most common:

| Code                                     | What to do                                                     |
| ---------------------------------------- | -------------------------------------------------------------- |
| `deployed_revision_unavailable`          | The runtime and dispatcher deployments disagree. Redeploy them so both report the same revision. |
| `provider_credentials_verified`          | Re-verify the provider sending key on the provider account.      |
| `sending_domain_verified`                | Complete DNS verification for the sending domain.                |
| `callback_endpoint_active`               | Switch on delivery-result tracking (webhook endpoint).           |
| `signed_delivery_callback_received`      | Run the technical test send and wait for the signed callback.    |
| `event_route_active` / `template_family_active` | Wire the business event to an active route with a published letter template. |
| `release_control_missing`                | No delivery rules exist yet for the organisation — run Setup.    |

---

## 5. Audit trail

Every transition writes an append-only row to `omni_comms_channel_release_event`
with the event type, from/to state, reason, actor and correlation id. The
Release Control panel renders this history. It cannot be edited or deleted.

---

## 6. Permissions

| Capability                       | Who needs it                              |
| -------------------------------- | ----------------------------------------- |
| `omni_comms.view`                | Open any Omni-Comms screen                 |
| `omni_comms.configure`           | Request delivery ON, change configuration  |
| `omni_comms.operate`             | Approve delivery ON, turn delivery OFF     |
| `omni_comms.manage_credentials`  | Provider keys and sender bindings          |
| `omni_comms.author_templates` / `approve_templates` | Letter content lifecycle |
| `omni_comms.view_sensitive_content` | Reveal masked recipients and rendered bodies |

These are granted through **App Modules → Omnichannel Communications** against a
role. Today all seven are granted to **Admin**.
