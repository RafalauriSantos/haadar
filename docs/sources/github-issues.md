# Public Source — GitHub Issues Job Communities

**Decision date:** 30/09/2026  
**Status:** approved and implemented as the second source family.

## Official contract

Haadar uses GitHub's documented public REST endpoint:

`GET https://api.github.com/repos/{owner}/{repo}/issues?state=open&sort=created&direction=desc&per_page=50`

The endpoint returns issues and pull requests together. A returned item with a
`pull_request` field is not a vacancy and is ignored. The Worker only reads
open issues; it never creates comments, reacts, edits, follows links, or
accesses authenticated content.

The implementation sends GitHub's documented API version header
`X-GitHub-Api-Version: 2022-11-28`. The source is intentionally anonymous:
there is no token to store or rotate. A rate-limit response is classified as
throttled and follows the normal bounded Queue retry path.

## Reproducible initial sources

| Source ID | Public repository | Validation |
| --- | --- | --- |
| `github-issues:backend-br/vagas` | `backend-br/vagas` | Public API returned HTTP 200 on 30/09/2026. |
| `github-issues:soujava/vagas-java` | `soujava/vagas-java` | Public API returned HTTP 200 on 30/09/2026. |

This source family is community-provided, not an employer ATS. An issue is a
lead, not proof that an employer posting is still open, that its details are
complete, or that it matches Rafael's profile. Haadar keeps the origin and the
public issue URL visible, applies its normal explicit entry-level gate, and
does not infer seniority from missing data.

## Hard request budget

| Control | Limit |
| --- | ---: |
| Allowed request host | `api.github.com` |
| Allowed scheme | HTTPS |
| Redirects | 0 automatic; validate each redirect before following |
| Timeout | 10 seconds |
| Response body | 512 KiB while streaming |
| Requests per repository task | 1 |
| Issues accepted per response | 50 |
| Initial repositories | 2 |

The hourly discovery round therefore adds at most two GitHub API requests.
The source fetches once per repository and applies the Query Portfolio locally;
it never repeats the same listing request once per query.

## Mapping and provenance

| GitHub issue | Haadar | Rule |
| --- | --- | --- |
| repository | `sourceId` / `organization` | `github-issues:{owner}/{repo}` / repository name |
| `id` | `sourceVacancyId` | decimal string |
| `html_url` | `canonicalUrl` | HTTPS `github.com/{owner}/{repo}/issues/{number}` only; fragment removed |
| `title` | `title` | normalized whitespace, not rewritten |
| `body` | `descriptionSummary` | normalized, bounded to 4,000 characters |
| `created_at` | `publishedAt` | issue publication timestamp |
| collection clock | `observedAt` | injected UTC instant |
| `pull_request` present | no observation | excluded before matching |

## Failure and quality boundary

- `429`: throttled and eligible for bounded retry.
- `401` / `403`: blocked; no workaround or credential escalation.
- `404`: permanent repository contract failure.
- `5xx` and timeouts: retryable.
- non-array or incompatible issue payload: `schema_changed`.

GitHub Issues is the first expansion because it has a documented, publicly
readable contract. Gupy, Trampos and LinkedIn are deliberately outside this
change: they require a separate confirmed public access contract and their own
request, provenance and failure boundaries before inclusion.
