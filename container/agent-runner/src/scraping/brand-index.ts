import { notionApiRequest } from "./integrations/notion-api.js";
import { getMCPClient, type MCPClientManager } from "./integrations/notion-mcp.js";
import { BRANDS_DATABASE_ID, BRAND_INDEX_DATABASE_ID, BRAND_INDEX_DATA_SOURCE_ID } from "./notion-tools.js";
import { executeListBrands, type ParsedBrand } from "./brands.js";

async function getConnectedClient(): Promise<MCPClientManager> {
  const client = getMCPClient();
  if (!client.isConnected()) {
    await client.connect();
  }
  return client;
}

export interface ListBrandsFromIndexArgs {
  status?: string;
  limit?: number;
}

export interface UpdateBrandIndexStatusArgs {
  architonicId: string;
  status: string;
  notes?: string;
}

export interface AddBrandsToIndexArgs {
  brands: Array<{
    name: string;
    architonicUrl: string;
    architonicId: string;
    location?: string;
    type?: string;
  }>;
}

export interface UpdateBrandsInIndexArgs {
  brands: Array<{
    architonicId: string;
    location?: string;
    type?: string;
  }>;
}

export interface FindUnindexedBrandsArgs {
  pages?: number[];
  checkAll?: boolean;
}

interface NotionPage {
  id: string;
  parent?: {
    database_id?: string;
  };
  properties: {
    Name?: { title?: Array<{ text?: { content?: string }; plain_text?: string }> };
    "Architonic URL"?: { url?: string };
    "Architonic ID"?: { rich_text?: Array<{ text?: { content?: string }; plain_text?: string }> };
    "Matterbase ID"?: { rich_text?: Array<{ text?: { content?: string }; plain_text?: string }> };
    Status?: { select?: { name?: string } };
    Location?: { rich_text?: Array<{ text?: { content?: string }; plain_text?: string }> };
    Type?: { rich_text?: Array<{ text?: { content?: string }; plain_text?: string }> };
    "Last Synced"?: { date?: { start?: string } };
    Notes?: { rich_text?: Array<{ text?: { content?: string }; plain_text?: string }> };
  };
}

interface NotionQueryResponse {
  results?: NotionPage[];
  has_more?: boolean;
  next_cursor?: string;
}

function richTextToPlainText(
  richText: Array<{ text?: { content?: string }; plain_text?: string }> | undefined
): string {
  if (!Array.isArray(richText)) return "";
  return richText
    .map((item) => item.plain_text || item.text?.content || "")
    .join("")
    .trim();
}

async function getBrandMatterbaseLinkState(
  architonicId: string
): Promise<{ notionPageId?: string; matterbaseId?: string; linked: boolean }> {
  const queryResult = (await notionApiRequest("POST", `/databases/${BRANDS_DATABASE_ID}/query`, {
    filter: {
      property: "Architonic ID",
      rich_text: { equals: architonicId },
    },
    page_size: 1,
  })) as NotionQueryResponse;

  const page = queryResult.results?.[0];
  if (!page) {
    return { linked: false };
  }

  const matterbaseId = richTextToPlainText(page.properties?.["Matterbase ID"]?.rich_text);

  return {
    notionPageId: page.id,
    matterbaseId: matterbaseId || undefined,
    linked: matterbaseId.length > 0,
  };
}

export async function executeListBrandsFromIndex(
  args: ListBrandsFromIndexArgs
): Promise<string> {
  const { status, limit = 50 } = args;

  const mcpClient = await getConnectedClient();

  // Build filter conditions
  const filterConditions: Array<Record<string, unknown>> = [];

  if (status) {
    filterConditions.push({
      property: "Status",
      select: { equals: status },
    });
  }

  const queryArgs: Record<string, unknown> = {
    data_source_id: BRAND_INDEX_DATA_SOURCE_ID,
    page_size: Math.min(limit, 100),
  };

  if (filterConditions.length > 0) {
    queryArgs.filter =
      filterConditions.length === 1
        ? filterConditions[0]
        : { and: filterConditions };
  }

  try {
    const result = (await mcpClient.executeTool(
      "API-query-data-source",
      queryArgs
    )) as NotionQueryResponse;

    const brands =
      result.results?.map((page) => ({
        notionPageId: page.id,
        name: page.properties?.Name?.title?.[0]?.text?.content || "Unknown",
        architonicUrl: page.properties?.["Architonic URL"]?.url || "",
        architonicId:
          page.properties?.["Architonic ID"]?.rich_text?.[0]?.text?.content || "",
        status: page.properties?.Status?.select?.name || "pending",
        location:
          page.properties?.Location?.rich_text?.[0]?.text?.content || "",
        type: page.properties?.Type?.rich_text?.[0]?.text?.content || "",
        lastSynced: page.properties?.["Last Synced"]?.date?.start || null,
        notes:
          page.properties?.Notes?.rich_text?.[0]?.text?.content || "",
      })) || [];

    return JSON.stringify({
      success: true,
      count: brands.length,
      hasMore: result.has_more || false,
      brands,
      instructions:
        "Use scrape_brand with the architonicUrl to get full brand details, then call save_brand_to_notion and create the Matterbase brand with matterbase_create_brand using notionPageId from save_brand_to_notion; finally update index status with update_brand_index_status.",
    });
  } catch (error) {
    return JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function executeUpdateBrandIndexStatus(
  args: UpdateBrandIndexStatusArgs
): Promise<string> {
  const { architonicId, status, notes } = args;

  const mcpClient = await getConnectedClient();

  try {
    if (status === "scraped") {
      const brandLinkState = await getBrandMatterbaseLinkState(architonicId);
      if (!brandLinkState.linked) {
        return JSON.stringify({
          success: false,
          code: "SCRAPED_STATUS_REQUIRES_MATTERBASE_ID",
          error:
            'Cannot mark brand index status as "scraped" until the Brands page has a non-empty "Matterbase ID".',
          architonicId,
          status,
          notionPageId: brandLinkState.notionPageId ?? null,
          matterbaseId: brandLinkState.matterbaseId ?? null,
          instruction: brandLinkState.notionPageId
            ? `Run matterbase_create_brand with notionPageId "${brandLinkState.notionPageId}" or update_brand_notion_matterbase_id for that page, then retry update_brand_index_status.`
            : `No matching Brands page found for Architonic ID "${architonicId}". Run scrape_brand + save_brand_to_notion first, then create/link Matterbase ID before setting status to scraped.`,
        });
      }
    }

    // First, find the page by Architonic ID
    const searchResult = (await mcpClient.executeTool("API-query-data-source", {
      data_source_id: BRAND_INDEX_DATA_SOURCE_ID,
      filter: {
        property: "Architonic ID",
        rich_text: { equals: architonicId },
      },
    })) as NotionQueryResponse;

    if (!searchResult.results || searchResult.results.length === 0) {
      return JSON.stringify({
        success: false,
        error: `Brand with Architonic ID "${architonicId}" not found in index`,
      });
    }

    const pageId = searchResult.results[0].id;

    // Update the page
    const properties: Record<string, unknown> = {
      Status: { select: { name: status } },
      "Last Synced": { date: { start: new Date().toISOString() } },
    };

    if (notes !== undefined) {
      properties.Notes = {
        rich_text: [{ text: { content: notes } }],
      };
    }

    await mcpClient.executeTool("API-patch-page", {
      page_id: pageId,
      properties,
    });

    return JSON.stringify({
      success: true,
      message: `Updated brand ${architonicId} status to "${status}"`,
      pageId,
    });
  } catch (error) {
    return JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function executeAddBrandsToIndex(
  args: AddBrandsToIndexArgs
): Promise<string> {
  const { brands } = args;

  if (!brands || brands.length === 0) {
    return JSON.stringify({
      success: false,
      error: "No brands provided",
    });
  }

  const mcpClient = await getConnectedClient();

  const results = {
    added: 0,
    skipped: 0,
    failed: 0,
    errors: [] as string[],
  };

  for (const brand of brands) {
    try {
      // Check if brand already exists by Architonic ID
      const existingResult = (await mcpClient.executeTool("API-query-data-source", {
        data_source_id: BRAND_INDEX_DATA_SOURCE_ID,
        filter: {
          property: "Architonic ID",
          rich_text: { equals: brand.architonicId },
        },
      })) as NotionQueryResponse;

      if (existingResult.results && existingResult.results.length > 0) {
        results.skipped++;
        continue;
      }

      // Create new page in the index
      const properties: Record<string, unknown> = {
        Name: { title: [{ text: { content: brand.name } }] },
        "Architonic URL": { url: brand.architonicUrl },
        "Architonic ID": { rich_text: [{ text: { content: brand.architonicId } }] },
        Status: { select: { name: "pending" } },
        "Last Synced": { date: { start: new Date().toISOString() } },
      };

      if (brand.location) {
        properties.Location = {
          rich_text: [{ text: { content: brand.location } }],
        };
      }

      if (brand.type) {
        properties.Type = {
          rich_text: [{ text: { content: brand.type } }],
        };
      }

      await mcpClient.executeTool("API-post-page", {
        parent: { database_id: BRAND_INDEX_DATABASE_ID },
        properties,
      });

      results.added++;
    } catch (error) {
      results.failed++;
      results.errors.push(
        `${brand.name}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  return JSON.stringify({
    success: true,
    summary: `Added ${results.added}, skipped ${results.skipped} (already exist), failed ${results.failed}`,
    ...results,
  });
}

export async function executeUpdateBrandsInIndex(
  args: UpdateBrandsInIndexArgs
): Promise<string> {
  const { brands } = args;

  if (!brands || brands.length === 0) {
    return JSON.stringify({
      success: false,
      error: "No brands provided",
    });
  }

  const mcpClient = await getConnectedClient();

  const results = {
    updated: 0,
    skipped: 0,
    notFound: 0,
    failed: 0,
    errors: [] as string[],
  };

  for (const brand of brands) {
    try {
      // Skip if no location or type to update
      if (!brand.location && !brand.type) {
        results.skipped++;
        continue;
      }

      // Find existing brand by architonicId using direct query
      const searchResult = (await mcpClient.executeTool("API-query-data-source", {
        data_source_id: BRAND_INDEX_DATA_SOURCE_ID,
        filter: {
          property: "Architonic ID",
          rich_text: { equals: brand.architonicId },
        },
      })) as NotionQueryResponse;

      if (!searchResult.results || searchResult.results.length === 0) {
        results.notFound++;
        continue;
      }

      const existingPage = searchResult.results[0];

      // Check if update is needed (only update if fields are empty)
      const existingLocation =
        existingPage.properties?.Location?.rich_text?.[0]?.text?.content;
      const existingType =
        existingPage.properties?.Type?.rich_text?.[0]?.text?.content;

      const properties: Record<string, unknown> = {};

      if (brand.location && !existingLocation) {
        properties.Location = {
          rich_text: [{ text: { content: brand.location } }],
        };
      }

      if (brand.type && !existingType) {
        properties.Type = {
          rich_text: [{ text: { content: brand.type } }],
        };
      }

      // Skip if nothing to update
      if (Object.keys(properties).length === 0) {
        results.skipped++;
        continue;
      }

      // Update the page
      await mcpClient.executeTool("API-patch-page", {
        page_id: existingPage.id,
        properties,
      });

      results.updated++;
    } catch (error) {
      results.failed++;
      results.errors.push(
        `${brand.architonicId}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  return JSON.stringify({
    success: true,
    summary: `Updated ${results.updated}, skipped ${results.skipped} (no update needed), not found ${results.notFound}, failed ${results.failed}`,
    ...results,
  });
}

async function getIndexedArchtonicIds(mcpClient: MCPClientManager): Promise<Set<string>> {
  const ids = new Set<string>();
  let cursor: string | undefined;

  do {
    const queryArgs: Record<string, unknown> = {
      data_source_id: BRAND_INDEX_DATA_SOURCE_ID,
      page_size: 100,
    };
    if (cursor) {
      queryArgs.start_cursor = cursor;
    }

    const result = (await mcpClient.executeTool(
      "API-query-data-source",
      queryArgs
    )) as NotionQueryResponse;

    const pages = result.results || [];

    for (const page of pages) {
      const architonicId =
        page.properties?.["Architonic ID"]?.rich_text?.[0]?.text?.content;
      if (architonicId) {
        ids.add(architonicId);
      }
    }

    cursor = result.has_more ? result.next_cursor : undefined;
  } while (cursor);

  return ids;
}

export async function executeFindUnindexedBrands(
  args: FindUnindexedBrandsArgs
): Promise<string> {
  const { pages: inputPages, checkAll } = args;

  // Determine which pages to check
  const pagesToCheck = checkAll
    ? Array.from({ length: 68 }, (_, i) => i + 1)
    : (inputPages && inputPages.length > 0 ? inputPages : [1]);

  try {
    const mcpClient = await getConnectedClient();
    const indexedIds = await getIndexedArchtonicIds(mcpClient);

    // 2. Scrape and check each page
    const allUnindexedBrands: Array<ParsedBrand & { page: number }> = [];
    const pageResults: Array<{ page: number; scraped: number; unindexed: number }> = [];
    const errors: Array<{ page: number; error: string }> = [];

    for (const page of pagesToCheck) {
      try {
        const scrapedResult = await executeListBrands({ criteria: "most_popular", page });
        const scrapedData = JSON.parse(scrapedResult);

        if (!scrapedData.success || !scrapedData.brands) {
          errors.push({ page, error: scrapedData.error || "Failed to scrape" });
          continue;
        }

        // Filter to only unindexed brands
        const unindexedBrands = scrapedData.brands.filter(
          (brand: ParsedBrand) => !indexedIds.has(brand.architonicId)
        );

        // Add page info to each brand
        for (const brand of unindexedBrands) {
          allUnindexedBrands.push({ ...brand, page });
        }

        pageResults.push({
          page,
          scraped: scrapedData.brands.length,
          unindexed: unindexedBrands.length,
        });
      } catch (error) {
        errors.push({
          page,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    const totalScraped = pageResults.reduce((sum, r) => sum + r.scraped, 0);

    return JSON.stringify({
      success: true,
      pagesChecked: pagesToCheck.length,
      totalIndexed: indexedIds.size,
      totalScraped,
      unindexedCount: allUnindexedBrands.length,
      pageResults,
      errors: errors.length > 0 ? errors : undefined,
      brands: allUnindexedBrands,
    });
  } catch (error) {
    return JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
