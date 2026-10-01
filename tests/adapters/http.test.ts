import { describe, expect, it } from "vitest";
import { fetchBoundedText } from "../../src/adapters/http";

const options = {
  allowedHosts: ["www.linkedin.com"],
  timeoutMs: 100,
  maxBytes: 1_024,
};

describe("bounded text transport", () => {
  it("accepts bounded HTML from an approved host", async () => {
    await expect(fetchBoundedText("https://www.linkedin.com/jobs", {
      ...options,
      fetcher: async () => new Response("<article>job</article>", {
        headers: { "content-type": "text/html; charset=utf-8" },
      }),
    })).resolves.toBe("<article>job</article>");
  });

  it("rejects unexpected content types", async () => {
    await expect(fetchBoundedText("https://www.linkedin.com/jobs", {
      ...options,
      fetcher: async () => new Response('{"unexpected":true}', {
        headers: { "content-type": "application/json" },
      }),
    })).rejects.toMatchObject({ kind: "schema_changed", message: "unexpected_content_type" });
  });

  it("preserves host and response-size protections", async () => {
    await expect(fetchBoundedText("https://evil.example/jobs", options))
      .rejects.toMatchObject({ kind: "blocked", message: "url_not_allowed" });

    await expect(fetchBoundedText("https://www.linkedin.com/jobs", {
      ...options,
      maxBytes: 5,
      fetcher: async () => new Response("too large", { headers: { "content-type": "text/html" } }),
    })).rejects.toMatchObject({ kind: "permanent", message: "response_too_large" });
  });
});
