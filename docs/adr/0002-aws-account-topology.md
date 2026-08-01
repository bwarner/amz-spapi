# ADR-0002: A dedicated production account for SellAvant, and where the SES identity lives

- **Status:** Accepted — built 2026-08-01
- **Date:** 2026-07-30
- **Deciders:** Byron Warner
- **Epic:** [#51](https://github.com/bwarner/amz-spapi/issues/51)
- **Depends on:** [ADR-0001](0001-cdk-deploys-sam-is-local-invoke.md)

## As built (2026-08-01)

The decision below was carried out. The account exists:

```
SellAvant (ou-8xck-p9uto1vg)
├── 853583158600  SellAvant Development   dev + staging
└── 108248327073  SellAvant Production    bfwarner+sellavant-prod@gmail.com
```

| stage   | account          |
| ------- | ---------------- |
| dev     | 853583158600     |
| staging | 853583158600     |
| prod    | **108248327073** |

The Context table further down records the _problem_ state and is kept as
written; this is what is true now.

Created with `organizations create-account` (billing access `DENY`), then moved
from the root into the SellAvant OU — new accounts land in the root by default,
so the move is a required second step rather than a tidy-up.

Access is the `WorkloadAdmin` permission set, assigned through the `Developers`
group in Identity Center, matching how the dev account is reached. Note the
management account's `OrgAdmin` set can create accounts but can neither
`sts:AssumeRole` into `OrganizationAccountAccessRole` nor read Identity Center,
so the assignment cannot be done from the CLI with it — expect to use the
console.

The account is CDK-bootstrapped, and `media-assets`, `credentials-key` and
`vercel-access` are deployed. `lambdas` is deliberately **not** deployed yet:
its one route has no authorizer until [#54](https://github.com/bwarner/amz-spapi/issues/54)
lands, and deploying it would publish an unauthenticated public API.

Still outstanding: no `prod` Couchbase scope exists, and the SES work in
[#65](https://github.com/bwarner/amz-spapi/issues/65) has not started.

## Context

The organisation, IAM Identity Center and SSO already exist. Verified against
the live org on 2026-07-30 through the `OrgAdmin` permission set:

```
r-8xck (root)
├── 132664187310  Byron Warner                     ← MANAGEMENT ACCOUNT
└── Farvision LLC (ou-8xck-blr0k4hc)
    ├── ScanSafeGuard (ou-8xck-9mn8ixso)
    │   ├── Development (ou-8xck-gnebnqgz)  035352456128, 589668342153
    │   ├── Staging     (ou-8xck-wgw1sqkc)  654654299558
    │   └── Production  (ou-8xck-hoyl92xd)  260820062117  ssg-prod
    ├── SellAvant (ou-8xck-p9uto1vg)        853583158600  SellAvant Development
    └── Shared-Services (ou-8xck-zcaz2c2r)  058264463518  shared-services-deployer
```

Organisation `o-ighpjm8sqt`, FeatureSet `ALL`. Identity Center is at
`https://d-9067e06487.awsapps.com/start` with `OrgAdmin` and `WorkloadAdmin`
permission sets in use.

**ScanSafeGuard already separates production into its own account**, under
per-environment OUs. SellAvant has one account, sitting directly in its OU, and `infra/aws/config/stages.ts` fills the gap by pointing the other
two environments at accounts that belong to something else:

| stage    | account          | what it actually is                                  |
| -------- | ---------------- | ---------------------------------------------------- |
| dev      | 853583158600     | SellAvant Development ✅                             |
| staging  | 058264463518     | `shared-services-deployer` — shared with SSG tooling |
| **prod** | **132664187310** | **the organisation's management account**            |

The production mapping is the problem worth fixing. Service control policies do
not apply to the management account — AWS excludes it by design — so it is the
one account in the organisation that cannot be constrained by a guardrail. It
also owns billing and the organisation itself. A deploy role or a mistaken CDK
stack there has organisation-wide reach, and `nx run infra-aws:synth -c
stage=prod` targets it today.

Separately, the only policy attached anywhere is AWS's default `FullAWSAccess`;
there are no custom SCPs.

## Decision

**Production gets its own account. Development and staging share the account
that already exists.** Nothing SellAvant runs belongs in the management account
or in the shared-services account.

```
SellAvant (ou-8xck-p9uto1vg)
├── NonProd     853583158600     dev + staging (exists)
└── Production  sellavant-prod   (to create)
```

`stages.ts` keeps three stages; `dev` and `staging` resolve to the same account.
That is safe by construction rather than by care — every resource name already
carries the stage. The media bucket is `[base, stageName, account, region]`, the
runtime policy is `${appName}-${stageName}-media-assets-runtime`, and Lambda
function names and ECR repository paths are stage-scoped the same way, so two
stages cannot collide in one account.

The member account is created with `organizations create-account`; the management
account stays empty of workloads.

**The SES identity for `sellavant.com` follows the account, not the other
product.** Verify the domain in the SellAvant accounts rather than reusing the
account ScanSafeGuard sends from.

## Options considered

### A. Dedicated production account, dev and staging shared ✅ chosen

Gets production out of the management account, which is the only change here that
removes a real risk rather than tidying, and makes SCPs meaningful: a guardrail
can target the SellAvant Production OU.

Staging does not earn its own account yet. Staging exists to rehearse production,
and sharing with dev costs exactly two things — blast radius between dev and
staging, and the ability to prove a stricter SCP or IAM posture on staging before
prod. Neither buys anything until there is a production worth rehearsing against.

The decisive point is asymmetry. Adding a staging account later is create,
bootstrap, deploy fresh: nothing migrates, because staging is disposable by
definition. Getting **production** wrong is the expensive one, because live data
has to move. So spend the care where it cannot be undone cheaply.

### B. An account per environment, three in total

The shape ScanSafeGuard runs, and where this ends up eventually. Rejected for now
as cost without a benefit: another bootstrap, another profile, another deploy
role and one more thing to keep straight, to isolate a staging tier that has no
production to protect yet. Revisit on the triggers below.

### B. Keep prod in the management account

Free, and works today. Rejected because it cannot be made safe: SCPs cannot
constrain the management account at all, so the guardrail baseline this ADR
enables would have a hole exactly where the production workload runs.

### C. One SellAvant account, environments separated by tags or stacks

Cheapest. Rejected because the isolation is by convention: a wrong `-c stage`
argument, an over-broad IAM policy, or a bad `RemovalPolicy` reaches production
resources from a dev session. Account boundaries fail closed; naming conventions
do not.

### SES: reuse ScanSafeGuard's account, or verify in SellAvant's ✅ SellAvant's

ScanSafeGuard's `Auth0SesStack` creates an IAM user and access key scoped to
`ses:SendEmail` for `*@<domain>`, stored in Secrets Manager, for Auth0 to send
transactional mail. It does **not** create the domain identity — that was
verified by hand. Reusing it for `sellavant.com` would mean adding a second
identity to the same account.

Rejected, for one reason that outweighs the convenience: **SES reputation is
per account, per region.** Bounce and complaint rates are measured for the
account as a whole, so one product's bad mail can throttle or suspend sending for
the other. Two products sharing a sending reputation is a coupling nobody
notices until it costs both of them.

The cost of separating is real and should be planned for: a new account starts in
the **SES sandbox** — verified recipients only, 200 messages/day — until a
production-access request is granted, and that request is reviewed by AWS rather
than granted on demand. Start it early.

Inbound is the harder constraint. Email ingest (CLAUDE.md §2.4) routes through
SES Inbound, and a given name's MX record points at exactly one destination.
Inbound for a name cannot be split across accounts.

That is why **the apex is not spent on SES**. `sellavant.com` has no MX today, so
it stays available for ordinary business mail — `support@`, `hello@` — through a
real mail provider. Ingest goes on `in.sellavant.com`, which nobody types: the
address is a forwarding target, handed to a seller's mail rules rather than
printed anywhere. The full name allocation is [ADR-0003](0003-dns-and-mail-routing.md).

Per-environment inbound, if it is ever wanted, is another subdomain
(`in.dev.sellavant.com`) rather than another account.

## Consequences

**Positive**

- Production stops running in an account that cannot be governed by SCPs.
- An SCP baseline becomes possible and meaningful, targeted at the Production OU.
- SellAvant's sending reputation is its own; dev and staging sharing one matters
  less, since neither is production.
- One account to create instead of two.

**Add a staging account when any of these becomes true**

- Real users in production, so a rehearsal has something to protect.
- An SCP or IAM tightening wants proving somewhere before production.
- Staging needs production-like data — with Amazon buyer PII that is a
  data-protection reason to isolate, not a tidiness one.
- Staging starts sending real email to real recipients.

**Negative / costs**

- One account to create and bootstrap (CDK bootstrap, Identity Center
  assignment, `stages.ts`, deploy role).
- Dev and staging share a blast radius until the triggers above are met.
- SES sandbox lead time before production sending works.
- Cross-account deployment needs a deploy role per account.

**Not decided here**

- The SCP baseline itself.
- Whether `shared-services-deployer` remains the deployment identity for
  SellAvant or each account gets its own deploy role.
- Rotation for the Auth0 SES access key, which is a long-lived static credential
  because Auth0's SES connector requires one.

## References

- Live org state, verified 2026-07-30 via `aws organizations` through `OrgAdmin`
- `~/devel/scansafeguard`: `infra/foundation/lib/auth0-ses-stack.ts`
- `infra/aws/config/stages.ts`
- Issues: [#63](https://github.com/bwarner/amz-spapi/issues/63) accounts, [#64](https://github.com/bwarner/amz-spapi/issues/64) SCP baseline, [#65](https://github.com/bwarner/amz-spapi/issues/65) SES
