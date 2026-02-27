import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { executeScrapingTool } from "./tool-router.js";

function handler(toolName: string) {
  return async (args: Record<string, unknown>) => {
    const result = await executeScrapingTool(toolName, args);
    return { content: [{ type: "text" as const, text: result }] };
  };
}

export function buildScrapingMcpServer() {
  return createSdkMcpServer({
    name: "scraping-tools",
    version: "1.0.0",
    tools: [
      // --- Brand tools ---
      tool(
        "list_brands",
        "Scrape brand list from Architonic using Firecrawl. Returns ~48 brands per page. Use the 'page' parameter to paginate through results (68 pages total, ~3,264 brands). For getting brands to scrape details, use list_brands_from_index which queries the pre-populated Notion index.",
        {
          criteria: z
            .enum(["most_popular", "by_category"])
            .describe(
              'Criteria for selecting brands: "most_popular" (default, all brands sorted by popularity), or "by_category" (requires category param)',
            ),
          category: z
            .string()
            .optional()
            .describe(
              "Category name when using by_category criteria (e.g., 'furniture', 'lighting')",
            ),
          page: z
            .number()
            .optional()
            .describe(
              "Page number to fetch (1-68, default: 1). Each page has ~48 brands.",
            ),
          forceRefresh: z
            .boolean()
            .optional()
            .describe(
              "Force a fresh scrape, bypassing the cache (default: false)",
            ),
        },
        handler("list_brands"),
      ),

      tool(
        "scrape_brand",
        "Scrape detailed information about a single brand from its Architonic page. Returns comprehensive brand data plus a scrapeSessionId and contactDetails (preferred source for primary contact). save_brand_to_notion enforces provenance: reuse scrapeSessionId + architonicUrl from this response; do not re-scrape unless save returns a provenance error.",
        {
          url: z
            .string()
            .describe("The Architonic URL of the brand page to scrape"),
          brandName: z
            .string()
            .optional()
            .describe("The name of the brand (for reference)"),
        },
        handler("scrape_brand"),
      ),

      // --- Product tools ---
      tool(
        "list_products_by_brand",
        "Get all product URLs for a specific brand from Architonic. Returns product names and URLs for further scraping.",
        {
          brandSlug: z
            .string()
            .describe(
              "The brand slug/identifier on Architonic (e.g., 'vitra' for Vitra)",
            ),
          brandUrl: z
            .string()
            .optional()
            .describe("The Architonic URL of the brand's products page"),
          limit: z
            .number()
            .optional()
            .describe("Maximum number of products to return (default: 50)"),
        },
        handler("list_products_by_brand"),
      ),

      tool(
        "scrape_product",
        "Scrape detailed information about a single product from its Architonic page. Returns full product specs plus scrapeSessionId (scaffold for upcoming product save provenance enforcement).",
        {
          url: z
            .string()
            .describe("The Architonic URL of the product page to scrape"),
          productName: z
            .string()
            .optional()
            .describe("The name of the product (for reference)"),
          brandName: z
            .string()
            .optional()
            .describe("The brand name (for reference)"),
        },
        handler("scrape_product"),
      ),

      // --- Notion tools ---
      tool(
        "check_brand_exists_in_notion",
        "Check if a brand already exists in the Notion database by name. Returns { exists: true/false, pageId?: string }.",
        {
          brandName: z.string().describe("The brand name to search for"),
        },
        handler("check_brand_exists_in_notion"),
      ),

      tool(
        "update_brand_notion_matterbase_id",
        "Update a Notion brand page with its Matterbase database ID. Usually this is done automatically by matterbase_create_brand; use this as a fallback/recovery tool if auto-linking fails or for manual fixes. Automatically creates the 'Matterbase ID' column on first use.",
        {
          notionPageId: z
            .string()
            .describe("Notion page ID returned by save_brand_to_notion"),
          matterbaseId: z
            .string()
            .describe(
              "The matterbaseId field returned by matterbase_create_brand. Use the exact matterbaseId value — do NOT use the brand name, slug, or Architonic ID.",
            ),
        },
        handler("update_brand_notion_matterbase_id"),
      ),

      tool(
        "matterbase_create_brand",
        "Create a Matterbase brand using the canonical payload captured by save_brand_to_notion. Enforced source: pass only notionPageId from save_brand_to_notion; do not pass scraped brand fields. On success, this tool also auto-updates the Notion page's Matterbase ID.",
        {
          notionPageId: z
            .string()
            .describe("Notion page ID returned by save_brand_to_notion"),
        },
        handler("matterbase_create_brand"),
      ),

      tool(
        "save_brand_to_notion",
        "Save a new brand to the Notion database using strict provenance validation. Requires scrapeSessionId from scrape_brand. Scraped fields are derived server-side from the scrape session and cached deterministic extracts; pass only allowed enrichment fields. Primary contact should come from scrape_brand contactDetails, while Hunter contacts belong in hunterContacts enrichment. If hunterContacts is omitted, save_brand_to_notion automatically tries Hunter domain lookup from scraped website when HUNTER_API_KEY is configured. This tool also snapshots the canonical Matterbase create payload used later by matterbase_create_brand. If non-retryable required fields are missing for Matterbase creation (e.g. website), it archives the saved Notion attempt, marks the index status as failed, and returns MATTERBASE_CREATE_NON_RETRYABLE_MISSING_FIELDS.",
        {
          name: z.string().describe("Brand name (required)"),
          architonicUrl: z
            .string()
            .describe(
              "Architonic source URL (required, must match scrapeSessionId source URL)",
            ),
          scrapeSessionId: z
            .string()
            .describe("Required scrape session ID returned by scrape_brand"),
          countryCode: z
            .string()
            .optional()
            .describe(
              'Optional enrichment: two-letter country code, e.g., "DE", "US", "IT"',
            ),
          countryName: z
            .string()
            .optional()
            .describe(
              "Optional enrichment for Matterbase create payload (country display name)",
            ),
          companyName: z
            .string()
            .optional()
            .describe(
              "Optional enrichment for Matterbase create payload (defaults to brand name)",
            ),
          productType: z
            .array(z.enum(["material", "furniture", "lighting", "hardware"]))
            .optional()
            .describe("Optional enrichment for Matterbase create payload"),
          excludedCountries: z
            .array(
              z.object({
                code: z.string().describe("Country code"),
                name: z.string().describe("Country name"),
              }),
            )
            .optional()
            .describe("Optional enrichment for Matterbase create payload"),
          isDisabled: z
            .boolean()
            .optional()
            .describe(
              "Optional enrichment for Matterbase create payload (defaults to true)",
            ),
          contactName: z
            .string()
            .optional()
            .describe(
              "Optional enrichment fallback only when scrape_brand contactDetails has no primary contact name",
            ),
          contactJobTitle: z
            .string()
            .optional()
            .describe(
              "Optional enrichment fallback only when scrape_brand contactDetails has no primary contact title",
            ),
          contactEmail: z
            .string()
            .optional()
            .describe(
              "Optional enrichment fallback only when scrape_brand contactDetails has no primary contact email",
            ),
          hunterContacts: z
            .array(
              z.object({
                email: z.string().describe("Email address"),
                firstName: z.string().optional().describe("First name"),
                lastName: z.string().optional().describe("Last name"),
                position: z.string().optional().describe("Job title / position"),
                confidence: z
                  .number()
                  .optional()
                  .describe("Confidence score 0-100"),
                type: z
                  .enum(["personal", "generic"])
                  .optional()
                  .describe('"personal" or "generic"'),
                linkedin: z.string().optional().describe("LinkedIn profile URL"),
                phone: z.string().optional().describe("Phone number"),
                verified: z
                  .boolean()
                  .optional()
                  .describe("Whether Hunter marks this email as verified"),
                verificationStatus: z
                  .string()
                  .optional()
                  .describe(
                    "Hunter verification status (for example: valid, accept_all, invalid)",
                  ),
              }),
            )
            .optional()
            .describe(
              "Hunter.io contacts to save as an inline child database (sub-table) on the brand page; enrichment only, not the primary contact source",
            ),
          // Explicitly forbidden scraped fields (must come from scrapeSessionId snapshot)
          website: z.never().optional(),
          logoUrl: z.never().optional(),
          architonicId: z.never().optional(),
          companyType: z.never().optional(),
          street: z.never().optional(),
          city: z.never().optional(),
          postalCode: z.never().optional(),
          phone: z.never().optional(),
          email: z.never().optional(),
          latitude: z.never().optional(),
          longitude: z.never().optional(),
          facebook: z.never().optional(),
          instagram: z.never().optional(),
          pinterest: z.never().optional(),
          description: z.never().optional(),
          collections: z.never().optional(),
          catalogs: z.never().optional(),
          distributors: z.never().optional(),
          headerImageUrl: z.never().optional(),
          aboutImageUrl: z.never().optional(),
          stories: z.never().optional(),
          similarBrands: z.never().optional(),
        },
        handler("save_brand_to_notion"),
      ),

      // --- Brand Index tools ---
      tool(
        "list_brands_from_index",
        "Query the Architonic Brand Index in Notion to get a list of brands. This is the preferred way to get brands for scraping - it doesn't use Firecrawl credits. Filter by status to get pending brands that haven't been scraped yet.",
        {
          status: z
            .enum(["pending", "scraped", "failed", "skipped"])
            .optional()
            .describe(
              'Filter by scraping status: "pending" (not yet scraped), "scraped" (successfully imported), "failed" (scraping failed), "skipped" (intentionally skipped)',
            ),
          limit: z
            .number()
            .optional()
            .describe("Maximum number of brands to return (default: 50)"),
        },
        handler("list_brands_from_index"),
      ),

      tool(
        "update_brand_index_status",
        "Update the status of a brand in the Architonic Brand Index after scraping. Use this to mark brands as 'scraped', 'failed', or 'skipped'.",
        {
          architonicId: z
            .string()
            .describe(
              "The Architonic ID of the brand (extracted from URL, e.g., '10001066')",
            ),
          status: z
            .enum(["pending", "scraped", "failed", "skipped"])
            .describe('New status: "pending", "scraped", "failed", "skipped"'),
          notes: z
            .string()
            .optional()
            .describe("Optional notes (e.g., error message if failed)"),
        },
        handler("update_brand_index_status"),
      ),

      tool(
        "add_brands_to_index",
        "Add brands to the Architonic Brand Index in Notion. Use this after scraping the brand list from Architonic with list_brands to populate the index. Brands are added with 'pending' status. Skips brands that already exist in the index (by Architonic ID).",
        {
          brands: z
            .array(
              z.object({
                name: z.string().describe("Brand name"),
                architonicUrl: z
                  .string()
                  .describe(
                    "Full Architonic URL (e.g., https://www.architonic.com/en/b/vitra/10001066)",
                  ),
                architonicId: z
                  .string()
                  .describe(
                    "Architonic ID extracted from URL (e.g., '10001066')",
                  ),
                location: z
                  .string()
                  .optional()
                  .describe(
                    "Location from Architonic (e.g., 'Basel, Switzerland')",
                  ),
                type: z
                  .string()
                  .optional()
                  .describe("Brand type from Architonic (e.g., 'Manufacturer')"),
              }),
            )
            .describe("Array of brands to add to the index"),
        },
        handler("add_brands_to_index"),
      ),

      tool(
        "update_brands_in_index",
        "Update existing brands in the Architonic Brand Index with missing location and type data. Use this to backfill location/type for brands that were added before this data was captured. Only updates fields that are currently empty.",
        {
          brands: z
            .array(
              z.object({
                architonicId: z
                  .string()
                  .describe(
                    "Architonic ID of the brand to update (e.g., '10001066')",
                  ),
                location: z
                  .string()
                  .optional()
                  .describe(
                    "Location from Architonic (e.g., 'Basel, Switzerland')",
                  ),
                type: z
                  .string()
                  .optional()
                  .describe("Brand type from Architonic (e.g., 'Manufacturer')"),
              }),
            )
            .describe("Array of brands to update"),
        },
        handler("update_brands_in_index"),
      ),

      tool(
        "find_unindexed_brands",
        "Find brands from Architonic that are NOT yet in the Notion Brand Index. Scrapes pages from Architonic and returns only brands missing from the index. Fetches all indexed IDs once, then checks multiple pages efficiently.",
        {
          pages: z
            .array(z.number())
            .optional()
            .describe(
              "Architonic page numbers to check (1-68). Default: [1]. Each page has ~48 brands.",
            ),
          checkAll: z
            .boolean()
            .optional()
            .describe(
              "Check all 68 pages. Overrides 'pages' param. Use for full index gap analysis.",
            ),
        },
        handler("find_unindexed_brands"),
      ),

      // --- Contact tools ---
      tool(
        "search_domain_contacts",
        "Search for contacts (email addresses, names, positions) at a company domain using Hunter.io. Extracts domain from a full URL automatically. Returns contacts with confidence scores.",
        {
          domain: z
            .string()
            .describe(
              'Domain or full URL to search (e.g., "gubi.com" or "https://www.gubi.com")',
            ),
          brandName: z
            .string()
            .optional()
            .describe("Brand name for logging purposes"),
          limit: z
            .number()
            .optional()
            .describe("Maximum contacts to return (default: 50)"),
        },
        handler("search_domain_contacts"),
      ),

      tool(
        "enrich_existing_brand_hunter_contacts",
        "Run Hunter.io enrichment for an already-saved brand page in Notion (no scrapeSessionId required). Useful for backfilling contacts on existing scraped brands. Reads website from the page when possible, or use domain override. Writes to the page's Hunter.io Contacts child database with dedupe by email.",
        {
          notionPageId: z
            .string()
            .describe("Existing Notion page ID in the Brands database"),
          domain: z
            .string()
            .optional()
            .describe(
              "Optional domain/URL override if website is missing on the page",
            ),
          limit: z
            .number()
            .optional()
            .describe(
              "Max Hunter contacts to request (default: 50, max applied: 50)",
            ),
        },
        handler("enrich_existing_brand_hunter_contacts"),
      ),

      tool(
        "enrich_brand_hunter_contacts_by_name",
        "Run Hunter.io enrichment for an already-saved brand in Notion using exact brand name match. This is a one-step variant that resolves the page by name and fails on ambiguous matches.",
        {
          brandName: z
            .string()
            .describe("Exact brand name in the Brands database"),
          domain: z
            .string()
            .optional()
            .describe(
              "Optional domain/URL override if website is missing on the page",
            ),
          limit: z
            .number()
            .optional()
            .describe(
              "Max Hunter contacts to request (default: 50, max applied: 50)",
            ),
        },
        handler("enrich_brand_hunter_contacts_by_name"),
      ),

      // --- Validation tools ---
      tool(
        "validate_brand_data",
        "Validate proposed brand data against the raw scrape_brand result. save_brand_to_notion now runs provenance validation internally, but this tool remains useful for debugging extraction quality.",
        {
          scrapeResult: z
            .object({
              contactDetails: z
                .record(z.string(), z.unknown())
                .optional()
                .describe(
                  "Extracted contact fields (phone, email, street, city, zip, lat, lng, website, facebook, instagram, pinterest)",
                ),
              parsedDistributors: z
                .array(z.record(z.string(), z.unknown()))
                .optional()
                .describe(
                  "Pre-parsed distributor entries with name, street, city, zip, phone, email, website",
                ),
              distributorCount: z
                .number()
                .optional()
                .describe("Number of parsed distributors"),
              markdown: z.string().optional().describe("Page markdown content"),
              links: z.array(z.string()).optional().describe("Page links"),
              metadata: z
                .record(z.string(), z.unknown())
                .optional()
                .describe("Page metadata including ogImage"),
              extractedImageUrls: z
                .object({
                  logoUrl: z.string().nullable().optional(),
                  headerImageUrl: z.string().nullable().optional(),
                  aboutImageUrl: z.string().nullable().optional(),
                })
                .optional()
                .describe(
                  "Deterministically extracted image URLs — use these exact values for logoUrl, headerImageUrl, aboutImageUrl",
                ),
            })
            .describe(
              "The raw scrape_brand output containing contactDetails, parsedDistributors, markdown, links, and metadata.",
            ),
          brandData: z
            .record(z.string(), z.unknown())
            .describe("The proposed save_brand_to_notion arguments to validate."),
        },
        handler("validate_brand_data"),
      ),
    ],
  });
}
