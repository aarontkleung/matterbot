import FirecrawlApp from "@mendable/firecrawl-js";

let firecrawlClient: FirecrawlApp | null = null;

export function getFirecrawlClient(): FirecrawlApp {
  if (!firecrawlClient) {
    const apiKey = process.env.FIRECRAWL_API_KEY;
    if (!apiKey) {
      throw new Error("FIRECRAWL_API_KEY environment variable not set");
    }
    firecrawlClient = new FirecrawlApp({ apiKey });
  }
  return firecrawlClient;
}

export interface ScrapeResult {
  markdown?: string;
  html?: string;
  rawHtml?: string;
  links?: string[];
  metadata?: {
    title?: string;
    description?: string;
    ogImage?: string;
    [key: string]: unknown;
  };
}

export type ScrapeAction =
  | { type: "wait"; milliseconds: number }
  | { type: "wait"; selector: string }
  | { type: "click"; selector: string }
  | { type: "write"; text: string }
  | { type: "scroll"; direction: "up" | "down" };

export interface ScrapeOptions {
  formats?: ("markdown" | "html" | "rawHtml" | "links")[];
  actions?: ScrapeAction[];
  waitFor?: number;
}

export async function scrapeUrl(
  url: string,
  options?: ScrapeOptions
): Promise<ScrapeResult> {
  const client = getFirecrawlClient();
  const result = await client.scrapeUrl(url, {
    formats: options?.formats ?? ["markdown", "html", "rawHtml", "links"],
    onlyMainContent: false,
    actions: options?.actions,
    waitFor: options?.waitFor,
  });

  if (!result.success) {
    throw new Error(`Failed to scrape ${url}: ${result.error || "Unknown error"}`);
  }

  return {
    markdown: result.markdown,
    html: result.html,
    rawHtml: (result as { rawHtml?: string }).rawHtml,
    links: result.links,
    metadata: result.metadata,
  };
}

export async function crawlUrls(
  baseUrl: string,
  options?: {
    maxPages?: number;
    includePaths?: string[];
    excludePaths?: string[];
  }
): Promise<ScrapeResult[]> {
  const client = getFirecrawlClient();
  const result = await client.crawlUrl(baseUrl, {
    limit: options?.maxPages || 10,
    includePaths: options?.includePaths,
    excludePaths: options?.excludePaths,
    scrapeOptions: {
      formats: ["markdown"],
    },
  });

  if (!result.success) {
    throw new Error(`Failed to crawl ${baseUrl}: ${result.error || "Unknown error"}`);
  }

  return (result.data || []).map((page) => ({
    markdown: page.markdown,
    html: page.html,
    metadata: page.metadata,
  }));
}
