import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getMatterbaseClient } from "./client/matterbase-api.js";
import { executeBrandTool } from "./tools/brands.js";
import { executeProductTool } from "./tools/products.js";

export function createMatterbaseMcpServer(): McpServer {
  const server = new McpServer({
    name: "matterbase-mcp",
    version: "1.0.0",
  });

  // Brand tools
  server.tool(
    "matterbase_list_brands",
    "List all active brands from Matterbase database",
    {},
    async () => {
      const result = await executeBrandTool("matterbase_list_brands", {});
      return { content: [{ type: "text", text: result }] };
    },
  );

  server.tool(
    "matterbase_search_brands",
    "Search for brands by name in Matterbase database",
    { query: z.string().describe("Search query for brand name") },
    async (args) => {
      const result = await executeBrandTool("matterbase_search_brands", args);
      return { content: [{ type: "text", text: result }] };
    },
  );

  server.tool(
    "matterbase_create_brand",
    "Create a new brand in Matterbase database. Optionally provide logoUrl to automatically upload and attach the brand logo. Brands are created with isDisabled=true by default for human verification. This is a raw Matterbase operation and does NOT write any Notion fields.",
    {
      name: z.string().describe("Brand name"),
      companyName: z.string().describe("Official company name"),
      productType: z
        .array(z.enum(["material", "furniture", "lighting", "hardware"]))
        .describe(
          "Array of product types: 'material', 'furniture', 'lighting', 'hardware'",
        ),
      countryCode: z.string().describe("Country code (e.g., 'US', 'DE', 'IT')"),
      countryName: z
        .string()
        .describe("Country name (e.g., 'United States', 'Germany', 'Italy')"),
      website: z.string().describe("Brand website URL"),
      contactName: z.string().describe("Contact person name"),
      contactJobTitle: z.string().describe("Contact job title"),
      contactEmail: z.string().describe("Contact email address"),
      excludedCountries: z
        .array(
          z.object({
            code: z.string().describe("Country code"),
            name: z.string().describe("Country name"),
          }),
        )
        .optional()
        .describe("Array of excluded countries"),
      isDisabled: z
        .boolean()
        .optional()
        .default(true)
        .describe(
          "Whether the brand is disabled (defaults to true for human verification)",
        ),
      logoUrl: z
        .string()
        .optional()
        .describe(
          "URL of brand logo image. When provided, automatically uploads and attaches the logo after creation.",
        ),
    },
    async (args) => {
      const result = await executeBrandTool("matterbase_create_brand", args);
      return { content: [{ type: "text", text: result }] };
    },
  );

  server.tool(
    "matterbase_update_brand",
    "Update an existing brand in Matterbase database. Use this to add a logo after creating a brand.",
    {
      id: z.string().describe("Brand ID to update"),
      name: z.string().describe("Brand name"),
      companyName: z.string().describe("Official company name"),
      productType: z
        .array(z.enum(["material", "furniture", "lighting", "hardware"]))
        .describe(
          "Array of product types: 'material', 'furniture', 'lighting', 'hardware'",
        ),
      countryCode: z.string().describe("Country code (e.g., 'US', 'DE', 'IT')"),
      countryName: z
        .string()
        .describe("Country name (e.g., 'United States', 'Germany', 'Italy')"),
      website: z.string().describe("Brand website URL"),
      logo: z
        .object({
          s3Key: z.string().describe("S3 key from upload response"),
          name: z.string().describe("Original filename"),
          mimetype: z.string().describe("MIME type (e.g., 'image/png')"),
          fileId: z
            .number()
            .int()
            .nonnegative()
            .optional()
            .describe(
              "Existing file ID from upload response (preferred when available)",
            ),
        })
        .nullable()
        .optional()
        .describe("Logo object (set to null to remove logo)"),
      contactName: z.string().describe("Contact person name"),
      contactJobTitle: z.string().describe("Contact job title"),
      contactEmail: z.string().describe("Contact email address"),
      excludedCountries: z
        .array(
          z.object({
            code: z.string().describe("Country code"),
            name: z.string().describe("Country name"),
          }),
        )
        .describe("Array of excluded countries (can be empty array)"),
      isDisabled: z.boolean().describe("Whether the brand is disabled"),
    },
    async (args) => {
      const result = await executeBrandTool("matterbase_update_brand", args);
      return { content: [{ type: "text", text: result }] };
    },
  );

  // Product tools
  server.tool(
    "matterbase_list_products",
    "List products from Matterbase database with optional pagination and filtering",
    {
      page: z.number().optional().describe("Page number (default: 1)"),
      limit: z.number().optional().describe("Items per page (default: 20)"),
      brandId: z.string().optional().describe("Filter by brand ID"),
      categoryId: z.string().optional().describe("Filter by category ID"),
    },
    async (args) => {
      const result = await executeProductTool("matterbase_list_products", args);
      return { content: [{ type: "text", text: result }] };
    },
  );

  server.tool(
    "matterbase_search_products",
    "Search for products by name in Matterbase database",
    {
      query: z.string().describe("Search query for product name"),
      page: z.number().optional().describe("Page number (default: 1)"),
      limit: z.number().optional().describe("Items per page (default: 20)"),
    },
    async (args) => {
      const result = await executeProductTool(
        "matterbase_search_products",
        args,
      );
      return { content: [{ type: "text", text: result }] };
    },
  );

  server.tool(
    "matterbase_get_product",
    "Get detailed information about a specific product by ID",
    { id: z.string().describe("Product ID") },
    async (args) => {
      const result = await executeProductTool("matterbase_get_product", args);
      return { content: [{ type: "text", text: result }] };
    },
  );

  server.tool(
    "matterbase_create_product",
    "Create a new product in Matterbase database",
    {
      name: z.string().describe("Product name"),
      brandId: z.string().describe("Brand ID this product belongs to"),
      slug: z
        .string()
        .optional()
        .describe("URL-friendly slug (auto-generated if not provided)"),
      description: z.string().optional().describe("Product description"),
      categoryId: z.string().optional().describe("Category ID"),
      images: z.array(z.string()).optional().describe("Array of image URLs"),
      specifications: z
        .record(z.unknown())
        .optional()
        .describe("Product specifications as key-value pairs"),
    },
    async (args) => {
      const result = await executeProductTool(
        "matterbase_create_product",
        args,
      );
      return { content: [{ type: "text", text: result }] };
    },
  );

  server.tool(
    "matterbase_update_product",
    "Update an existing product in Matterbase database",
    {
      id: z.string().describe("Product ID to update"),
      name: z.string().optional().describe("New product name"),
      slug: z.string().optional().describe("New URL-friendly slug"),
      description: z.string().optional().describe("New product description"),
      brandId: z.string().optional().describe("New brand ID"),
      categoryId: z.string().optional().describe("New category ID"),
      images: z
        .array(z.string())
        .optional()
        .describe("New array of image URLs"),
      specifications: z
        .record(z.unknown())
        .optional()
        .describe("New product specifications"),
      isActive: z
        .boolean()
        .optional()
        .describe("Whether the product is active"),
    },
    async (args) => {
      const result = await executeProductTool(
        "matterbase_update_product",
        args,
      );
      return { content: [{ type: "text", text: result }] };
    },
  );

  // Upload tools
  server.tool(
    "matterbase_upload_image",
    "Download an image from a URL and upload it to Matterbase storage. Returns upload metadata including url, s3Key, name, mimetype, and optional fileId. Use these fields directly for brand logo updates.",
    {
      imageUrl: z.string().describe("URL of the image to download and upload"),
      filename: z
        .string()
        .optional()
        .describe(
          "Optional filename (without extension). If not provided, uses the original filename from the URL.",
        ),
    },
    async (args) => {
      const client = getMatterbaseClient();
      const result = await client.uploadImageFromUrl(
        args.imageUrl,
        args.filename,
      );

      if (!result.success) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                { success: false, error: result.error },
                null,
                2,
              ),
            },
          ],
          isError: true,
        };
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              { success: true, upload: result.data },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  // Data tools
  server.tool(
    "matterbase_list_countries",
    "List all available countries from Matterbase database. Use this to get the correct country code and name for a brand.",
    {},
    async () => {
      const client = getMatterbaseClient();
      const result = await client.listCountries();

      if (!result.success) {
        return {
          content: [
            { type: "text", text: `Error fetching countries: ${result.error}` },
          ],
          isError: true,
        };
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                success: true,
                countries: result.data,
                count: result.data?.length ?? 0,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  return server;
}
