/**
 * Hunter.io API Client
 * Simplified client for domain search / contact discovery.
 * Includes inline rate limiting, retry, and in-memory caching.
 */

export interface HunterEmailResult {
  email: string;
  firstName: string | null;
  lastName: string | null;
  position: string | null;
  confidence: number;
  type: "personal" | "generic";
  linkedin?: string;
  twitter?: string;
  phone_number?: string;
  verified?: boolean;
  verification_status?: string;
}

export interface HunterDomainSearchResult {
  domain: string;
  organization: string | null;
  emails: HunterEmailResult[];
  webmailProvider: boolean;
  pattern?: string;
  linkedDomains?: string[];
}

interface RawHunterEmailResult {
  email?: string | null;
  value?: string | null;
  firstName?: string | null;
  first_name?: string | null;
  lastName?: string | null;
  last_name?: string | null;
  position?: string | null;
  confidence?: number | string | null;
  type?: string | null;
  linkedin?: string | null;
  twitter?: string | null;
  phone_number?: string | null;
  phoneNumber?: string | null;
  verified?: boolean | string | number | null;
  verification?:
    | {
        status?: string | null;
        date?: string | null;
      }
    | string
    | null;
  verification_status?: string | null;
  status?: string | null;
}

interface RawHunterDomainSearchResult {
  domain?: string | null;
  organization?: string | null;
  emails?: RawHunterEmailResult[] | null;
  webmailProvider?: boolean | null;
  webmail_provider?: boolean | null;
  webmail?: boolean | null;
  pattern?: string | null;
  linkedDomains?: string[] | null;
  linked_domains?: string[] | null;
}

// ---------------------------------------------------------------------------
// Rate limiting (10 requests / minute)
// ---------------------------------------------------------------------------

interface RateLimitState {
  requestsThisMinute: number;
  minuteStartTime: number;
  maxRequestsPerMinute: number;
}

const rateLimitState: RateLimitState = {
  requestsThisMinute: 0,
  minuteStartTime: Date.now(),
  maxRequestsPerMinute: 10,
};

function checkRateLimit(): void {
  const now = Date.now();
  const oneMinute = 60_000;

  if (now - rateLimitState.minuteStartTime >= oneMinute) {
    rateLimitState.requestsThisMinute = 0;
    rateLimitState.minuteStartTime = now;
  }

  if (rateLimitState.requestsThisMinute >= rateLimitState.maxRequestsPerMinute) {
    const waitMs = oneMinute - (now - rateLimitState.minuteStartTime);
    throw new Error(
      `Hunter.io rate limit reached (${rateLimitState.maxRequestsPerMinute}/min). Wait ${Math.ceil(waitMs / 1000)}s.`
    );
  }

  rateLimitState.requestsThisMinute++;
}

// ---------------------------------------------------------------------------
// In-memory cache (7-day TTL)
// ---------------------------------------------------------------------------

interface CacheEntry<T> {
  data: T;
  expiry: number;
}

const cache = new Map<string, CacheEntry<unknown>>();
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const DEFAULT_DOMAIN_SEARCH_LIMIT = 50;
const FALLBACK_DOMAIN_SEARCH_LIMIT = 10;
let domainSearchSessionLimitCap: number | undefined;

function getCached<T>(key: string): T | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiry) {
    cache.delete(key);
    return null;
  }
  return entry.data as T;
}

function setCache<T>(key: string, data: T): void {
  cache.set(key, { data, expiry: Date.now() + CACHE_TTL_MS });
}

function toNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function toOptionalNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function toOptionalBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (value === 1) return true;
    if (value === 0) return false;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "y"].includes(normalized)) return true;
    if (["false", "0", "no", "n"].includes(normalized)) return false;
  }
  return undefined;
}

function normalizeHunterEmailType(value: unknown): "personal" | "generic" {
  return value === "personal" ? "personal" : "generic";
}

function normalizeVerificationStatus(raw: RawHunterEmailResult): string | undefined {
  const fromVerificationObject =
    typeof raw.verification === "object" && raw.verification
      ? toNonEmptyString(raw.verification.status)
      : undefined;

  const status = toNonEmptyString(raw.verification_status ?? fromVerificationObject ?? raw.status);
  if (!status) return undefined;
  const normalized = status.toLowerCase();
  if (normalized === "valid" || normalized === "accept_all" || normalized === "unknown") {
    return normalized;
  }
  return undefined;
}

function normalizeVerified(raw: RawHunterEmailResult, verificationStatus: string | undefined): boolean | undefined {
  const explicitVerified = toOptionalBoolean(raw.verified);
  if (explicitVerified !== undefined) return explicitVerified;
  if (!verificationStatus) return undefined;

  if (verificationStatus === "valid") return true;
  return undefined;
}

function normalizeHunterEmailResult(raw: RawHunterEmailResult): HunterEmailResult | null {
  const email = toNonEmptyString(raw.email ?? raw.value)?.toLowerCase();
  if (!email) return null;
  const verificationStatus = normalizeVerificationStatus(raw);
  const verified = normalizeVerified(raw, verificationStatus);

  return {
    email,
    firstName: toNonEmptyString(raw.firstName ?? raw.first_name) ?? null,
    lastName: toNonEmptyString(raw.lastName ?? raw.last_name) ?? null,
    position: toNonEmptyString(raw.position) ?? null,
    confidence: toOptionalNumber(raw.confidence) ?? 0,
    type: normalizeHunterEmailType(raw.type),
    linkedin: toNonEmptyString(raw.linkedin),
    twitter: toNonEmptyString(raw.twitter),
    phone_number: toNonEmptyString(raw.phone_number ?? raw.phoneNumber),
    verified,
    verification_status: verificationStatus,
  };
}

function normalizeHunterDomainSearchResult(
  raw: RawHunterDomainSearchResult,
  requestedDomain: string,
): HunterDomainSearchResult {
  const domain = toNonEmptyString(raw.domain)?.toLowerCase() || requestedDomain.toLowerCase();
  const emails = (raw.emails || [])
    .map((entry) => normalizeHunterEmailResult(entry))
    .filter((entry): entry is HunterEmailResult => entry !== null);

  return {
    domain,
    organization: toNonEmptyString(raw.organization) ?? null,
    emails,
    webmailProvider:
      raw.webmailProvider ??
      raw.webmail_provider ??
      raw.webmail ??
      false,
    pattern: toNonEmptyString(raw.pattern),
    linkedDomains:
      (Array.isArray(raw.linkedDomains) ? raw.linkedDomains : raw.linked_domains)?.filter(
        (domainValue): domainValue is string => typeof domainValue === "string" && domainValue.trim().length > 0,
      ) || undefined,
  };
}

class HunterApiError extends Error {
  readonly status: number;
  readonly retryable: boolean;

  constructor(message: string, status: number, retryable: boolean) {
    super(message);
    this.name = "HunterApiError";
    this.status = status;
    this.retryable = retryable;
  }
}

// ---------------------------------------------------------------------------
// Retry helper (inline, 3 retries with exponential backoff)
// ---------------------------------------------------------------------------

async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 3,
  baseDelayMs = 1000
): Promise<T> {
  let lastError: Error | undefined;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (lastError instanceof HunterApiError && !lastError.retryable) {
        throw lastError;
      }
      if (attempt < maxRetries) {
        const delay = baseDelayMs * 2 ** attempt;
        console.log(
          `[hunter] Retry ${attempt + 1}/${maxRetries} in ${delay}ms: ${lastError.message}`
        );
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }
  throw lastError;
}

// ---------------------------------------------------------------------------
// HunterClient
// ---------------------------------------------------------------------------

export class HunterClient {
  private readonly baseUrl = "https://api.hunter.io/v2";
  private readonly apiKey: string;
  private readonly timeout: number;

  constructor(options: { apiKey?: string; timeout?: number } = {}) {
    this.apiKey = options.apiKey || process.env.HUNTER_API_KEY || "";
    this.timeout = options.timeout || 30_000;

    if (!this.apiKey) {
      console.log("[hunter] API key not configured");
    }
  }

  /** Check whether the client has a valid API key. */
  isConfigured(): boolean {
    return !!this.apiKey;
  }

  /** Make an authenticated GET request with retry + rate limiting. */
  private async request<T>(
    endpoint: string,
    params: Record<string, string | number | undefined> = {}
  ): Promise<T | null> {
    if (!this.apiKey) {
      console.error("[hunter] API key not configured");
      return null;
    }

    const url = new URL(`${this.baseUrl}${endpoint}`);
    url.searchParams.set("api_key", this.apiKey);

    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    }

    return withRetry(async () => {
      checkRateLimit();

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);

      try {
        const response = await fetch(url.toString(), {
          signal: controller.signal,
          headers: { Accept: "application/json" },
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          let apiMessage = response.statusText || "Unknown error";
          try {
            const errorData = (await response.json()) as {
              errors?: Array<{ details: string }>;
              message?: string;
              error?: string;
            };
            apiMessage =
              errorData.errors?.[0]?.details ||
              errorData.message ||
              errorData.error ||
              apiMessage;
          } catch {
            // Keep status text fallback if response body is not JSON.
          }

          const retryable = response.status === 429 || response.status >= 500;
          throw new HunterApiError(
            `Hunter.io API error (${response.status}): ${apiMessage}`,
            response.status,
            retryable,
          );
        }

        const data = (await response.json()) as { data: T };
        return data.data;
      } finally {
        clearTimeout(timeoutId);
      }
    });
  }

  /** Search for email addresses at a domain. */
  async domainSearch(
    domain: string,
    options: {
      limit?: number;
      type?: "personal" | "generic";
      department?: string;
    } = {}
  ): Promise<HunterDomainSearchResult | null> {
    const normalizedDomain = domain.trim().toLowerCase();
    const sessionCap = domainSearchSessionLimitCap ?? DEFAULT_DOMAIN_SEARCH_LIMIT;
    const requestedLimit = Math.min(options.limit || DEFAULT_DOMAIN_SEARCH_LIMIT, sessionCap);
    const cacheKey = `hunter:v2:domain:${normalizedDomain}:${requestedLimit}:${options.type ?? ""}`;
    const cached = getCached<RawHunterDomainSearchResult | HunterDomainSearchResult>(cacheKey);
    if (cached) {
      console.log(`[hunter] Cache hit: ${cacheKey}`);
      return normalizeHunterDomainSearchResult(cached as RawHunterDomainSearchResult, normalizedDomain);
    }

    console.log(`[hunter] Domain search: ${normalizedDomain}`);

    let result: RawHunterDomainSearchResult | null = null;
    try {
      result = await this.request<RawHunterDomainSearchResult>(
        "/domain-search",
        {
          domain: normalizedDomain,
          limit: requestedLimit,
          type: options.type,
          department: options.department,
        }
      );
    } catch (error) {
      if (
        error instanceof HunterApiError &&
        error.status === 400 &&
        requestedLimit > FALLBACK_DOMAIN_SEARCH_LIMIT
      ) {
        domainSearchSessionLimitCap = FALLBACK_DOMAIN_SEARCH_LIMIT;
        console.warn(
          `[hunter] Domain search limit ${requestedLimit} rejected by Hunter; retrying with ${FALLBACK_DOMAIN_SEARCH_LIMIT}.`
        );
        result = await this.request<RawHunterDomainSearchResult>(
          "/domain-search",
          {
            domain: normalizedDomain,
            limit: FALLBACK_DOMAIN_SEARCH_LIMIT,
            type: options.type,
            department: options.department,
          }
        );
      } else {
        throw error;
      }
    }

    if (!result) return null;

    const normalized = normalizeHunterDomainSearchResult(result, normalizedDomain);
    setCache(cacheKey, normalized);
    return normalized;
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let hunterClient: HunterClient | null = null;

export function getHunterClient(): HunterClient {
  if (!hunterClient) {
    hunterClient = new HunterClient();
  }
  return hunterClient;
}
