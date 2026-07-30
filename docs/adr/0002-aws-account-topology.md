# ADR-0002: One AWS account per environment for SellAvant, and where the SES identity lives

- **Status:** Proposed
- **Date:** 2026-07-30
- **Deciders:** Byron Warner
- **Epic:** [#51](https://github.com/bwarner/amz-spapi/issues/51)
- **Depends on:** [ADR-0001](0001-cdk-deploys-sam-is-local-invoke.md)

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

**ScanSafeGuard already has the shape this ADR proposes** — per-environment OUs
and a dedicated production account. SellAvant has one account, sitting directly
in its OU, and `infra/aws/config/stages.ts` fills the gap by pointing the other
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

**Give SellAvant its own account per environment, under per-environment OUs,
mirroring ScanSafeGuard.** Nothing SellAvant runs belongs in the management
account or in the shared-services account.

```
SellAvant (ou-8xck-p9uto1vg)
├── Development  853583158600   (exists)
├── Staging      sellavant-staging   (to create)
└── Production   sellavant-prod      (to create)
```

Member accounts are created with `organizations create-account`; the management
account stays empty of workloads.

**The SES identity for `sellavant.com` follows the account, not the other
product.** Verify the domain in the SellAvant accounts rather than reusing the
account ScanSafeGuard sends from.

## Options considered

### A. Per-environment SellAvant accounts ✅ chosen

Matches ScanSafeGuard in the same organisation, so there is one pattern to learn.
Gets production out of the management account, which is the only change here that
removes a real risk rather than tidying. Makes SCPs meaningful: a guardrail can
target the SellAvant Production OU.

Costs: two more accounts to bootstrap, and cross-account deploys to configure.

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
SES Inbound, and the domain's MX record points at SES in exactly one account and
region. Inbound for `sellavant.com` cannot be split across accounts, so whichever
account owns it owns it for every environment — use subdomains
(`staging.sellavant.com`) if per-environment inbound is wanted later.

## Consequences

**Positive**

- Production stops running in an account that cannot be governed by SCPs.
- An SCP baseline becomes possible and meaningful, targeted per OU.
- SellAvant's sending reputation is its own.
- One pattern across both products in the organisation.

**Negative / costs**

- Two accounts to create and bootstrap (CDK bootstrap, Identity Center
  assignments, `stages.ts`, deploy roles).
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
