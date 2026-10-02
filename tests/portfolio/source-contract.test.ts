import { describe, expect, it } from "vitest";
import { sourceContracts, validateSourceContract, validateSourceContracts } from "../../src/portfolio/source-contract";
import { pilotSources, type SourceDefinition } from "../../src/portfolio/sources";

function invalidSource(overrides: Record<string, unknown>): SourceDefinition {
  return { ...pilotSources[0], ...overrides } as SourceDefinition;
}

describe("source contract validation", () => {
  it("validates every configured public source", () => {
    expect(() => validateSourceContracts(pilotSources)).not.toThrow();
    for (const source of pilotSources) expect(() => validateSourceContract(source)).not.toThrow();
  });

  it("declares the public contract for every configured adapter", () => {
    for (const source of pilotSources) {
      expect(sourceContracts[source.adapterId]).toMatchObject({
        access: "public", fetchStrategy: "board_once", maxRequestsPerTask: 1,
      });
    }
    expect(sourceContracts.greenhouse.kind).toBe("public_json");
    expect(sourceContracts.trampos.kind).toBe("public_html");
    expect(sourceContracts["google-news-rss"].kind).toBe("public_rss");
  });

  it.each([
    ["allowedHosts", { allowedHosts: [] }],
    ["allowedHosts", { allowedHosts: [" "] }],
    ["adapterId", { adapterId: "unknown" }],
    ["fetchStrategy", { fetchStrategy: "per_query" }],
    ["maxRequestsPerTask", { limits: { ...pilotSources[0].limits, maxRequestsPerTask: 2 } }],
    ["maxRequestsPerTask", { limits: { ...pilotSources[0].limits, maxRequestsPerTask: 0 } }],
    ["timeoutMs", { limits: { ...pilotSources[0].limits, timeoutMs: 0 } }],
    ["maxResponseBytes", { limits: { ...pilotSources[0].limits, maxResponseBytes: Infinity } }],
    ["maxRecords", { limits: { ...pilotSources[0].limits, maxRecords: -1 } }],
  ])("rejects an invalid %s with a clear RangeError", (field, overrides) => {
    expect(() => validateSourceContract(invalidSource(overrides))).toThrow(RangeError);
    expect(() => validateSourceContract(invalidSource(overrides))).toThrow(field);
  });

  it.each([
    undefined,
    { minimumBaselineSamples: 0, baselineWindow: 10, anomalyAtOrBelow: 0 },
    { minimumBaselineSamples: 3, baselineWindow: 0, anomalyAtOrBelow: 0 },
    { minimumBaselineSamples: 3, baselineWindow: 2, anomalyAtOrBelow: 0 },
    { minimumBaselineSamples: 3.5, baselineWindow: 10, anomalyAtOrBelow: 0 },
    { minimumBaselineSamples: 3, baselineWindow: NaN, anomalyAtOrBelow: 0 },
    { minimumBaselineSamples: 3, baselineWindow: 10, anomalyAtOrBelow: -1 },
    { minimumBaselineSamples: 3, baselineWindow: 10, anomalyAtOrBelow: Infinity },
  ])("rejects an invalid canary policy: %j", (canaryPolicy) => {
    expect(() => validateSourceContract(invalidSource({ canaryPolicy }))).toThrow(RangeError);
    expect(() => validateSourceContract(invalidSource({ canaryPolicy }))).toThrow("canaryPolicy");
  });

  it("validates every entry in a batch", () => {
    expect(() => validateSourceContracts([pilotSources[0], invalidSource({ allowedHosts: [] })])).toThrow(RangeError);
    expect(() => validateSourceContracts([])).not.toThrow();
  });
});
