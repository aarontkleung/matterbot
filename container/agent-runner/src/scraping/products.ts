import { scrapeUrl } from "./integrations/firecrawl.js";
import { randomUUID } from "crypto";

const PRODUCT_SCRAPE_SESSION_TTL_MS = 60 * 60 * 1000; // 60 minutes
const PRODUCT_SCRAPE_SESSION_MAX_ENTRIES = 1000;

export interface ProductScrapeSessionSnapshot {
  scrapeSessionId: string;
  createdAt: number;
  url: string;
  productName?: string;
  brandName?: string;
  markdown?: string;
  metadata?: Record<string, unknown>;
}

const productScrapeSessionCache = new Map<string, ProductScrapeSessionSnapshot>();

function pruneProductScrapeSessionCache(now: number = Date.now()): void {
  for (const [sessionId, snapshot] of productScrapeSessionCache.entries()) {
    if (now - snapshot.createdAt > PRODUCT_SCRAPE_SESSION_TTL_MS) {
      productScrapeSessionCache.delete(sessionId);
    }
  }

  if (productScrapeSessionCache.size <= PRODUCT_SCRAPE_SESSION_MAX_ENTRIES) return;

  const sortedByCreatedAt = Array.from(productScrapeSessionCache.entries())
    .sort((a, b) => a[1].createdAt - b[1].createdAt);
  const removeCount = productScrapeSessionCache.size - PRODUCT_SCRAPE_SESSION_MAX_ENTRIES;
  for (let i = 0; i < removeCount; i++) {
    const [sessionId] = sortedByCreatedAt[i];
    productScrapeSessionCache.delete(sessionId);
  }
}

export function createProductScrapeSession(
  snapshotInput: Omit<ProductScrapeSessionSnapshot, "scrapeSessionId" | "createdAt">
): string {
  pruneProductScrapeSessionCache();
  const scrapeSessionId = randomUUID();
  productScrapeSessionCache.set(scrapeSessionId, {
    scrapeSessionId,
    createdAt: Date.now(),
    ...snapshotInput,
    metadata: snapshotInput.metadata ? { ...snapshotInput.metadata } : undefined,
  });
  pruneProductScrapeSessionCache();
  return scrapeSessionId;
}

export function getProductScrapeSession(scrapeSessionId: string): ProductScrapeSessionSnapshot | null {
  pruneProductScrapeSessionCache();
  const snapshot = productScrapeSessionCache.get(scrapeSessionId);
  if (!snapshot) return null;

  if (Date.now() - snapshot.createdAt > PRODUCT_SCRAPE_SESSION_TTL_MS) {
    productScrapeSessionCache.delete(scrapeSessionId);
    return null;
  }

  return {
    ...snapshot,
    metadata: snapshot.metadata ? { ...snapshot.metadata } : undefined,
  };
}

export async function executeListProductsByBrand(args: {
  brandSlug: string;
  brandUrl?: string;
  limit?: number;
}): Promise<string> {
  const { brandSlug, brandUrl, limit = 50 } = args;

  const url = brandUrl || `https://www.architonic.com/en/microsite/${brandSlug}/products`;

  try {
    const result = await scrapeUrl(url);
    return JSON.stringify({
      success: true,
      url,
      brandSlug,
      limit,
      markdown: result.markdown,
      metadata: result.metadata,
      instructions:
        "Parse the markdown to extract product names and URLs. Look for product listings with links to individual product pages.",
    });
  } catch (error) {
    return JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function executeScrapeProduct(args: {
  url: string;
  productName?: string;
  brandName?: string;
}): Promise<string> {
  const { url, productName, brandName } = args;

  try {
    const result = await scrapeUrl(url);
    const scrapeSessionId = createProductScrapeSession({
      url,
      productName,
      brandName,
      markdown: result.markdown,
      metadata: result.metadata,
    });

    return JSON.stringify({
      success: true,
      url,
      productName,
      brandName,
      scrapeSessionId,
      markdown: result.markdown,
      metadata: result.metadata,
      instructions:
        "Extract product details: name, description, category, subcategory, images, specifications, materials, and dimensions. Keep scrapeSessionId for upcoming server-side provenance enforcement in product saves.",
    });
  } catch (error) {
    return JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
