import { describe, expect, it } from "vitest";
import { QueryPortfolio } from "../../src/portfolio/query-portfolio";
import type { QueryDefinition } from "../../src/domain/types";

const queries: QueryDefinition[] = [
  { id: "experimental", revision: "1", family: "EXPERIMENTAL", terms: ["new"], exclusions: [], priority: 1, estimatedCost: 1, active: true },
  { id: "role", revision: "1", family: "ROLE", terms: ["backend"], exclusions: [], priority: 10, estimatedCost: 1, active: true },
  { id: "cooldown", revision: "1", family: "BROAD", terms: ["software"], exclusions: [], priority: 20, estimatedCost: 1, active: true, cooldownUntil: "2026-10-01T00:00:00.000Z" },
  { id: "disabled", revision: "1", family: "STACK", terms: ["typescript"], exclusions: [], priority: 30, estimatedCost: 1, active: false }
];

describe("Query Portfolio", () => {
  it("orders active eligible queries by priority", () => {
    const portfolio = new QueryPortfolio("portfolio-1", queries);
    expect(portfolio.activeRevision()).toBe("portfolio-1");
    expect(portfolio.admit({ now: "2026-09-30T00:00:00.000Z", allowExperimental: false }).map((q) => q.id)).toEqual(["role"]);
  });
});
