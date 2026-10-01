# LinkedIn Guest Experimental Source Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a tightly bounded, anonymous LinkedIn guest-search source that can produce early-signal vacancy observations without logging into LinkedIn or weakening Haadar's reliable sources.

**Architecture:** The source is a separate `linkedin-guest` board-once adapter. Each configured search produces one task and one bounded HTTPS request to the guest-search endpoint; its returned job cards are parsed into normal Haadar observations and run through the existing persistence, deduplication and explicit-entry-level gate. It is off by default until its isolated production pilot has been reviewed.

**Tech Stack:** Cloudflare Workers, Queues, D1, TypeScript, Vitest, native `fetch`, existing bounded adapter patterns.

## Global Constraints

- Keep Haadar backend-only, Cloudflare-only and free-tier-first.
- Schedule remains `0 * * * *`; do not add a second scheduler.
- Use no LinkedIn account, password, OAuth token, cookie, browser session, proxy, CAPTCHA solver, IP rotation, or evasion mechanism.
- Use only HTTPS and the exact allowlisted host `www.linkedin.com`.
- Set a transparent fixed `User-Agent: Haadar vacancy discovery`; do not impersonate a browser.
- Each search makes exactly one request per hourly round, with `start=0`; no pagination or automatic follow-up requests.
- Begin with at most three searches: `Desenvolvedor Java Junior`, `Desenvolvedor Node Junior`, and `Desenvolvedor Full Stack Junior`, all scoped to Brazil and the last two hours.
- Treat 401, 403, 429, CAPTCHA-like HTML, unexpected HTML structure and redirects as source diagnostics; never work around them.
- A LinkedIn failure must make only its task terminal or retryable; it must never block Greenhouse, GitHub, Gupy, Trampos or RSS tasks.
- Persist-first, idempotency, existing deduplication, explicit entry-level gate, Budget Guard and Telegram flow remain unchanged.
- The adapter is experimental and ships with `active: false`; activation requires a separate user-approved configuration-only commit after review of the first controlled evidence.

---

## File Map

| File | Responsibility |
| --- | --- |
| `src/portfolio/sources.ts` | Defines the discriminated `LinkedInGuestSourceDefinition` and three inactive, bounded search definitions. |
| `src/adapters/http.ts` | Adds a reusable bounded text-response function that applies the same host, timeout, redirect and byte controls as JSON adapters. |
| `src/adapters/linkedin-guest.ts` | Builds the guest-search URL, detects blocks/schema changes, parses job cards and emits normalized observations. |
| `src/index.ts` | Adds the adapter factory branch; it remains unreachable while sources are inactive. |
| `tests/adapters/http.test.ts` | Proves text requests reject redirects, oversized bodies and non-allowlisted hosts. |
| `tests/adapters/linkedin-guest.test.ts` | Proves URL construction, transparent request identity, observation mapping, block detection and changed-markup diagnostics. |
| `tests/portfolio/sources.test.ts` | Proves the source stays inactive, exactly three searches are configured and each permits one request. |
| `docs/sources/linkedin-guest-experimental.md` | Records the unsupported-contract risk, budget, privacy boundary, rollout criteria and removal condition. |
| `docs/validation/linkedin-guest-pilot.md` | Receives production-only evidence after user-approved activation; do not create fabricated results. |

## Task 1: Bounded HTML transport

**Files:**
- Modify: `src/adapters/http.ts`
- Create: `tests/adapters/http.test.ts`

**Interfaces:**
- Consumes: `BoundedFetchOptions` and `AdapterHttpError`.
- Produces: `fetchBoundedText(url: string, options: BoundedFetchOptions): Promise<string>`.
- Requirements: the function must validate HTTPS and `allowedHosts`, use `GET`, allow no redirects by default, cap streaming bytes, enforce `timeoutMs`, and return raw text only after a successful response.

- [ ] **Step 1: Write the failing tests**

```ts
it("reads an allowlisted HTML response within its byte budget", async () => {
  await expect(fetchBoundedText("https://www.linkedin.com/jobs-guest/test", {
    allowedHosts: ["www.linkedin.com"], timeoutMs: 100, maxBytes: 100,
    fetcher: async () => new Response("<li>job</li>", { headers: { "content-type": "text/html" } }),
  })).resolves.toBe("<li>job</li>");
});

it("rejects redirects to an unapproved host", async () => {
  await expect(fetchBoundedText("https://www.linkedin.com/jobs-guest/test", {
    allowedHosts: ["www.linkedin.com"], timeoutMs: 100, maxBytes: 100,
    fetcher: async () => new Response("", { status: 302, headers: { location: "https://example.com" } }),
  })).rejects.toMatchObject({ kind: "blocked", message: "url_not_allowed" });
});
```

- [ ] **Step 2: Run the tests to verify red**

Run: `npm test -- --run tests/adapters/http.test.ts`

Expected: failure because `fetchBoundedText` is not exported.

- [ ] **Step 3: Implement the minimal transport**

```ts
export async function fetchBoundedText(url: string, options: BoundedFetchOptions): Promise<string> {
  const response = await fetchBoundedResponse(url, options);
  return readBoundedBody(response, options.maxBytes);
}
```

Extract the common request/redirect/status branch currently inside `fetchBoundedJson` into private `fetchBoundedResponse`. Preserve JSON's `application/json` content-type validation in `fetchBoundedJson`; `fetchBoundedText` must not accept a redirect or bypass `validateUrl`.

- [ ] **Step 4: Run the focused tests to verify green**

Run: `npm test -- --run tests/adapters/http.test.ts tests/adapters/greenhouse.test.ts`

Expected: all tests pass.

- [ ] **Step 5: Commit**

```powershell
git add src/adapters/http.ts tests/adapters/http.test.ts
git commit -m "feat: add bounded text adapter transport"
```

## Task 2: Define the inactive experimental search portfolio

**Files:**
- Modify: `src/portfolio/sources.ts`
- Modify: `tests/portfolio/sources.test.ts`
- Create: `docs/sources/linkedin-guest-experimental.md`

**Interfaces:**
- Produces:

```ts
export interface LinkedInGuestSourceDefinition extends SourceDefinitionBase {
  adapterId: "linkedin-guest";
  keywords: string;
  geoId: "106057199";
  timeRange: "r7200";
}
```

- Produces `linkedinGuestSources: LinkedInGuestSourceDefinition[]` with the three searches and `active: false`.

- [ ] **Step 1: Write the failing portfolio test**

```ts
it("keeps LinkedIn guest discovery inactive and tightly bounded", () => {
  expect(linkedinGuestSources.map((source) => source.keywords)).toEqual([
    "Desenvolvedor Java Junior",
    "Desenvolvedor Node Junior",
    "Desenvolvedor Full Stack Junior",
  ]);
  expect(linkedinGuestSources.every((source) => !source.active)).toBe(true);
  expect(linkedinGuestSources.every((source) => source.limits.maxRequestsPerTask === 1)).toBe(true);
});
```

- [ ] **Step 2: Run the test to verify red**

Run: `npm test -- --run tests/portfolio/sources.test.ts`

Expected: failure because `linkedinGuestSources` is not exported.

- [ ] **Step 3: Add the source definitions and contract document**

Use these common values in every definition:

```ts
allowedHosts: ["www.linkedin.com"],
fetchStrategy: "board_once",
applicableQueryFamilies: ["BROAD", "ROLE", "STACK", "CONTEXT"],
limits: { timeoutMs: 10_000, maxResponseBytes: 512 * 1024, maxRequestsPerTask: 1, maxRecords: 25 },
active: false,
```

The document must state that this is an unsupported guest-page contract, that it must be removed if blocked repeatedly, and that it does not authenticate as Rafael.

- [ ] **Step 4: Run the test to verify green**

Run: `npm test -- --run tests/portfolio/sources.test.ts`

Expected: pass.

- [ ] **Step 5: Commit**

```powershell
git add src/portfolio/sources.ts tests/portfolio/sources.test.ts docs/sources/linkedin-guest-experimental.md
git commit -m "docs: define bounded LinkedIn guest pilot"
```

## Task 3: Implement card parsing and explicit failure classification

**Files:**
- Create: `src/adapters/linkedin-guest.ts`
- Create: `tests/adapters/linkedin-guest.test.ts`

**Interfaces:**
- Produces `class LinkedInGuestAdapter implements SourceAdapter`.
- Constructor signature:

```ts
constructor(
  source: LinkedInGuestSourceDefinition,
  queries: QueryDefinition[],
  observedAt?: () => Date,
  fetcher?: typeof fetch,
)
```

- The request URL must be exactly:

```ts
https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?keywords=<encoded>&f_TPR=r7200&geoId=106057199&start=0
```

- [ ] **Step 1: Write failing adapter tests**

```ts
it("maps one matching guest card without credentials or browser headers", async () => {
  const adapter = adapterWith(`<li><div data-entity-urn="urn:li:jobPosting:123"></div>
    <h3 class="base-search-card__title">Desenvolvedor Java Junior</h3>
    <h4 class="base-search-card__subtitle"><a>Empresa</a></h4>
    <a class="base-card__full-link" href="https://br.linkedin.com/jobs/view/123?tracking=1"></a>
    <span class="job-search-card__location">Brasil</span></li>`);
  const result = await adapter.discover(task);
  expect(result.observations[0]).toMatchObject({
    sourceVacancyId: "123", canonicalUrl: "https://br.linkedin.com/jobs/view/123",
    title: "Desenvolvedor Java Junior", organization: "Empresa", originKind: "real",
  });
});

it("classifies a challenge page as blocked", async () => {
  const result = await adapterWith("<html><title>Security check</title></html>").discover(task);
  expect(result.diagnostics[0]).toMatchObject({ kind: "blocked", message: "challenge_page" });
});
```

- [ ] **Step 2: Run the tests to verify red**

Run: `npm test -- --run tests/adapters/linkedin-guest.test.ts`

Expected: failure because `LinkedInGuestAdapter` does not exist.

- [ ] **Step 3: Implement the smallest adapter**

The adapter must:

```ts
const headers = {
  accept: "text/html",
  "user-agent": "Haadar vacancy discovery",
  "accept-language": "pt-BR,pt;q=0.9",
};
```

- use `fetchBoundedText` with the source limit;
- treat `captcha`, `security check`, `unusual activity`, `verify you are human` (case-insensitive) as `blocked/challenge_page`;
- parse only `<li>` cards containing a numeric `urn:li:jobPosting` and an HTTPS job link on `linkedin.com` or `br.linkedin.com`;
- remove URL query parameters and fragments before persistence;
- use title, company and location only when explicitly present; otherwise retain `undefined` rather than inventing information;
- locally match the existing Query Portfolio, compute `vacancyFingerprint`, and emit `originKind: "real"`;
- return `schema_changed/linkedin_guest_cards_missing` if valid non-challenge HTML contains no recognizable cards.

- [ ] **Step 4: Add and run boundary tests**

Add tests that prove a changed class name, a non-LinkedIn URL and a card without an ID become diagnostics or are ignored. Then run:

```powershell
npm test -- --run tests/adapters/linkedin-guest.test.ts tests/adapters/adapter-contract.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

```powershell
git add src/adapters/linkedin-guest.ts tests/adapters/linkedin-guest.test.ts
git commit -m "feat: add bounded LinkedIn guest adapter"
```

## Task 4: Wire the adapter without activating it

**Files:**
- Modify: `src/index.ts`
- Modify: `tests/integration/queue.test.ts`

**Interfaces:**
- Consumes `source.adapterId === "linkedin-guest"`.
- Produces a `LinkedInGuestAdapter` entry in the existing `adapters` map.

- [ ] **Step 1: Write a failing queue-factory test**

Add a test that temporarily passes one active `linkedin-guest` source to the factory helper and asserts the task reaches the adapter rather than being completed as `missing_adapter`.

- [ ] **Step 2: Run it to verify red**

Run: `npm test -- --run tests/integration/queue.test.ts`

Expected: failure with `missing_adapter`.

- [ ] **Step 3: Extract and implement the adapter factory**

Create a private `createAdapters(sources: SourceDefinition[]): Record<string, SourceAdapter>` in `src/index.ts`. Its final branch must be explicit:

```ts
if (source.adapterId === "linkedin-guest") {
  return new LinkedInGuestAdapter(source, initialQueries);
}
```

Keep `pilotSources.filter((source) => source.active)` unchanged, so no LinkedIn guest task is created in production yet.

- [ ] **Step 4: Run focused and full verification**

```powershell
npm test -- --run tests/integration/queue.test.ts tests/adapters/linkedin-guest.test.ts
npm run check
```

Expected: all tests pass; no new active source tasks are admitted.

- [ ] **Step 5: Commit**

```powershell
git add src/index.ts tests/integration/queue.test.ts
git commit -m "feat: wire inactive LinkedIn guest source"
```

## Task 5: Deploy inactive code and review the activation gate

**Files:**
- Create: `docs/validation/linkedin-guest-pilot.md`

**Interfaces:**
- Produces a checklist containing: deployed version, source IDs, observed task diagnostics, real observations, decisions, alert intents, Telegram deliveries and a removal decision.

- [ ] **Step 1: Create the pre-activation checklist**

The document must begin with these unchecked gates:

```markdown
- [ ] User explicitly approved activation of the three guest searches.
- [ ] All automated tests passed on the exact commit.
- [ ] Production deploy completed with guest sources still inactive.
- [ ] First active hourly round has no `blocked` or `schema_changed` LinkedIn diagnostic.
- [ ] At least one real observation has a valid LinkedIn job URL and explicit entry-level title.
- [ ] No duplicate Telegram delivery was created.
- [ ] Three consecutive blocked or schema-changed rounds trigger source deactivation and review.
```

- [ ] **Step 2: Verify inactive deployment**

```powershell
npm run check
npx wrangler deploy --dry-run --env production
npx wrangler deploy --env production
npx wrangler deployments status --env production
```

Expected: production version is healthy and has no guest tasks because all three sources remain inactive.

- [ ] **Step 3: Commit and push the inactive implementation**

```powershell
git add docs/validation/linkedin-guest-pilot.md
git commit -m "docs: add LinkedIn guest pilot acceptance gates"
git push origin main
```

- [ ] **Step 4: Stop for explicit activation approval**

Do not flip `active` to `true`, do not manually trigger discovery and do not send test alerts in this task. Ask the user to approve activation after reviewing the commit and constraints.

## Activation Is a Separate Follow-up

If the user approves, make one configuration-only commit that changes exactly these three values from `active: false` to `active: true`. Deploy it, wait for normal hourly runs, and record only remote D1/deployment evidence in `docs/validation/linkedin-guest-pilot.md`.

Remove all three definitions in a separate corrective commit if three consecutive hourly rounds return `blocked` or `schema_changed`. Do not add retries beyond existing Queue policy, alternative hosts, session state or identity-avoidance techniques.

## Self-Review

- Scope is limited to the guest endpoint already used by the Python bot; no browser, account or LinkedIn partner API is introduced.
- Every production change has a preceding failing test, focused green test, full suite and an independent commit.
- The reliable sources are protected by inactive-by-default configuration and task-level diagnostics.
- The plan contains no activation or manual trigger without a later direct approval.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-10-01-linkedin-guest-experimental-source.md`.

Two execution options:

1. Subagent-Driven (recommended) — dispatch a fresh subagent per task and review between tasks.
2. Inline Execution — execute the tasks in this session, with checkpoints.

