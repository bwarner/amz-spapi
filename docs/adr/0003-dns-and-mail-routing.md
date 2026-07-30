# ADR-0003: Move DNS to Route 53, and split mail by name

- **Status:** Proposed
- **Date:** 2026-07-30
- **Deciders:** Byron Warner
- **Epic:** [#51](https://github.com/bwarner/amz-spapi/issues/51)
- **Depends on:** [ADR-0002](0002-aws-account-topology.md)

## Context

Verified 2026-07-30:

- `sellavant.com` is registered with **Cloudflare Registrar** and served by
  Cloudflare nameservers (`cullen`/`liberty.ns.cloudflare.com`).
- Cloudflare is **not proxying**. The apex resolves to `216.150.1.129` and
  `216.150.16.129` — Vercel's anycast addresses. So Cloudflare provides
  registration and authoritative DNS, and nothing else.
- There is **no MX, no SPF, no DMARC**. Mail to `support@sellavant.com` today
  falls back to the apex A record under RFC 5321, reaches Vercel, which does not
  answer on port 25, and eventually bounces.
- Registered 2026-03-26, so the 60-day ICANN transfer lock has expired.
- `scansafeguard.com`, in the same organisation, is **already on Route 53** and
  managed by CDK — `infra/foundation/lib/dns-zone-stack.ts` looks the zone up,
  issues a wildcard ACM certificate, and creates a cross-account IAM role so
  workload accounts can write `_acme-challenge` records.

Cloudflare Registrar requires domains registered through it to use Cloudflare
nameservers. Moving DNS to Route 53 therefore means **transferring the
registration**, not changing a setting.

## Decision

**Transfer `sellavant.com` to Route 53, and allocate one name per mail role.**

Names, and what each is for:

| name                 | purpose                               | record                     |
| -------------------- | ------------------------------------- | -------------------------- |
| `sellavant.com`      | business mail — `support@`, `hello@`  | MX → Forward Email         |
| `sellavant.com`      | the SES **identity**; DKIM lives here | 3 × CNAME                  |
| `in.sellavant.com`   | ingest — mail the product processes   | MX → SES inbound           |
| `mail.sellavant.com` | envelope sender for app mail          | MX → SES feedback, TXT SPF |

Only the first is seen by a person. App mail is sent **From: `no-reply@sellavant.com`** —
`mail.sellavant.com` is a custom MAIL FROM setting on the apex identity, never a
from-address. Its MX points at a bounce collector, so anything visibly sent from
it would have replies silently discarded.

Ingest addresses are `<token>@in.sellavant.com`, with the tenant id in the
**local part** rather than as a per-customer subdomain: one MX, one identity, one
receipt rule set, and no wildcard in DNS.

**The token is opaque and random, not a sequential customer id.** That address is
the routing key into a pipeline that turns documents into cost basis (#43), so a
guessable address lets someone inject a fabricated invoice into another seller's
books.

Outbound splits three ways:

| what                            | from                     | via                                    |
| ------------------------------- | ------------------------ | -------------------------------------- |
| Auth0 and product notifications | `no-reply@sellavant.com` | SES                                    |
| A human replying as `support@`  | `support@sellavant.com`  | Forward Email Outbound SMTP            |
| A reply on a _seller's_ behalf  | not decided              | Amazon Buyer-Seller Messaging, not SES |

## Options considered

### A. Transfer to Route 53 ✅ chosen

One control plane, one audit trail, and DNS in CDK alongside everything else —
including the apex, which is the part a delegated subtree cannot reach. It also
reuses ScanSafeGuard's working cross-account ACM pattern instead of inventing a
second one, and matches the account topology: zone in production, a delegated
`dev.sellavant.com` for NonProd.

Costs: a 5–7 day registrar transfer, ~$0.50/zone/month plus queries against
Cloudflare's free DNS, and Cloudflare Registrar's at-cost renewal (~$10/yr)
becoming Route 53's (~$14/yr).

### B. Keep the registration, delegate `aws.sellavant.com` to Route 53

Cheaper and reversible — four NS records, no transfer. Rejected because it leaves
DNS permanently split across two control planes, so resolving a problem requires
knowing which subtree lives where. That is the same failure this repository has
been paying for elsewhere: two IaC tools ([ADR-0001](0001-cdk-deploys-sam-is-local-invoke.md)),
two spec-config patterns (#48), Bedrock deployed while dead in code (`203e748`).

It also would not have helped the thing that prompted it. DKIM records belong to
the identity's domain, so an apex identity's records sit in the apex zone no
matter what is delegated below it.

### C. Stay on Cloudflare entirely

Rejected once the last argument for it fell away. The only capability Cloudflare
offers that Route 53 does not is putting its proxy, WAF and bot protection in
front of the app — which requires Cloudflare to be authoritative. That is not in
use, and it is covered: **Vercel Firewall and BotID protect the browser-facing
surface**, which is the only surface exposed. AWS WAF cannot help there — traffic
to Vercel never passes through AWS — and is relevant only to the private API in
#54.

### Mail: one provider, or split by name ✅ split

Forward Email holds the apex because it is a mailbox service — it forwards,
supports multiple recipients per alias, and its paid Outbound SMTP lets a human
reply as `support@`. SES is a sending API and a receiving pipeline, not a
mailbox: no IMAP, no webmail, nothing to compose from.

Forward Email can also POST to a **webhook**, which would remove SES receiving
entirely. Rejected for this product because ingest is mostly **supplier invoices
as PDF attachments** (#43, #50), and SES receiving puts the original message in
S3 — addressable and replayable when an extraction turns out wrong weeks later.
A webhook payload is a poor home for a 10MB PDF. The webhook stays available for
lighter flows.

## Consequences

**Positive**

- DNS in CDK, apex included; changes appear in CloudTrail with everything else.
- One vendor fewer, and ScanSafeGuard's ACM pattern to copy.
- The apex stays a real mailbox domain, so `support@` works and replies to
  `no-reply@` are catchable rather than lost.
- Ingest is isolated on a name nobody types, addressable per tenant.

**Negative / costs**

- A registrar transfer: unlock, auth code, 5–7 days. Records must be recreated in
  Route 53 and verified against its nameservers **before** the nameserver switch,
  with TTLs lowered first.
- Losing the option of Cloudflare's proxy in front of Vercel.
- Alias routing lives in Forward Email's dashboard on a paid plan, so mail
  configuration is not entirely in DNS.

**Carried into implementation**

- Forward Email applies **SRS**, rewriting the envelope sender so SPF passes at
  the destination. Mail reaching SES therefore carries Forward Email's envelope
  sender, not the customer's — **attribute on the `From:` header**. A parser
  reading the envelope will attribute every forwarded message to the forwarder
  and look like it is working.
- SES receiving runs in a subset of regions; `us-east-1` is one, and matches
  `stages.ts`.
- Verifying `sellavant.com` covers its subdomains, so one identity serves both
  sending and receiving when both run in the production account.

## References

- Live DNS and registrar state, verified 2026-07-30 (`dig`, `whois`)
- `~/devel/scansafeguard`: `infra/foundation/lib/dns-zone-stack.ts`
- Forward Email DNS documentation (MX `mx1`/`mx2.forwardemail.net`, priority 0)
- [ADR-0002](0002-aws-account-topology.md); issues [#67](https://github.com/bwarner/amz-spapi/issues/67) transfer, [#65](https://github.com/bwarner/amz-spapi/issues/65) SES, [#63](https://github.com/bwarner/amz-spapi/issues/63) accounts
