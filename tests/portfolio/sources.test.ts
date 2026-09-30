import { describe, expect, it } from "vitest";
import { defaultRelevanceProfile, pilotSources } from "../../src/portfolio/sources";
import { initialQueries } from "../../src/portfolio/query-portfolio";

describe("first source contract", () => {
  it("keeps the pilot bounded to one public board request", () => {
    expect(pilotSources).toHaveLength(1);
    expect(pilotSources[0]).toMatchObject({
      id: "greenhouse:planetscale",
      fetchStrategy: "board_once",
      allowedHosts: ["boards-api.greenhouse.io"],
      limits: { maxRequestsPerTask: 1, maxRecords: 200 },
    });
  });

  it("represents every query family without requiring stack in the role query", () => {
    expect(new Set(initialQueries.map((query) => query.family))).toEqual(
      new Set(["BROAD", "ROLE", "STACK", "CONTEXT", "COMPANY", "EXPERIMENTAL"]),
    );
    expect(initialQueries.find((query) => query.family === "ROLE")?.terms).not.toContain("typescript");
    expect(defaultRelevanceProfile.roles).toContain("backend");
  });
});
