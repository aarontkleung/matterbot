import { z } from "zod";
import {
  getMatterbaseClient,
  type Brand,
  type CountryValue,
  type CreateBrandInput,
  type ProductTypeValue,
  type UpdateBrandInput,
} from "../client/matterbase-api.js";

// Valid product types
const VALID_PRODUCT_TYPES = [
  "material",
  "furniture",
  "lighting",
  "hardware",
  "miscellaneous",
] as const;
type BrandProductType = (typeof VALID_PRODUCT_TYPES)[number];

const FALLBACK_PRODUCT_TYPE_VALUES: Record<BrandProductType, ProductTypeValue> =
  {
    material: { id: "1", value: "material" },
    furniture: { id: "2", value: "furniture" },
    lighting: { id: "3", value: "lighting" },
    hardware: { id: "4", value: "hardware" },
    miscellaneous: { id: "99", value: "miscellaneous" },
  };

export const brandToolSchemas = {
  matterbase_list_brands: z.object({}),

  matterbase_search_brands: z.object({
    query: z.string().describe("Search query for brand name"),
  }),

  matterbase_create_brand: z.object({
    name: z.string().describe("Brand name"),
    companyName: z.string().describe("Official company name"),
    productType: z
      .array(z.enum(VALID_PRODUCT_TYPES))
      .describe(
        "Array of product types: 'material', 'furniture', 'lighting', 'hardware'",
      ),
    countryCode: z.string().describe("Country code (e.g., 'US', 'DE', 'IT')"),
    countryName: z
      .string()
      .describe("Country name (e.g., 'United States', 'Germany', 'Italy')"),
    website: z.string().describe("Brand website URL"),
    contactName: z
      .string()
      .optional()
      .default("-")
      .transform(v => v.trim() || "-")
      .describe("Contact person name"),
    contactJobTitle: z
      .string()
      .optional()
      .default("-")
      .transform(v => v.trim() || "-")
      .describe("Contact job title"),
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
  }),

  matterbase_update_brand: z.object({
    id: z.string().describe("Brand ID to update"),
    name: z.string().describe("Brand name"),
    companyName: z.string().describe("Official company name"),
    productType: z
      .array(z.enum(VALID_PRODUCT_TYPES))
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
    contactName: z
      .string()
      .optional()
      .default("-")
      .transform(v => v.trim() || "-")
      .describe("Contact person name"),
    contactJobTitle: z
      .string()
      .optional()
      .default("-")
      .transform(v => v.trim() || "-")
      .describe("Contact job title"),
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
  }),
};

export const brandToolDefinitions = [
  {
    name: "matterbase_list_brands",
    description: "List all active brands from Matterbase database",
    inputSchema: {
      type: "object" as const,
      properties: {},
      required: [] as string[],
    },
  },
  {
    name: "matterbase_search_brands",
    description: "Search for brands by name in Matterbase database",
    inputSchema: {
      type: "object" as const,
      properties: {
        query: {
          type: "string",
          description: "Search query for brand name",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "matterbase_create_brand",
    description:
      "Create a new brand in Matterbase database. Optionally provide logoUrl to automatically upload and attach the brand logo. Brands are created with isDisabled=true by default for human verification.",
    inputSchema: {
      type: "object" as const,
      properties: {
        name: {
          type: "string",
          description: "Brand name",
        },
        companyName: {
          type: "string",
          description: "Official company name",
        },
        productType: {
          type: "array",
          items: {
            type: "string",
            enum: ["material", "furniture", "lighting", "hardware"],
          },
          description:
            "Array of product types: 'material', 'furniture', 'lighting', 'hardware'",
        },
        countryCode: {
          type: "string",
          description: "Country code (e.g., 'US', 'DE', 'IT')",
        },
        countryName: {
          type: "string",
          description:
            "Country name (e.g., 'United States', 'Germany', 'Italy')",
        },
        website: {
          type: "string",
          description: "Brand website URL",
        },
        contactName: {
          type: "string",
          description: "Contact person name",
        },
        contactJobTitle: {
          type: "string",
          description: "Contact job title",
        },
        contactEmail: {
          type: "string",
          description: "Contact email address",
        },
        excludedCountries: {
          type: "array",
          items: {
            type: "object",
            properties: {
              code: { type: "string", description: "Country code" },
              name: { type: "string", description: "Country name" },
            },
            required: ["code", "name"],
          },
          description: "Array of excluded countries (optional)",
        },
        isDisabled: {
          type: "boolean",
          default: true,
          description:
            "Whether the brand is disabled (defaults to true for human verification)",
        },
        logoUrl: {
          type: "string",
          description:
            "URL of brand logo image. When provided, automatically uploads and attaches the logo after creation.",
        },
      },
      required: [
        "name",
        "companyName",
        "productType",
        "countryCode",
        "countryName",
        "website",
        "contactEmail",
      ],
    },
  },
  {
    name: "matterbase_update_brand",
    description:
      "Update an existing brand in Matterbase database. Use this to add a logo after creating a brand.",
    inputSchema: {
      type: "object" as const,
      properties: {
        id: {
          type: "string",
          description: "Brand ID to update",
        },
        name: {
          type: "string",
          description: "Brand name",
        },
        companyName: {
          type: "string",
          description: "Official company name",
        },
        productType: {
          type: "array",
          items: {
            type: "string",
            enum: ["material", "furniture", "lighting", "hardware"],
          },
          description:
            "Array of product types: 'material', 'furniture', 'lighting', 'hardware'",
        },
        countryCode: {
          type: "string",
          description: "Country code (e.g., 'US', 'DE', 'IT')",
        },
        countryName: {
          type: "string",
          description:
            "Country name (e.g., 'United States', 'Germany', 'Italy')",
        },
        website: {
          type: "string",
          description: "Brand website URL",
        },
        logo: {
          type: "object",
          properties: {
            s3Key: {
              type: "string",
              description: "S3 key from upload response",
            },
            name: { type: "string", description: "Original filename" },
            mimetype: {
              type: "string",
              description: "MIME type (e.g., 'image/png')",
            },
            fileId: {
              type: "number",
              description: "Existing file ID from upload response (optional)",
            },
          },
          required: ["s3Key", "name", "mimetype"],
          nullable: true,
          description: "Logo object (set to null to remove logo)",
        },
        contactName: {
          type: "string",
          description: "Contact person name",
        },
        contactJobTitle: {
          type: "string",
          description: "Contact job title",
        },
        contactEmail: {
          type: "string",
          description: "Contact email address",
        },
        excludedCountries: {
          type: "array",
          items: {
            type: "object",
            properties: {
              code: { type: "string", description: "Country code" },
              name: { type: "string", description: "Country name" },
            },
            required: ["code", "name"],
          },
          description: "Array of excluded countries (can be empty array)",
        },
        isDisabled: {
          type: "boolean",
          description: "Whether the brand is disabled",
        },
      },
      required: [
        "id",
        "name",
        "companyName",
        "productType",
        "countryCode",
        "countryName",
        "website",
        "contactEmail",
        "excludedCountries",
        "isDisabled",
      ],
    },
  },
];

// Helper to convert product type strings to ProductTypeValue objects
async function toProductTypeValues(
  client: ReturnType<typeof getMatterbaseClient>,
  types: BrandProductType[],
): Promise<ProductTypeValue[]> {
  const fallback = types.map((type) => FALLBACK_PRODUCT_TYPE_VALUES[type]);
  const result = await client.listProductTypes();

  if (!result.success || !result.data || result.data.length === 0) {
    return fallback;
  }

  const byNormalizedValue = new Map(
    result.data.map((type) => [type.value.trim().toLowerCase(), type] as const),
  );

  return types.map((type) => {
    const resolved = byNormalizedValue.get(type);
    if (!resolved) {
      return FALLBACK_PRODUCT_TYPE_VALUES[type];
    }
    return {
      id: String(resolved.id),
      value: resolved.value,
    };
  });
}

// Helper to convert country code/name to CountryValue object
function toCountryValue(code: string, name: string): CountryValue {
  return { id: code, value: name };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function unwrapDataEnvelope(value: unknown, maxDepth = 6): unknown {
  let current = value;

  for (let i = 0; i < maxDepth; i++) {
    if (
      !isRecord(current) ||
      !Object.prototype.hasOwnProperty.call(current, "data")
    ) {
      break;
    }

    const nested = current.data;
    if (nested === undefined || nested === null) {
      break;
    }
    current = nested;
  }

  return current;
}

function extractBrandId(value: unknown): string | null {
  const unwrapped = unwrapDataEnvelope(value);
  if (!isRecord(unwrapped)) return null;

  const id = unwrapped.id;
  if (typeof id === "string" && id.trim().length > 0) return id;
  if (typeof id === "number" && Number.isFinite(id)) return String(id);
  return null;
}

export async function executeBrandTool(
  name: string,
  args: Record<string, unknown>,
): Promise<string> {
  const client = getMatterbaseClient();

  switch (name) {
    case "matterbase_list_brands": {
      const result = await client.listBrands();
      if (!result.success) {
        return JSON.stringify({ success: false, error: result.error });
      }
      const rawListBrands = unwrapDataEnvelope(result.data);
      const brands = (Array.isArray(rawListBrands) ? rawListBrands as Brand[] : []).map((b) => ({
        id: b.id,
        name: b.name,
      }));
      return JSON.stringify({
        success: true,
        brands,
        count: brands.length,
      });
    }

    case "matterbase_search_brands": {
      const parsed = brandToolSchemas.matterbase_search_brands.parse(args);
      const result = await client.searchBrands(parsed.query);
      if (!result.success) {
        return JSON.stringify({ success: false, error: result.error });
      }
      const rawSearchBrands = unwrapDataEnvelope(result.data);
      const allBrands = Array.isArray(rawSearchBrands) ? rawSearchBrands as Brand[] : [];
      const brands = allBrands.slice(0, 20).map((b) => ({
        id: b.id,
        name: b.name,
      }));
      return JSON.stringify({
        success: true,
        brands,
        count: brands.length,
        totalCount: allBrands.length,
        query: parsed.query,
      });
    }

    case "matterbase_create_brand": {
      const parsed = brandToolSchemas.matterbase_create_brand.parse(args);

      // Check if brand already exists in Matterbase (fail-closed: block creation if search fails)
      const existingSearch = await client.searchBrands(parsed.name);
      if (!existingSearch.success) {
        return JSON.stringify({
          success: false,
          error: `Cannot verify brand uniqueness — search failed: ${existingSearch.error ?? "unknown error"}. Retry or manually confirm brand "${parsed.name}" does not exist before creating.`,
        });
      }
      const existingBrands = unwrapDataEnvelope(existingSearch.data);
      const existingBrandsArr = Array.isArray(existingBrands) ? existingBrands as Brand[] : [];
      if (existingBrandsArr.length > 0) {
        const exactMatch = existingBrandsArr.find(
          (b) =>
            b.name.toLowerCase().trim() === parsed.name.toLowerCase().trim(),
        );
        if (exactMatch) {
          return JSON.stringify({
            success: false,
            error: `Brand "${parsed.name}" already exists in Matterbase (id: ${exactMatch.id})`,
            existingBrand: exactMatch,
          });
        }
      }

      // Resolve product type values once (reused for both create and potential update)
      const productTypeValues = await toProductTypeValues(
        client,
        parsed.productType,
      );

      const input: CreateBrandInput = {
        name: parsed.name,
        companyName: parsed.companyName,
        productType: productTypeValues,
        country: toCountryValue(parsed.countryCode, parsed.countryName),
        website: parsed.website,
        contactName: parsed.contactName,
        contactJobTitle: parsed.contactJobTitle,
        contactEmail: parsed.contactEmail,
        isDisabled: parsed.isDisabled,
      };

      if (parsed.excludedCountries && parsed.excludedCountries.length > 0) {
        input.excludedCountries = parsed.excludedCountries.map((c) =>
          toCountryValue(c.code, c.name),
        );
      }

      const result = await client.createBrand(input);
      if (!result.success) {
        return JSON.stringify({ success: false, error: result.error });
      }

      const createdBrand = unwrapDataEnvelope(result.data) as Brand;
      let createdBrandId = extractBrandId(result.data);

      if (!createdBrandId) {
        const createdSearch = await client.searchBrands(parsed.name);
        if (
          createdSearch.success &&
          createdSearch.data &&
          createdSearch.data.length > 0
        ) {
          const exactByName = createdSearch.data.find(
            (b) =>
              b.name.toLowerCase().trim() === parsed.name.toLowerCase().trim(),
          );
          if (exactByName?.id) {
            createdBrandId = exactByName.id;
          }
        }
      }

      // If logoUrl provided, attempt to upload and attach the logo
      if (parsed.logoUrl) {
        if (!createdBrandId) {
          return JSON.stringify({
            success: true,
            brand: createdBrand,
            logoWarning:
              "Brand created but logo update skipped: could not resolve created brand ID from create response.",
          });
        }

        const slug = parsed.name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "");

        try {
          const uploadResult = await client.uploadImageFromUrl(
            parsed.logoUrl,
            slug,
          );
          if (!uploadResult.success || !uploadResult.data) {
            return JSON.stringify({
              success: true,
              brand: createdBrand,
              matterbaseId: createdBrandId,
              logoWarning: `Brand created but logo upload failed: ${uploadResult.error}`,
            });
          }

          const upload = uploadResult.data;
          const updateInput: UpdateBrandInput = {
            id: createdBrandId,
            name: parsed.name,
            companyName: parsed.companyName,
            productType: productTypeValues,
            country: toCountryValue(parsed.countryCode, parsed.countryName),
            website: parsed.website,
            contactName: parsed.contactName,
            contactJobTitle: parsed.contactJobTitle,
            contactEmail: parsed.contactEmail,
            excludedCountries: (parsed.excludedCountries ?? []).map((c) =>
              toCountryValue(c.code, c.name),
            ),
            isDisabled: parsed.isDisabled,
            logo: {
              s3Key: upload.s3Key ?? "",
              s3_key: upload.s3Key ?? "",
              name: upload.name ?? `${slug}.jpg`,
              mimetype: upload.mimetype ?? "image/jpeg",
              mimeType: upload.mimetype ?? "image/jpeg",
              ...(upload.fileId != null
                ? { file_id: upload.fileId, fileId: upload.fileId }
                : {}),
            },
          };

          const updateResult = await client.updateBrand(updateInput);
          if (!updateResult.success) {
            return JSON.stringify({
              success: true,
              brand: createdBrand,
              matterbaseId: createdBrandId,
              logoWarning: `Brand created but logo update failed: ${updateResult.error}`,
            });
          }

          const updatedBrand = unwrapDataEnvelope(updateResult.data) as Brand;
          const updatedBrandId =
            extractBrandId(updateResult.data) ?? createdBrandId;

          return JSON.stringify({
            success: true,
            brand: updatedBrand,
            matterbaseId: updatedBrandId,
            message: `Brand "${parsed.name}" created successfully with logo.`,
          });
        } catch (err) {
          return JSON.stringify({
            success: true,
            brand: createdBrand,
            matterbaseId: createdBrandId,
            logoWarning: `Brand created but logo step failed: ${err instanceof Error ? err.message : "Unknown error"}`,
          });
        }
      }

      return JSON.stringify({
        success: true,
        brand: createdBrand,
        matterbaseId: createdBrandId,
        message: `Brand "${parsed.name}" created successfully.`,
      });
    }

    case "matterbase_update_brand": {
      const parsed = brandToolSchemas.matterbase_update_brand.parse(args);

      const input: UpdateBrandInput = {
        id: parsed.id,
        name: parsed.name,
        companyName: parsed.companyName,
        productType: await toProductTypeValues(client, parsed.productType),
        country: toCountryValue(parsed.countryCode, parsed.countryName),
        website: parsed.website,
        contactName: parsed.contactName,
        contactJobTitle: parsed.contactJobTitle,
        contactEmail: parsed.contactEmail,
        excludedCountries: parsed.excludedCountries.map((c) =>
          toCountryValue(c.code, c.name),
        ),
        isDisabled: parsed.isDisabled,
      };

      // Handle logo - convert from tool schema format to API format
      if (parsed.logo !== undefined) {
        if (parsed.logo === null) {
          input.logo = null;
        } else {
          input.logo = {
            s3Key: parsed.logo.s3Key,
            s3_key: parsed.logo.s3Key,
            name: parsed.logo.name,
            mimetype: parsed.logo.mimetype,
            mimeType: parsed.logo.mimetype,
          };
          if (parsed.logo.fileId !== undefined) {
            input.logo.file_id = parsed.logo.fileId;
            input.logo.fileId = parsed.logo.fileId;
          }
        }
      }

      const result = await client.updateBrand(input);
      if (!result.success) {
        return JSON.stringify({ success: false, error: result.error });
      }
      return JSON.stringify({
        success: true,
        brand: result.data,
        message: `Brand updated successfully`,
      });
    }

    default:
      return JSON.stringify({
        success: false,
        error: `Unknown brand tool: ${name}`,
      });
  }
}
