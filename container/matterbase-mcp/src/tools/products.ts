import { z } from "zod";
import { getMatterbaseClient } from "../client/matterbase-api.js";

const imageInputSchema = z.object({
  s3Key: z.string().describe("S3 key for the image"),
  name: z.string().describe("Image filename"),
  mimetype: z.string().describe("Image MIME type (e.g., image/jpeg)"),
});

export const productToolSchemas = {
  matterbase_list_products: z.object({
    page: z.number().optional().describe("Page number (default: 1)"),
    limit: z.number().optional().describe("Items per page (default: 20)"),
    brandId: z.string().optional().describe("Filter by brand ID"),
    categoryId: z.string().optional().describe("Filter by category ID"),
  }),

  matterbase_search_products: z.object({
    query: z.string().describe("Search query for product name"),
    page: z.number().optional().describe("Page number (default: 1)"),
    limit: z.number().optional().describe("Items per page (default: 20)"),
  }),

  matterbase_get_product: z.object({
    id: z.string().describe("Product ID"),
  }),

  matterbase_create_product: z.object({
    name: z.string().describe("Product name"),
    brandId: z.string().describe("Brand ID this product belongs to"),
    slug: z.string().optional().describe("URL-friendly slug (auto-generated if not provided)"),
    description: z.string().optional().describe("Product description"),
    categoryId: z.string().optional().describe("Category ID"),
    images: z.array(z.string()).optional().describe("Array of image URLs"),
    specifications: z.record(z.unknown()).optional().describe("Product specifications as key-value pairs"),
  }),

  matterbase_update_product: z.object({
    id: z.string().describe("Product ID to update"),
    name: z.string().optional().describe("New product name"),
    slug: z.string().optional().describe("New URL-friendly slug"),
    description: z.string().optional().describe("New product description"),
    brandId: z.string().optional().describe("New brand ID"),
    categoryId: z.string().optional().describe("New category ID"),
    images: z.array(z.string()).optional().describe("New array of image URLs"),
    specifications: z.record(z.unknown()).optional().describe("New product specifications"),
    isActive: z.boolean().optional().describe("Whether the product is active"),
  }),

  // Child entity schemas
  matterbase_add_product_image: z.object({
    productParentId: z.string().describe("Product parent ID"),
    image: imageInputSchema.describe("Image object with s3Key, name, mimetype"),
    orderIndex: z.number().describe("Order index for image display"),
  }),

  matterbase_add_product_category: z.object({
    productParentId: z.string().describe("Product parent ID"),
    productCategoryId: z.string().describe("Product category ID"),
  }),

  matterbase_add_product_specification: z.object({
    productParentId: z.string().describe("Product parent ID"),
    specificationId: z.string().describe("Specification ID"),
    orderIndex: z.number().describe("Order index for specification display"),
  }),

  matterbase_create_variation: z.object({
    productParentId: z.string().describe("Product parent ID"),
    variationTypeId: z.string().describe("Variation type ID (e.g., color, size, material)"),
    value: z.string().describe("Variation value (e.g., 'Black', 'Large', 'Oak')"),
    image: imageInputSchema.optional().describe("Optional image for this variation"),
    hex: z.string().optional().describe("Hex color code for color variations (e.g., '#000000')"),
  }),

  matterbase_list_variations: z.object({
    productParentId: z.string().describe("Product parent ID"),
  }),

  matterbase_create_variation_combination: z.object({
    productParentId: z.string().describe("Product parent ID"),
    signature: z.string().describe("Unique signature for this combination"),
    name: z.string().describe("Display name for this combination"),
    keyImage: imageInputSchema.optional().describe("Key image for this combination"),
    model: imageInputSchema.optional().describe("3D model file"),
    diffuse: imageInputSchema.optional().describe("Diffuse/albedo texture"),
    orm: imageInputSchema.optional().describe("ORM (Occlusion, Roughness, Metallic) texture"),
    normal: imageInputSchema.optional().describe("Normal map texture"),
    transThick: imageInputSchema.optional().describe("Transmission/thickness texture"),
    materialValues: z.record(z.unknown()).optional().describe("Material property values"),
  }),

  matterbase_add_combination_detail: z.object({
    variationCombinationPendingId: z.string().describe("Variation combination pending ID"),
    variationId: z.string().describe("Variation ID to link"),
    isKeyVariation: z.boolean().describe("Whether this is the key variation for the combination"),
  }),

  matterbase_add_combination_specification: z.object({
    variationCombinationPendingId: z.string().describe("Variation combination pending ID"),
    specificationId: z.string().describe("Specification ID"),
  }),
};

export const productToolDefinitions = [
  {
    name: "matterbase_list_products",
    description: "List products from Matterbase database with optional pagination and filtering",
    inputSchema: {
      type: "object" as const,
      properties: {
        page: {
          type: "number",
          description: "Page number (default: 1)",
        },
        limit: {
          type: "number",
          description: "Items per page (default: 20)",
        },
        brandId: {
          type: "string",
          description: "Filter by brand ID",
        },
        categoryId: {
          type: "string",
          description: "Filter by category ID",
        },
      },
      required: [] as string[],
    },
  },
  {
    name: "matterbase_search_products",
    description: "Search for products by name in Matterbase database",
    inputSchema: {
      type: "object" as const,
      properties: {
        query: {
          type: "string",
          description: "Search query for product name",
        },
        page: {
          type: "number",
          description: "Page number (default: 1)",
        },
        limit: {
          type: "number",
          description: "Items per page (default: 20)",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "matterbase_get_product",
    description: "Get detailed information about a specific product by ID",
    inputSchema: {
      type: "object" as const,
      properties: {
        id: {
          type: "string",
          description: "Product ID",
        },
      },
      required: ["id"],
    },
  },
  {
    name: "matterbase_create_product",
    description: "Create a new product in Matterbase database",
    inputSchema: {
      type: "object" as const,
      properties: {
        name: {
          type: "string",
          description: "Product name",
        },
        brandId: {
          type: "string",
          description: "Brand ID this product belongs to",
        },
        slug: {
          type: "string",
          description: "URL-friendly slug (auto-generated if not provided)",
        },
        description: {
          type: "string",
          description: "Product description",
        },
        categoryId: {
          type: "string",
          description: "Category ID",
        },
        images: {
          type: "array",
          items: { type: "string" },
          description: "Array of image URLs",
        },
        specifications: {
          type: "object",
          description: "Product specifications as key-value pairs",
        },
      },
      required: ["name", "brandId"],
    },
  },
  {
    name: "matterbase_update_product",
    description: "Update an existing product in Matterbase database",
    inputSchema: {
      type: "object" as const,
      properties: {
        id: {
          type: "string",
          description: "Product ID to update",
        },
        name: {
          type: "string",
          description: "New product name",
        },
        slug: {
          type: "string",
          description: "New URL-friendly slug",
        },
        description: {
          type: "string",
          description: "New product description",
        },
        brandId: {
          type: "string",
          description: "New brand ID",
        },
        categoryId: {
          type: "string",
          description: "New category ID",
        },
        images: {
          type: "array",
          items: { type: "string" },
          description: "New array of image URLs",
        },
        specifications: {
          type: "object",
          description: "New product specifications",
        },
        isActive: {
          type: "boolean",
          description: "Whether the product is active",
        },
      },
      required: ["id"],
    },
  },
  // Child entity tool definitions
  {
    name: "matterbase_add_product_image",
    description: "Add an image to a product (product_parent_images table)",
    inputSchema: {
      type: "object" as const,
      properties: {
        productParentId: {
          type: "string",
          description: "Product parent ID",
        },
        image: {
          type: "object",
          properties: {
            s3Key: { type: "string", description: "S3 key for the image" },
            name: { type: "string", description: "Image filename" },
            mimetype: { type: "string", description: "Image MIME type" },
          },
          required: ["s3Key", "name", "mimetype"],
          description: "Image object",
        },
        orderIndex: {
          type: "number",
          description: "Order index for image display",
        },
      },
      required: ["productParentId", "image", "orderIndex"],
    },
  },
  {
    name: "matterbase_add_product_category",
    description: "Add a category to a product (product_parent_product_category junction table)",
    inputSchema: {
      type: "object" as const,
      properties: {
        productParentId: {
          type: "string",
          description: "Product parent ID",
        },
        productCategoryId: {
          type: "string",
          description: "Product category ID",
        },
      },
      required: ["productParentId", "productCategoryId"],
    },
  },
  {
    name: "matterbase_add_product_specification",
    description: "Add a specification to a product (product_parent_specification table)",
    inputSchema: {
      type: "object" as const,
      properties: {
        productParentId: {
          type: "string",
          description: "Product parent ID",
        },
        specificationId: {
          type: "string",
          description: "Specification ID",
        },
        orderIndex: {
          type: "number",
          description: "Order index for specification display",
        },
      },
      required: ["productParentId", "specificationId", "orderIndex"],
    },
  },
  {
    name: "matterbase_create_variation",
    description: "Create a variation for a product (variation table - colors, sizes, materials)",
    inputSchema: {
      type: "object" as const,
      properties: {
        productParentId: {
          type: "string",
          description: "Product parent ID",
        },
        variationTypeId: {
          type: "string",
          description: "Variation type ID (e.g., color, size, material)",
        },
        value: {
          type: "string",
          description: "Variation value (e.g., 'Black', 'Large', 'Oak')",
        },
        image: {
          type: "object",
          properties: {
            s3Key: { type: "string" },
            name: { type: "string" },
            mimetype: { type: "string" },
          },
          description: "Optional image for this variation",
        },
        hex: {
          type: "string",
          description: "Hex color code for color variations (e.g., '#000000')",
        },
      },
      required: ["productParentId", "variationTypeId", "value"],
    },
  },
  {
    name: "matterbase_list_variations",
    description: "List all variations for a product",
    inputSchema: {
      type: "object" as const,
      properties: {
        productParentId: {
          type: "string",
          description: "Product parent ID",
        },
      },
      required: ["productParentId"],
    },
  },
  {
    name: "matterbase_create_variation_combination",
    description: "Create a variation combination (variation_combination_pending table - 3D/PBR combinations)",
    inputSchema: {
      type: "object" as const,
      properties: {
        productParentId: {
          type: "string",
          description: "Product parent ID",
        },
        signature: {
          type: "string",
          description: "Unique signature for this combination",
        },
        name: {
          type: "string",
          description: "Display name for this combination",
        },
        keyImage: {
          type: "object",
          properties: {
            s3Key: { type: "string" },
            name: { type: "string" },
            mimetype: { type: "string" },
          },
          description: "Key image for this combination",
        },
        model: {
          type: "object",
          description: "3D model file",
        },
        diffuse: {
          type: "object",
          description: "Diffuse/albedo texture",
        },
        orm: {
          type: "object",
          description: "ORM texture",
        },
        normal: {
          type: "object",
          description: "Normal map texture",
        },
        transThick: {
          type: "object",
          description: "Transmission/thickness texture",
        },
        materialValues: {
          type: "object",
          description: "Material property values",
        },
      },
      required: ["productParentId", "signature", "name"],
    },
  },
  {
    name: "matterbase_add_combination_detail",
    description: "Link a variation to a variation combination (variation_combination_detail_pending table)",
    inputSchema: {
      type: "object" as const,
      properties: {
        variationCombinationPendingId: {
          type: "string",
          description: "Variation combination pending ID",
        },
        variationId: {
          type: "string",
          description: "Variation ID to link",
        },
        isKeyVariation: {
          type: "boolean",
          description: "Whether this is the key variation for the combination",
        },
      },
      required: ["variationCombinationPendingId", "variationId", "isKeyVariation"],
    },
  },
  {
    name: "matterbase_add_combination_specification",
    description: "Add a specification to a variation combination (variation_combination_specification_pending table)",
    inputSchema: {
      type: "object" as const,
      properties: {
        variationCombinationPendingId: {
          type: "string",
          description: "Variation combination pending ID",
        },
        specificationId: {
          type: "string",
          description: "Specification ID",
        },
      },
      required: ["variationCombinationPendingId", "specificationId"],
    },
  },
];

export async function executeProductTool(
  name: string,
  args: Record<string, unknown>
): Promise<string> {
  const client = getMatterbaseClient();

  switch (name) {
    case "matterbase_list_products": {
      const parsed = productToolSchemas.matterbase_list_products.parse(args);
      const result = await client.listProducts(parsed);
      if (!result.success) {
        return JSON.stringify({ success: false, error: result.error });
      }
      return JSON.stringify({
        success: true,
        products: result.data?.data,
        pagination: {
          total: result.data?.total,
          page: result.data?.page,
          limit: result.data?.limit,
          totalPages: result.data?.totalPages,
        },
      });
    }

    case "matterbase_search_products": {
      const parsed = productToolSchemas.matterbase_search_products.parse(args);
      const result = await client.searchProducts(parsed.query, {
        page: parsed.page,
        limit: parsed.limit,
      });
      if (!result.success) {
        return JSON.stringify({ success: false, error: result.error });
      }
      return JSON.stringify({
        success: true,
        products: result.data?.data,
        query: parsed.query,
        pagination: {
          total: result.data?.total,
          page: result.data?.page,
          limit: result.data?.limit,
          totalPages: result.data?.totalPages,
        },
      });
    }

    case "matterbase_get_product": {
      const parsed = productToolSchemas.matterbase_get_product.parse(args);
      const result = await client.getProduct(parsed.id);
      if (!result.success) {
        return JSON.stringify({ success: false, error: result.error });
      }
      return JSON.stringify({
        success: true,
        product: result.data,
      });
    }

    case "matterbase_create_product": {
      const parsed = productToolSchemas.matterbase_create_product.parse(args);
      const result = await client.createProduct(parsed);
      if (!result.success) {
        return JSON.stringify({ success: false, error: result.error });
      }
      return JSON.stringify({
        success: true,
        product: result.data,
        message: `Product "${parsed.name}" created successfully`,
      });
    }

    case "matterbase_update_product": {
      const parsed = productToolSchemas.matterbase_update_product.parse(args);
      const { id, ...updates } = parsed;
      const result = await client.updateProduct(id, updates);
      if (!result.success) {
        return JSON.stringify({ success: false, error: result.error });
      }
      return JSON.stringify({
        success: true,
        product: result.data,
        message: `Product updated successfully`,
      });
    }

    // Child entity handlers
    case "matterbase_add_product_image": {
      const parsed = productToolSchemas.matterbase_add_product_image.parse(args);
      const result = await client.addProductImage(
        parsed.productParentId,
        parsed.image,
        parsed.orderIndex
      );
      if (!result.success) {
        return JSON.stringify({ success: false, error: result.error });
      }
      return JSON.stringify({
        success: true,
        productImage: result.data,
        message: `Image added to product successfully`,
      });
    }

    case "matterbase_add_product_category": {
      const parsed = productToolSchemas.matterbase_add_product_category.parse(args);
      const result = await client.addProductCategory(
        parsed.productParentId,
        parsed.productCategoryId
      );
      if (!result.success) {
        return JSON.stringify({ success: false, error: result.error });
      }
      return JSON.stringify({
        success: true,
        data: result.data,
        message: `Category added to product successfully`,
      });
    }

    case "matterbase_add_product_specification": {
      const parsed = productToolSchemas.matterbase_add_product_specification.parse(args);
      const result = await client.addProductSpecification(
        parsed.productParentId,
        parsed.specificationId,
        parsed.orderIndex
      );
      if (!result.success) {
        return JSON.stringify({ success: false, error: result.error });
      }
      return JSON.stringify({
        success: true,
        data: result.data,
        message: `Specification added to product successfully`,
      });
    }

    case "matterbase_create_variation": {
      const parsed = productToolSchemas.matterbase_create_variation.parse(args);
      const { productParentId, ...variationData } = parsed;
      const result = await client.createVariation(productParentId, variationData);
      if (!result.success) {
        return JSON.stringify({ success: false, error: result.error });
      }
      return JSON.stringify({
        success: true,
        variation: result.data,
        message: `Variation "${parsed.value}" created successfully`,
      });
    }

    case "matterbase_list_variations": {
      const parsed = productToolSchemas.matterbase_list_variations.parse(args);
      const result = await client.listVariations(parsed.productParentId);
      if (!result.success) {
        return JSON.stringify({ success: false, error: result.error });
      }
      return JSON.stringify({
        success: true,
        variations: result.data,
      });
    }

    case "matterbase_create_variation_combination": {
      const parsed = productToolSchemas.matterbase_create_variation_combination.parse(args);
      const { productParentId, ...combinationData } = parsed;
      const result = await client.createVariationCombination(productParentId, combinationData);
      if (!result.success) {
        return JSON.stringify({ success: false, error: result.error });
      }
      return JSON.stringify({
        success: true,
        variationCombination: result.data,
        message: `Variation combination "${parsed.name}" created successfully`,
      });
    }

    case "matterbase_add_combination_detail": {
      const parsed = productToolSchemas.matterbase_add_combination_detail.parse(args);
      const result = await client.addCombinationDetail(
        parsed.variationCombinationPendingId,
        parsed.variationId,
        parsed.isKeyVariation
      );
      if (!result.success) {
        return JSON.stringify({ success: false, error: result.error });
      }
      return JSON.stringify({
        success: true,
        data: result.data,
        message: `Variation linked to combination successfully`,
      });
    }

    case "matterbase_add_combination_specification": {
      const parsed = productToolSchemas.matterbase_add_combination_specification.parse(args);
      const result = await client.addCombinationSpecification(
        parsed.variationCombinationPendingId,
        parsed.specificationId
      );
      if (!result.success) {
        return JSON.stringify({ success: false, error: result.error });
      }
      return JSON.stringify({
        success: true,
        data: result.data,
        message: `Specification added to combination successfully`,
      });
    }

    default:
      return JSON.stringify({ success: false, error: `Unknown product tool: ${name}` });
  }
}
