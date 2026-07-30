# Architecture Decision Records

Short records of significant, hard-to-reverse decisions and _why_ we made them.
One decision per file, numbered sequentially. Format: Context → Decision → Options
considered → Consequences. A decision is never edited to reverse it — instead a new
ADR supersedes it, and both link to each other.

Status values: **Proposed** → **Accepted** → **Superseded** (or **Rejected**).

Write one when a choice is expensive to undo, when two reasonable options were
weighed, or when the code will not explain itself later. The test: if someone
finds this decision in six months and asks "why is it like this?", is the answer
in the repository?

## Index

| #                                               | Title                                                                          | Status   |
| ----------------------------------------------- | ------------------------------------------------------------------------------ | -------- |
| [0001](0001-cdk-deploys-sam-is-local-invoke.md) | CDK deploys AWS infrastructure; SAM is used only for local invoke              | Accepted |
| [0002](0002-aws-account-topology.md)            | A dedicated production account for SellAvant, and where the SES identity lives | Proposed |
| [0003](0003-dns-and-mail-routing.md)            | Move DNS to Route 53, and split mail by name                                   | Proposed |

Related epic: [#51 — AWS integration](https://github.com/bwarner/amz-spapi/issues/51)
