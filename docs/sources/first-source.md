# First Public Source — Greenhouse Job Board API

**Decision date:** 30/09/2026  
**Pilot board:** PlanetScale (`planetscale`)  
**Status:** approved contract; collection implementation belongs to Marco 6.

## Official contract

Greenhouse documents the public Job Board API at
<https://docs.greenhouse.io/job-board.html>. Public `GET` endpoints do not
require authentication. Haadar will call only:

`GET https://boards-api.greenhouse.io/v1/boards/{board_token}/jobs?content=true`

The list response contains `jobs` and `meta.total`. A job exposes `id`,
`title`, `location.name`, `absolute_url`, `updated_at`, `language`, and, with
`content=true`, the description plus exposed offices and departments. The
documented list endpoint returns the published board in one response and does
not document pagination for jobs. Haadar therefore performs exactly one
bounded request per board and treats `meta.total` above its record ceiling as
partial coverage, never as permission for unbounded follow-up requests.

`updated_at` is a modification timestamp. It must not be stored as
`publishedAt`. The first time Haadar sees a posting is `observedAt`; publication
time remains absent unless a future source supplies it with that meaning.

## Reproducible pilot

- Board metadata: <https://boards-api.greenhouse.io/v1/boards/planetscale>
- Jobs: <https://boards-api.greenhouse.io/v1/boards/planetscale/jobs?content=true>
- Verified on 30/09/2026 without login or credentials.
- The metadata identified the organization as `PlanetScale`; the jobs response
  contained 12 public posts at verification time. That count is evidence for
  the selected pilot, not a permanent expectation.
- This pilot proves one public Greenhouse board only. It does not establish
  coverage of all Greenhouse customers, Brazil, Portuguese vacancies, junior
  roles, or other ATS products.

## Hard request budget

| Control | Limit |
| --- | ---: |
| Allowed request host | `boards-api.greenhouse.io` |
| Allowed scheme | HTTPS |
| Redirects | 0 automatic; validate each redirect before following |
| Timeout | 10 seconds |
| Response body | 2 MiB while streaming |
| Requests per board task | 1 |
| Jobs accepted per response | 200 |
| Boards in pilot | 1 |

`absolute_url` may point to `job-boards.greenhouse.io`; it is stored as the
public vacancy URL, not fetched by the adapter. HTML in `content` is treated as
untrusted input and converted to bounded plain text.

## Mapping and provenance

| Greenhouse | Haadar | Rule |
| --- | --- | --- |
| board token | `sourceId` | `greenhouse:{token}` |
| `id` | `sourceVacancyId` | decimal string |
| `absolute_url` | `canonicalUrl` | HTTPS only |
| `title` | `title` | normalized whitespace, not rewritten |
| board name | `organization` | from configured board registry |
| `location.name` | `location` | preserve stated text |
| location/description | `workModel` | only explicit remote/hybrid/onsite evidence; otherwise `unknown` |
| `content` | `descriptionSummary` | HTML-to-text, bounded |
| none | `publishedAt` | absent |
| collection clock | `observedAt` | injected UTC instant |
| `updated_at` | evidence only | never publication time |

The raw response is not stored wholesale. Evidence retains the board token,
job ID, observed URL, source update timestamp, mapping version, fingerprint
version, round, task, and query attribution.

## Query Portfolio behavior

Greenhouse lists a board, not search results. One board task fetches the board
once; Haadar evaluates the returned jobs locally against all applicable query
families. It must not repeat the same HTTP request once per query.

- `BROAD`: broad software/backend opportunity discovery.
- `ROLE`: backend and software engineering roles; primary signal may come from
  title or description.
- `STACK`: Node.js, TypeScript, Java, Spring, PostgreSQL; absence in the title
  is not rejection.
- `CONTEXT`: remote/hybrid and geography evidence.
- `COMPANY`: explicitly tracked company boards such as the pilot.
- `EXPERIMENTAL`: low-priority variants, disabled outside `NORMAL` budget.

The configurable relevance profile separates role, junior/entry-level
seniority, Brazil/remote compatibility, desired technologies, and explicit
exclusions. Missing seniority, work model, salary, or publication time remains
unknown rather than being inferred as favorable.

## Policy and failure boundary

Only the documented public GET API is in scope. Haadar does not submit
applications, bypass access controls, scrape authenticated pages, or use the
Greenhouse Harvest API. A 401/403 is terminal/blocked, 404 is a board contract
failure, 429 is throttled, 5xx is retryable, and an incompatible successful
payload is `schema_changed`.
