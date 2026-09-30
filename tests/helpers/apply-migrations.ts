import { env } from "cloudflare:workers";
import { applyD1Migrations, type D1Migration } from "cloudflare:test";
import { beforeAll } from "vitest";
import type { EnrichmentWorkflowParams } from "../../src/workflows/enrichment";

declare global {
  namespace Cloudflare {
    interface Env {
      DB: D1Database;
      TEST_MIGRATIONS: D1Migration[];
      ENRICHMENT_WORKFLOW: Workflow<EnrichmentWorkflowParams>;
    }
  }
}

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});
