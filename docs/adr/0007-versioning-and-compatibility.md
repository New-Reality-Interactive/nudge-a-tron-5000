# ADR 0007: Versioning and compatibility

- **Status:** Accepted
- **Date:** 2026-09-27

## Context

Every merged milestone is released to production with a tag. Up to now, versions were chosen when tagging: Milestone 1 shipped as `v0.1.0`, Milestone 2 was never tagged, and Milestone 3 shipped as `v0.3.0`, carrying M2 with it. The M6 spec planned a `v1.0.0`. The public API arrives in Milestone 4 and was planned at `/v1`.

Once other people use the API, and once notifications carrying ack links are sitting on phones, a change can break them. We need rules for what a version number means, what may change without breaking anyone, and how long an old API keeps working.

## Decision

### Version numbers: `MAJOR.MILESTONE.PATCH`

The numbers follow [Semantic Versioning](https://semver.org/). Tags are annotated tags on merge commits on `main`, and every tag deploys to production.

- **Major:** the API's compatibility generation. It's `0` now and changes only when a breaking change is unavoidable (see below), or when the owner decides it should.
- **Minor:** the milestone number. A merged milestone is tagged `vX.N.0`, so M4 is `v0.4.0` and M6 is `v0.6.0`. Later milestones keep counting: `v0.8.0`, `v0.9.0`, `v0.10.0`.
- **Patch:** each change released between milestones.
  - A merged non-milestone PR that deployed to staging (it changed something outside the deploy workflow's `paths-ignore`) is tagged with the next patch number, `vX.N.(P+1)`. The number resets to 0 at the next milestone.
  - A docs-only or tests-only merge gets no tag, because production wouldn't change.
- `main` is a single line, so there are no backports. A patch always builds on the latest release.

### The API's URI carries the major version

The API is served at **`/v0`** while the major version is 0, so the URI's major version always equals the release's major version. The public ack routes (`/a/{token}`) stay unversioned, because they're embedded in notifications that outlive any one version (see below).

Each supported major version has its own OpenAPI document, `GET /vN/openapi.json`, and its own committed snapshot, `openapi/vN.json`.

### Backwards compatibility within a major version

Every release within a major version stays backwards compatible with every earlier release of that major version. That covers:

- **The HTTP API.**
  - Not allowed: removing or renaming a route, field, parameter, error code or enum value; changing a field's type or meaning; making an optional input required; tightening validation so that previously valid input is rejected; changing default behaviour.
  - Allowed: new routes, new optional request fields, new response fields, new enum values and new error codes for new situations.
  - The API documentation tells clients to ignore unknown response fields and enum values, so the allowed additions really are safe for them.
- **Ack links.** A token in a notification someone has already received keeps working until it expires. A new token format must be introduced alongside the old one, which keeps verifying. Signing-key rotation already works this way (ADR 0003).
- **Stored data.** D1 and Durable Object migrations only ever add: new tables, new columns with defaults, new indexes. Renaming or dropping happens only after no supported release reads the old shape. This also keeps rolling back Worker code safe, because Durable Objects that already migrated keep working with the older code.

Not covered, because they're deployed together and have no outside consumers: internal code, the RPC calls between the Worker and the Durable Object, log formats, and anything under `test/`.

### A breaking change means a new major version

When a change can't be made compatibly, it ships as major `X+1`:

- The release is tagged `v(X+1).N.0`.
- The new API is served at `/v(X+1)`, alongside `/vX`.
- Both majors are served by the same Worker from the same Durable Objects. The domain and app layers are shared, and only the HTTP layer (routes, zod schemas, OpenAPI) is per version. Storage must serve both, which the add-only migration rule makes possible.

Moving from `v0` to `v1` is itself a major version, handled the same way: `/v1` launches beside `/v0`.

### At most two major versions at a time

- When major `X+1` ships, every `/vX` response carries a `Deprecation` header ([RFC 9745](https://www.rfc-editor.org/rfc/rfc9745)) and a `Sunset` header ([RFC 8594](https://www.rfc-editor.org/rfc/rfc8594)) giving the date `/vX` will be removed, and the OpenAPI document marks it deprecated.
- `/vX` is removed no later than the release that introduces major `X+2`, so at most two majors are ever served. It may be removed earlier, once its sunset date has passed.

## Consequences

- Release tagging is mechanical: the session tags every milestone merge and every merge that deployed, and watches the production deploy. Production always matches the latest deployable `main`.
- Breaking API changes cost a second set of routes and schemas, and some time running two versions, so they'll be rare. Add-only design becomes the default.
- Because the migration rule is add-only, the schema accumulates old columns until the version that last read them is removed.
- M4 builds the API at `/v0`, not `/v1`, and serves its OpenAPI document per version. Whether CI should also detect breaking OpenAPI changes (for example with `oasdiff`) is an open question for the M4 plan.
- M6, the end of the MVP, is `v0.6.0`. `v1.0.0` needs a deliberate decision, and would mean running `/v0` and `/v1` side by side.
