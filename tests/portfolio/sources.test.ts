import { describe, expect, it } from "vitest";
import { defaultRelevanceProfile, githubIssuesSources, gupySources, linkedinGuestSources, pilotSources, tramposSources } from "../../src/portfolio/sources";
import { initialQueries } from "../../src/portfolio/query-portfolio";

describe("public source contracts", () => {
  it("keeps every source bounded to one public board request", () => {
    expect(pilotSources).toHaveLength(18);
    expect(pilotSources[0]).toMatchObject({
      id: "greenhouse:planetscale",
      fetchStrategy: "board_once",
      allowedHosts: ["boards-api.greenhouse.io"],
      limits: { maxRequestsPerTask: 1, maxRecords: 200 },
    });
    expect(githubIssuesSources).toHaveLength(7);
    expect(gupySources).toHaveLength(3);
    expect(tramposSources).toHaveLength(1);
    expect(githubIssuesSources).toEqual(expect.arrayContaining([
      expect.objectContaining({
        adapterId: "github-issues",
        allowedHosts: ["api.github.com"],
        limits: expect.objectContaining({ maxRequestsPerTask: 1, maxRecords: 50 }),
      }),
    ]));
  });

  it("represents every query family without requiring stack in the role query", () => {
    expect(new Set(initialQueries.map((query) => query.family))).toEqual(
      new Set(["BROAD", "ROLE", "STACK", "CONTEXT", "COMPANY", "EXPERIMENTAL"]),
    );
    expect(initialQueries.find((query) => query.family === "ROLE")?.terms).not.toContain("typescript");
    expect(defaultRelevanceProfile.roles).toContain("backend");
  });

  it("keeps LinkedIn guest discovery tightly bounded", () => {
    expect(linkedinGuestSources.map((source) => source.keywords)).toEqual([
      "Desenvolvedor Java Junior",
      "Desenvolvedor Node Junior",
      "Desenvolvedor Full Stack Junior",
    ]);
    expect(linkedinGuestSources.every((source) => source.active)).toBe(true);
    expect(linkedinGuestSources.every((source) => source.limits.maxRequestsPerTask === 1)).toBe(true);
    expect(linkedinGuestSources.map((source) => source.dispatchDelaySeconds)).toEqual([0, 180, 360]);
  });
});
