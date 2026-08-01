# ADR-0007: Private API endpoints are page-shaped, and the gateway validates the token

- **Status:** Accepted
- **Date:** 2026-08-01
- **Deciders:** Byron Warner
- **Depends on:** [ADR-0001](0001-cdk-deploys-sam-is-local-invoke.md)

## Context

[#54](https://github.com/bwarner/amz-spapi/issues/54) introduces a network hop
that did not exist before. Route handlers in `apps/web` read the data layer
directly today; behind this seam they call a Lambda instead, and every read
gains a round trip.

Two decisions had to be made before the first endpoint existed, because both are
expensive to reverse once there are twenty of them.

**How is the hop authorized?** The user's own Auth0 access token carries it —
that part was settled in #54 and needs no ADR. What was open is _what checks
it_. The obvious reading of "Auth0 authorizer" is a Lambda that verifies the
JWT, which is what SSG does.

**How big is an endpoint?** Nothing forces an answer on day one, and that is
exactly the problem: the first few endpoints set the pattern the rest copy. Row-
shaped endpoints (`/orders/{id}` called in a loop) are the default a REST habit
produces, and they are the shape that makes the chat tool loop — several small
reads per turn — noticeably worse, because every read now pays a round trip it
did not pay before.

## Decision

**1. API Gateway validates the token itself, with its native JWT authorizer.**
No authorizer Lambda. The gateway fetches the tenant's JWKS, checks the RS256
signature, `iss`, `aud` and `exp`, and passes the claims to the integration at
`event.requestContext.authorizer.jwt.claims`.

**2. Endpoints are page-shaped: one call per view, not one per row.** An endpoint
returns everything a screen or an agent turn needs, already joined. When a view
needs three things, that is one endpoint returning three things, not three
endpoints.

## Options considered

### Who validates the token

| Option                                | Why not                                                                                                                                                                 |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Gateway JWT authorizer** _(chosen)_ | Nothing to build, deploy, warm or pay for. The check runs before any function is invoked.                                                                               |
| Lambda authorizer (SSG's shape)       | Another function on the critical path of every request, doing what the gateway already does. Justified by logic the gateway cannot express — none exists yet.           |
| Validate inside each function         | Every function then carries JWKS fetching, caching and clock-skew handling, and one that forgets is open. Fails open by omission, which is the wrong direction to fail. |

The Lambda authorizer is not rejected forever. It becomes right when there is a
decision the gateway cannot make: mapping a subject to a tenant, enriching
claims from the database, consulting a revocation list. `LambdaHttpApi` takes an
`IHttpRouteAuthorizer`, so that change is one argument in
`createAuth0Authorizer` and nothing else — handlers already read claims from the
same place either way.

### Endpoint granularity

| Option                        | Why not                                                                                                                                |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| **Page-shaped** _(chosen)_    | One round trip per view. The BFF stays thin, and the join happens where the data is.                                                   |
| Row-shaped (`/orders/{id}`)   | The BFF fans out N calls per view. Latency is now N round trips, and the agent loop pays it several times per turn.                    |
| One RPC per data-layer method | The API becomes a remote copy of the repository layer, and the network boundary lands in the middle of a transaction's worth of reads. |

## Consequences

- A screen that needs new data changes one endpoint rather than adding one.
- Endpoints are named for views, not for tables: `/dashboard`,
  `/products/{id}/overview`. `/me` is the degenerate case — one view, one call.
- The BFF does not join. If a route handler is merging two API responses, the
  endpoint is the wrong shape, and that is the signal to reshape it.
- Two views needing overlapping data may fetch overlapping fields. That is
  accepted: duplicated fields cost bytes, extra round trips cost latency on
  every request.
- Access tokens must be addressed to the API's audience, so `AUTH0_AUDIENCE`
  must match the Auth0 API identifier exactly. A mismatch is a 401 the token
  cannot explain, since the token itself is perfectly valid.
- **The Auth0 tenant needs configuration this repository cannot carry**, and a
  new environment will fail without it. Under a _Per-app authorization_ access
  policy the application must be granted access to the API on **both** the
  user-delegated and client-access paths — they are separate grants, and
  authorizing only one leaves login failing with `invalid_request: Client "…" is
not authorized to access resource server "…"`. The API's signing algorithm
  must also be **RS256**: API Gateway supports RSA only, so an HS256 API signs
  tokens the gateway can never validate, and JWE encryption must stay off for
  the same reason.
- The gateway rejects bad tokens before the function runs, so functions are
  never invoked — and never billed — for unauthenticated traffic.
- Functions still check for a subject rather than assuming one. A route
  accidentally left open would otherwise reach a handler that treats `userId` as
  proven; `apps/lambdas/me` answers 401 instead.
- A stage with no Auth0 settings deploys **unauthenticated**, with a synth
  warning. That is deliberate — a stage can exist before its Auth0 API does —
  but it means the warning must be read.
