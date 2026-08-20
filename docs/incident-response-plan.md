# Incident response plan

**Owner:** Byron Warner, Farvision LLC
**Scope:** any security incident touching Amazon Information, seller credentials, or the systems that hold them.
**Review cadence:** every 6 months. See [Review log](#review-log).

Written to be executed by one person under pressure, which is the realistic
condition. Every step names the console or command that performs it, because a
plan that says "revoke access" without saying where is a plan that gets skipped.

Attested to Amazon in the Solution Provider Profile: defined roles, six-month
reviews, and notification to `security@amazon.com` within 24 hours of detecting
an incident involving Amazon Information.

## What we hold, worst first

Ranked by what an attacker gains, not by volume. The response differs sharply
between rows.

| Asset                         | Where                                                    | Why it ranks here                                                                                                                                                                                                      |
| ----------------------------- | -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Seller LWA refresh tokens** | Couchbase `credentials_profiles`, KMS-wrapped            | The crown jewel. A usable refresh token is standing access to a seller's Amazon account — not a copy of their data, but the live account. Treat any suspected exposure as a full compromise of every connected seller. |
| **KMS credential key**        | AWS `alias/sellavant-<stage>-credentials`                | Unwraps every stored refresh token. Compromise of the key is compromise of all of them at once.                                                                                                                        |
| Amazon Information at rest    | Couchbase Capella (orders, reports, ledger, settlements) | Business data: SKUs, volumes, fees, payouts. Damaging to the seller commercially; not account access.                                                                                                                  |
| Auth0 tenant                  | `sellvant.us.auth0.com` (prod)                           | Controls who is a user of ours. Does not by itself unwrap credentials.                                                                                                                                                 |
| Media assets                  | S3 `sellavant-media-assets-prod-*`                       | Generated images and uploads. Lowest sensitivity.                                                                                                                                                                      |

**No buyer PII is stored.** `packages/sp-cache/src/lib/sp-cache.ts` discards
`BuyerInfo`, `ShippingAddress`, `BuyerTaxInfo` and `BuyerEmail` before anything
is persisted. This materially narrows the blast radius of a database incident
and is worth stating to any counterparty asking.

## Roles

One person holds all of these today. They are written separately because the
duties are separate, and because the plan must survive the company being larger
than one person.

| Role                    | Held by       | Owns                                                                                                      |
| ----------------------- | ------------- | --------------------------------------------------------------------------------------------------------- |
| **Incident Lead**       | Byron Warner  | Declares the incident, decides containment, owns the clock. Every other decision defers to this one.      |
| **Technical Responder** | Byron Warner  | Executes containment and recovery: revocation, rotation, deploys.                                         |
| **Communications**      | Byron Warner  | Notifies Amazon, affected sellers, and any other party owed disclosure.                                   |
| **Scribe**              | Incident Lead | Keeps the timeline as it happens. Reconstructing it afterwards is how the 24-hour notification is missed. |

If the Incident Lead is unreachable for 2 hours during a suspected credential
incident, **contain first and reconcile later**. Revoking tokens is recoverable;
an attacker holding them for an extra day is not.

## Severity

Severity decides the clock, so it is decided first and revised freely.

- **SEV-1 — credential or key exposure.** Refresh tokens, the KMS key, AWS
  credentials, Auth0 admin, Vercel production, or the GitHub deploy role.
  Assume seller accounts are reachable. Contain immediately.
- **SEV-2 — Amazon Information exposure.** Unauthorised read of stored orders,
  reports, settlements or ledger data without credential access.
- **SEV-3 — integrity or availability.** Data corrupted, a sync writing wrong
  values, or an outage. No unauthorised access.
- **SEV-4 — near miss.** A control failed but nothing was reached. Logged and
  reviewed; not notified.

**SEV-1 and SEV-2 are notifiable to Amazon.** SEV-3 and SEV-4 are not, unless
investigation reclassifies them — which happens often enough that the
reclassification decision belongs to the Incident Lead explicitly, not by
default.

## Detection

Where an incident is likely to first show itself:

- **CloudWatch alarms** on the Lambda stacks — errors, throttles, and the
  ads-sync state machine's execution-failed alarm.
- **`ops.cost_ledger` and `ops.spend_counters`** — an unexplained jump in paid
  calls is a plausible first sign of a stolen session, because the attacker
  spends our money before they exfiltrate anything.
- **Auth0 logs** — failed logins, new device or country for an existing user.
- **Sentry / Vercel logs** — repeated authorization failures against SP-API,
  which is what a revoked-or-stolen token looks like from our side.
- **Amazon** — a notice from Selling Partner Support or a seller reporting
  activity they did not perform.

Detection time is the start of the 24-hour clock. Record it precisely.

## Response

### 1. Declare and start the clock

Write down the UTC timestamp of detection and open a timeline file. Everything
else is reconstructable; the moment of detection is not.

### 2. Contain

**SEV-1, in this order.** Steps 1 and 2 protect sellers; step 3 protects us.

1. **Stop the bleeding at Amazon.** For each affected seller, revoke the
   authorization from the Solution Provider Portal, and instruct the seller to
   revoke ours in Seller Central → Apps & Services → Manage Your Apps. A refresh
   token that Amazon has revoked is inert regardless of who holds it.
2. **Rotate the KMS credential key** if the key itself or the database is
   suspect. `alias/sellavant-<stage>-credentials` survives key replacement, and
   KMS resolves the key from the ciphertext, so rotation needs no re-encrypt
   pass — this is fast, and it is the single most effective action available.
3. **Rotate the credentials that reach the data**: Auth0 client secret,
   Couchbase Capella user password (`scripts/couchbase-secret.sh`), Amazon LWA
   application secrets (`scripts/amazon-oauth-secret.sh`), the service principal
   (`scripts/auth0-service-principal-secret.sh`), and any Vercel token.
4. **Cut CI's path to AWS** if the GitHub deploy role is implicated: delete the
   deployment environment variable or the role's trust policy. The workstation
   path in `infra/aws/README.md` remains, deliberately, as the way back in.

**SEV-2:** revoke the specific access route, preserve logs before anything
rotates them out, and determine scope before notifying — but do not let scoping
push the notification past 24 hours. Partial information delivered on time beats
complete information delivered late.

### 3. Preserve evidence

Before rotating anything that also destroys its own audit trail, capture:
CloudWatch log groups for the window, Auth0 tenant logs, Vercel deployment and
function logs, and the relevant `ops.cost_ledger` rows. Note that report rows
expire at `REPORT_ROW_TTL_DAYS` and Auth0 log retention is finite — evidence
ages out on its own.

### 4. Notify

**Amazon, within 24 hours of detection, for SEV-1 and SEV-2.**
Email `security@amazon.com`, and open a case in the Solution Provider Portal.

Include: what happened, when it was detected, which Amazon Information was
involved, how many selling partners are affected, what has been contained, and
what remains outstanding. If scope is still unknown, say that explicitly rather
than delaying — an incomplete notification inside the window satisfies the
obligation; a complete one outside it does not.

**Affected sellers**, once containment means the notification cannot make things
worse. They need to know whether to revoke, whether to check their account, and
what we have already done.

**Others as applicable:** state breach-notification law where a seller is
located, and our own insurer.

### 5. Recover

Restore service only once the entry route is closed. Re-issue seller
authorizations through the normal connect flow — never by restoring old tokens
from a backup, which reinstates exactly the credential that was exposed.

### 6. Post-incident review

Within 5 business days, written and kept:

- Timeline from first access to containment.
- How it was detected, and how it _could_ have been detected sooner.
- What made containment slow.
- Fixes, each with an owner and a date.

The review is not optional for SEV-4. A near miss is a free incident, and it is
the cheapest one we will ever get.

## Review log

Reviewed every 6 months, and after any SEV-1 or SEV-2 regardless of schedule.
A review checks that: contacts and roles still exist, every named script and ARN
still resolves, and the asset table still describes what we actually hold.

| Date       | Reviewer     | Changes          |
| ---------- | ------------ | ---------------- |
| 2026-08-20 | Byron Warner | Initial version. |

**Next review due: 2027-02-20.**

## Related

- `docs/deployment-environment.md` — every credential, and where its value lives
- `docs/adr/0002-aws-account-topology.md` — account boundaries
- `infra/aws/README.md` — the workstation deploy path, which is the recovery
  route when CI's access is revoked
