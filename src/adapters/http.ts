import type { AdapterFailureKind } from "./adapter";

export class AdapterHttpError extends Error {
  constructor(
    readonly kind: AdapterFailureKind,
    message: string,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "AdapterHttpError";
  }
}

export interface BoundedFetchOptions {
  allowedHosts: string[];
  timeoutMs: number;
  maxBytes: number;
  maxRedirects?: number;
  headers?: HeadersInit;
  fetcher?: typeof fetch;
}

export async function fetchBoundedJson(url: string, options: BoundedFetchOptions): Promise<unknown> {
  const fetcher = options.fetcher ?? fetch;
  let current = validateUrl(url, options.allowedHosts);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort("adapter_timeout"), options.timeoutMs);
  try {
    for (let redirects = 0; ; redirects += 1) {
      let response: Response;
      try {
        response = await fetcher(current, {
          method: "GET",
          redirect: "manual",
          signal: controller.signal,
          headers: { accept: "application/json", ...options.headers },
        });
      } catch (error) {
        if (controller.signal.aborted) throw new AdapterHttpError("retryable", "request_timeout");
        throw new AdapterHttpError("retryable", error instanceof Error ? error.name : "network_error");
      }

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location) throw new AdapterHttpError("schema_changed", "redirect_without_location");
        if (redirects >= (options.maxRedirects ?? 0)) throw new AdapterHttpError("blocked", "redirect_limit_exceeded");
        current = validateUrl(new URL(location, current).toString(), options.allowedHosts);
        continue;
      }
      if (response.status === 429) {
        throw new AdapterHttpError("throttled", "rate_limited", parseRetryAfter(response.headers.get("retry-after")));
      }
      if (response.status === 401 || response.status === 403) throw new AdapterHttpError("blocked", `http_${response.status}`);
      if (response.status === 404) throw new AdapterHttpError("permanent", "board_not_found");
      if (response.status >= 500) throw new AdapterHttpError("retryable", `http_${response.status}`);
      if (!response.ok) throw new AdapterHttpError("permanent", `http_${response.status}`);

      const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
      if (!contentType.includes("application/json")) throw new AdapterHttpError("schema_changed", "unexpected_content_type");
      const text = await readBoundedBody(response, options.maxBytes);
      try {
        return JSON.parse(text);
      } catch {
        throw new AdapterHttpError("schema_changed", "invalid_json");
      }
    }
  } finally {
    clearTimeout(timeout);
  }
}

async function readBoundedBody(response: Response, maxBytes: number): Promise<string> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) throw new AdapterHttpError("permanent", "response_too_large");
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new AdapterHttpError("permanent", "response_too_large");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

function validateUrl(value: string, allowedHosts: string[]): URL {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || !allowedHosts.includes(url.hostname)) {
    throw new AdapterHttpError("blocked", "url_not_allowed");
  }
  return url;
}

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isInteger(seconds) && seconds >= 0) return Math.min(seconds, 3_600);
  const date = Date.parse(value);
  if (!Number.isFinite(date)) return undefined;
  return Math.max(0, Math.min(3_600, Math.ceil((date - Date.now()) / 1_000)));
}
