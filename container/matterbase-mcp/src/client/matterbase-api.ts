/**
 * HTTP client for Matterbase Backend API
 */

export interface MatterbaseConfig {
  apiUrl: string;
  apiKey: string;
}

// Database schema types
export interface ProductTypeValue {
  id: string;  // e.g., "1", "2", "3"
  value: string;  // e.g., "material", "furniture", "lighting"
}

export interface CountryValue {
  id: string;  // e.g., "US", "DE"
  value: string;  // e.g., "United States", "Germany"
}

export interface BrandLogo {
  fileId: number;
  s3Key: string;
  mimeType: string;
  name: string;
  url: string;  // CloudFront URL
}

export interface Brand {
  id: string;
  name: string;
  companyName: string;
  productType: ProductTypeValue[];
  country: CountryValue;
  website: string;
  logo?: BrandLogo | null;
  contactName: string;
  contactJobTitle: string;
  contactEmail: string;
  excludedCountries: CountryValue[];
  isDisabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface UploadedImage {
  url: string;
  s3Key?: string;
  name?: string;
  mimetype?: string;
  fileId?: number;
}

// Input types for create/update operations
export interface CreateBrandInput {
  name: string;
  companyName: string;
  productType: ProductTypeValue[];
  country: CountryValue;
  website: string;
  contactName?: string;
  contactJobTitle?: string;
  contactEmail: string;
  excludedCountries?: CountryValue[];
  isDisabled?: boolean;  // Default to true for human verification
}

export interface UpdateBrandInput {
  id: string;
  name: string;
  companyName: string;
  productType: ProductTypeValue[];
  country: CountryValue;
  website: string;
  logo?: {
    file_id?: number;
    fileId?: number;
    s3_key: string;
    s3Key?: string;
    name: string;
    mimetype: string;
    mimeType?: string;
  } | null;
  contactName?: string;
  contactJobTitle?: string;
  contactEmail: string;
  excludedCountries: CountryValue[];
  isDisabled: boolean;
}

export interface Product {
  id: string;
  name: string;
  slug: string;
  description?: string;
  brandId: string;
  brandName?: string;
  categoryId?: string;
  categoryName?: string;
  images?: string[];
  specifications?: Record<string, unknown>;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function unwrapDataEnvelope<T>(value: unknown, maxDepth = 6): T {
  let current = value;

  for (let i = 0; i < maxDepth; i++) {
    if (!isRecord(current) || !Object.prototype.hasOwnProperty.call(current, "data")) {
      break;
    }

    const nested = current.data;
    if (nested === undefined || nested === null) {
      break;
    }
    current = nested;
  }

  return current as T;
}

// Input types for child entities
export interface ImageInput {
  s3Key: string;
  name: string;
  mimetype: string;
}

export interface ProductImage {
  id: string;
  productParentId: string;
  image: ImageInput;
  orderIndex: number;
}

export interface Variation {
  id: string;
  productParentId: string;
  variationTypeId: string;
  value: string;
  image?: ImageInput;
  hex?: string;
}

export interface VariationInput {
  variationTypeId: string;
  value: string;
  image?: ImageInput;
  hex?: string;
}

export interface VariationCombination {
  id: string;
  productParentId: string;
  signature: string;
  name: string;
  keyImage?: ImageInput;
  model?: ImageInput;
  diffuse?: ImageInput;
  orm?: ImageInput;
  normal?: ImageInput;
  transThick?: ImageInput;
  materialValues?: Record<string, unknown>;
}

export interface VariationCombinationInput {
  signature: string;
  name: string;
  keyImage?: ImageInput;
  model?: ImageInput;
  diffuse?: ImageInput;
  orm?: ImageInput;
  normal?: ImageInput;
  transThick?: ImageInput;
  materialValues?: Record<string, unknown>;
}

export class MatterbaseApiClient {
  private config: MatterbaseConfig;

  constructor(config: MatterbaseConfig) {
    this.config = config;
  }

  private async request<T>(
    method: string,
    endpoint: string,
    body?: Record<string, unknown>
  ): Promise<ApiResponse<T>> {
    const url = `${this.config.apiUrl}${endpoint}`;

    try {
      const response = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
          "x-api-key": this.config.apiKey,
        },
        body: body ? JSON.stringify(body) : undefined,
      });

      // Handle 404 specifically - endpoint doesn't exist
      if (response.status === 404) {
        return {
          success: false,
          error: `Endpoint not found: ${endpoint}`,
        };
      }

      // Try to parse JSON, but handle non-JSON responses
      const contentType = response.headers.get("content-type") || "";
      if (!contentType.includes("application/json")) {
        return {
          success: false,
          error: `Non-JSON response (${response.status}): ${contentType}`,
        };
      }

      const data = await response.json() as Record<string, unknown>;

      if (!response.ok) {
        return {
          success: false,
          error: (data.message as string) || (data.error as string) || `HTTP ${response.status}`,
        };
      }

      return {
        success: true,
        data: data as T,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  // Brand endpoints

  async listCountries(): Promise<ApiResponse<CountryValue[]>> {
    return this.request<CountryValue[]>("GET", "/api/v1/admin/product/data/country-list");
  }

  async listProductTypes(): Promise<ApiResponse<ProductTypeValue[]>> {
    const result = await this.request<{ data?: Array<{ id: string | number; value: string }> } | Array<{ id: string | number; value: string }>>(
      "GET",
      "/api/v1/admin/product/data/product-type-list"
    );

    if (!result.success || !result.data) {
      return result as unknown as ApiResponse<ProductTypeValue[]>;
    }

    const raw = result.data as { data?: Array<{ id: string | number; value: string }> } | Array<{ id: string | number; value: string }>;
    const rows = Array.isArray(raw) ? raw : raw.data ?? [];

    return {
      success: true,
      data: rows.map((row) => ({
        id: String(row.id),
        value: row.value,
      })),
    };
  }

  async listBrands(): Promise<ApiResponse<Brand[]>> {
    return this.request<Brand[]>("GET", "/api/v1/brand/list");
  }

  async searchBrands(query: string): Promise<ApiResponse<Brand[]>> {
    const params = new URLSearchParams({ search: query });
    return this.request<Brand[]>("GET", `/api/v1/admin/product/brand?${params}`);
  }

  async createBrand(input: CreateBrandInput): Promise<ApiResponse<Brand>> {
    const url = `${this.config.apiUrl}/api/v1/admin/product/brand/create`;

    try {
      const formData = new FormData();
      formData.append("name", JSON.stringify(input.name));
      formData.append("companyName", JSON.stringify(input.companyName));
      formData.append("productType", JSON.stringify(input.productType));
      formData.append("country", JSON.stringify(input.country));
      formData.append("website", JSON.stringify(input.website));
      formData.append("contactName", JSON.stringify(input.contactName?.trim() || "-"));
      formData.append("contactJobTitle", JSON.stringify(input.contactJobTitle?.trim() || "-"));
      formData.append("contactEmail", JSON.stringify(input.contactEmail));
      formData.append("excludedCountries", JSON.stringify(input.excludedCountries ?? []));
      formData.append("isDisabled", JSON.stringify(input.isDisabled ?? true));

      const response = await fetch(url, {
        method: "POST",
        headers: {
          "x-api-key": this.config.apiKey,
        },
        body: formData,
      });

      if (response.status === 404) {
        return {
          success: false,
          error: "Endpoint not found: /api/v1/admin/product/brand/create",
        };
      }

      const contentType = response.headers.get("content-type") || "";
      if (!contentType.includes("application/json")) {
        return {
          success: false,
          error: `Non-JSON response (${response.status}): ${contentType}`,
        };
      }

      const data = await response.json() as Record<string, unknown>;

      if (!response.ok) {
        return {
          success: false,
          error: (data.message as string) || (data.error as string) || `HTTP ${response.status}`,
        };
      }

      const brand = unwrapDataEnvelope<Brand>(data);
      return {
        success: true,
        data: brand,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  async updateBrand(input: UpdateBrandInput): Promise<ApiResponse<Brand>> {
    const url = `${this.config.apiUrl}/api/v1/admin/product/brand/update`;

    try {
      const formData = new FormData();
      formData.append("id", JSON.stringify(input.id));
      formData.append("name", JSON.stringify(input.name));
      formData.append("companyName", JSON.stringify(input.companyName));
      formData.append("productType", JSON.stringify(input.productType));
      formData.append("country", JSON.stringify(input.country));
      formData.append("website", JSON.stringify(input.website));
      formData.append("contactName", JSON.stringify(input.contactName?.trim() || "-"));
      formData.append("contactJobTitle", JSON.stringify(input.contactJobTitle?.trim() || "-"));
      formData.append("contactEmail", JSON.stringify(input.contactEmail));
      formData.append("excludedCountries", JSON.stringify(input.excludedCountries));
      formData.append("isDisabled", JSON.stringify(input.isDisabled));
      if (input.logo !== undefined) {
        formData.append("logo", JSON.stringify(input.logo));
      }

      const response = await fetch(url, {
        method: "PUT",
        headers: {
          "x-api-key": this.config.apiKey,
        },
        body: formData,
      });

      if (response.status === 404) {
        return {
          success: false,
          error: "Endpoint not found: /api/v1/admin/product/brand/update",
        };
      }

      const contentType = response.headers.get("content-type") || "";
      if (!contentType.includes("application/json")) {
        return {
          success: false,
          error: `Non-JSON response (${response.status}): ${contentType}`,
        };
      }

      const data = await response.json() as Record<string, unknown>;

      if (!response.ok) {
        return {
          success: false,
          error: (data.message as string) || (data.error as string) || `HTTP ${response.status}`,
        };
      }

      const brand = unwrapDataEnvelope<Brand>(data);
      return {
        success: true,
        data: brand,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  // Product endpoints

  async listProducts(options?: {
    page?: number;
    limit?: number;
    brandId?: string;
    categoryId?: string;
  }): Promise<ApiResponse<PaginatedResponse<Product>>> {
    const params = new URLSearchParams();
    if (options?.page) params.set("page", String(options.page));
    if (options?.limit) params.set("limit", String(options.limit));
    if (options?.brandId) params.set("brandId", options.brandId);
    if (options?.categoryId) params.set("categoryId", options.categoryId);

    const queryString = params.toString();
    const endpoint = queryString
      ? `/api/v1/product/list?${queryString}`
      : "/api/v1/product/list";

    return this.request<PaginatedResponse<Product>>("GET", endpoint);
  }

  async searchProducts(query: string, options?: {
    page?: number;
    limit?: number;
  }): Promise<ApiResponse<PaginatedResponse<Product>>> {
    const params = new URLSearchParams({ q: query });
    if (options?.page) params.set("page", String(options.page));
    if (options?.limit) params.set("limit", String(options.limit));

    return this.request<PaginatedResponse<Product>>(
      "GET",
      `/api/v1/product/search?${params}`
    );
  }

  async getProduct(id: string): Promise<ApiResponse<Product>> {
    return this.request<Product>("GET", `/api/v1/product/single/${id}`);
  }

  async createProduct(product: {
    name: string;
    slug?: string;
    description?: string;
    brandId: string;
    brandName?: string;
    categoryId?: string;
    categoryIds?: Array<{ id: string; value?: string }>;  // Array of category objects with id and optional value
    productClass?: { id: number; value: string };
    productType?: { id: number; value: string };
    images?: string[];
    specifications?: Record<string, unknown>;
    technicalSpec?: Array<{
      specificationTypeId: string;
      specificationTypeName: string;
      value: Array<{ id: string; value?: string }>;
    }>;
    productFilesArr?: Array<{ s3Key: string; name: string; mimetype: string }>;
  }): Promise<ApiResponse<Product>> {
    const url = `${this.config.apiUrl}/api/v1/admin/product/product-parent/create`;

    try {
      const formData = new FormData();
      formData.append("productName", product.name);
      formData.append("productDescription", product.description ?? JSON.stringify(""));
      formData.append("brand", JSON.stringify({ id: product.brandId, value: product.brandName ?? "" }));
      // Ensure each category has both id and value
      const categories = (product.categoryIds ?? []).map(cat => ({
        id: cat.id,
        value: cat.value ?? "",
      }));
      formData.append("productCategories", JSON.stringify(categories));
      formData.append("productClass", JSON.stringify(product.productClass ?? { id: 1, value: "testtest" }));
      formData.append("productType", JSON.stringify(product.productType ?? { id: 1, value: "material" }));
      formData.append("productFilesArr", JSON.stringify(product.productFilesArr ?? []));
      // Technical specifications
      if (product.technicalSpec && product.technicalSpec.length > 0) {
        formData.append("technicalSpec", JSON.stringify(product.technicalSpec));
      }

      const response = await fetch(url, {
        method: "POST",
        headers: {
          "x-api-key": this.config.apiKey,
          // Don't set Content-Type - let fetch set it with boundary for FormData
        },
        body: formData,
      });

      if (response.status === 404) {
        return {
          success: false,
          error: `Endpoint not found: /api/v1/admin/product/product-parent/create`,
        };
      }

      const contentType = response.headers.get("content-type") || "";
      if (!contentType.includes("application/json")) {
        return {
          success: false,
          error: `Non-JSON response (${response.status}): ${contentType}`,
        };
      }

      const data = await response.json() as Record<string, unknown>;

      if (!response.ok) {
        return {
          success: false,
          error: (data.message as string) || (data.error as string) || `HTTP ${response.status}`,
        };
      }

      return {
        success: true,
        data: data as unknown as Product,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  async updateProduct(
    id: string,
    updates: {
      name?: string;
      slug?: string;
      description?: string;
      brandId?: string;
      categoryId?: string;
      images?: string[];
      specifications?: Record<string, unknown>;
      isActive?: boolean;
    }
  ): Promise<ApiResponse<Product>> {
    return this.request<Product>(
      "PUT",
      "/api/v1/admin/product/product-parent/update",
      { id, ...updates }
    );
  }

  // Product Image endpoints

  async addProductImage(
    productParentId: string,
    image: ImageInput,
    orderIndex: number
  ): Promise<ApiResponse<ProductImage>> {
    // Use query param to specify dynamic field index (backend expects productImages-{index})
    const url = `${this.config.apiUrl}/api/v1/admin/product/product-images/update?productImages=${orderIndex}`;

    try {
      // 1. Get product details from admin endpoint to get productTypeId and productName
      const productsResult = await this.request<
        Array<{
          id: string;
          productName: string;
          productType: { id: string; value: string };
        }>
      >("GET", "/api/v1/admin/product/product-parent");

      if (!productsResult.success || !productsResult.data) {
        return { success: false, error: "Failed to fetch products" };
      }

      // Handle nested response structure
      const productsData = productsResult.data as unknown as {
        data?: Array<{
          id: string;
          productName: string;
          productType: { id: string; value: string };
        }>;
      };
      const products = productsData?.data || productsResult.data;

      const product = (products as Array<{
        id: string;
        productName: string;
        productType: { id: string; value: string };
      }>).find((p) => p.id === productParentId);

      if (!product) {
        return { success: false, error: `Product ${productParentId} not found` };
      }

      // 2. Fetch image from URL
      const imageResponse = await fetch(image.s3Key); // s3Key is actually the URL in test
      if (!imageResponse.ok) {
        return {
          success: false,
          error: `Failed to fetch image: ${imageResponse.status}`,
        };
      }
      const imageBlob = await imageResponse.blob();
      const filename = image.name || image.s3Key.split("/").pop() || "image.jpg";

      // 3. Create FormData for the update endpoint
      // All string fields must be JSON-encoded for formDataValidate middleware
      const formData = new FormData();
      formData.append("productId", JSON.stringify(productParentId));
      formData.append("productTypeId", JSON.stringify(product.productType.id));
      formData.append("productName", JSON.stringify(product.productName));
      formData.append("productImageArr", JSON.stringify([]));
      formData.append("productProjectImageArr", JSON.stringify([]));
      // Dynamic field name: productImages-{index}
      formData.append(`productImages-${orderIndex}`, imageBlob, filename);

      // 4. Send request
      const response = await fetch(url, {
        method: "PUT",
        headers: {
          "x-api-key": this.config.apiKey,
        },
        body: formData,
      });

      if (response.status === 404) {
        return {
          success: false,
          error: "Endpoint not found: /api/v1/admin/product/product-images/update",
        };
      }

      const contentType = response.headers.get("content-type") || "";
      if (!contentType.includes("application/json")) {
        return {
          success: false,
          error: `Non-JSON response (${response.status}): ${contentType}`,
        };
      }

      const data = (await response.json()) as Record<string, unknown>;

      if (!response.ok) {
        return {
          success: false,
          error:
            (data.message as string) ||
            (data.error as string) ||
            `HTTP ${response.status}`,
        };
      }

      return {
        success: true,
        data: {
          id: "new",
          productParentId,
          image,
          orderIndex,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  // Product Category endpoints

  /**
   * List all product categories
   */
  async listProductCategories(): Promise<ApiResponse<Array<{
    id: string;
    name: string;
    productType: { id: string; value: string };
  }>>> {
    const result = await this.request<{ data: Array<{
      id: string;
      name: string;
      productType: { id: string; value: string };
    }> }>("GET", "/api/v1/admin/product/product-category");

    if (result.success && result.data) {
      // Handle nested response structure
      const data = result.data as unknown as { data?: Array<{
        id: string;
        name: string;
        productType: { id: string; value: string };
      }> };
      return {
        success: true,
        data: data?.data || (result.data as unknown as Array<{
          id: string;
          name: string;
          productType: { id: string; value: string };
        }>),
      };
    }
    return result as unknown as ApiResponse<Array<{
      id: string;
      name: string;
      productType: { id: string; value: string };
    }>>;
  }

  /**
   * Find a category by name (case-insensitive)
   */
  async findCategoryByName(name: string, productTypeId?: string): Promise<ApiResponse<{
    id: string;
    name: string;
    productType: { id: string; value: string };
  } | null>> {
    const result = await this.listProductCategories();
    if (!result.success || !result.data) {
      return { success: false, error: result.error || "Failed to list categories" };
    }

    const normalizedName = name.toLowerCase().trim();
    const found = result.data.find((cat) => {
      const nameMatch = cat.name.toLowerCase().trim() === normalizedName;
      if (productTypeId) {
        return nameMatch && cat.productType.id === productTypeId;
      }
      return nameMatch;
    });

    return { success: true, data: found || null };
  }

  /**
   * Create a new product category
   */
  async createProductCategory(
    name: string,
    productType: { id: string; value: string }
  ): Promise<ApiResponse<{ id: string }>> {
    return this.request<{ id: string }>(
      "POST",
      "/api/v1/admin/product/product-category/create",
      { name, productType }
    );
  }

  /**
   * Find or create a category by name.
   * Returns existing category if found, creates new one if not.
   */
  async findOrCreateCategory(
    name: string,
    productType: { id: string; value: string }
  ): Promise<ApiResponse<{ id: string; name: string; created: boolean }>> {
    // First try to find existing
    const findResult = await this.findCategoryByName(name, productType.id);
    if (!findResult.success) {
      return { success: false, error: findResult.error };
    }

    if (findResult.data) {
      return {
        success: true,
        data: { id: findResult.data.id, name: findResult.data.name, created: false },
      };
    }

    // Not found, create new
    const createResult = await this.createProductCategory(name, productType);
    if (!createResult.success) {
      return { success: false, error: createResult.error };
    }

    // Fetch the newly created category to get its ID
    const refetchResult = await this.findCategoryByName(name, productType.id);
    if (refetchResult.success && refetchResult.data) {
      return {
        success: true,
        data: { id: refetchResult.data.id, name: refetchResult.data.name, created: true },
      };
    }

    return { success: false, error: "Created category but failed to retrieve it" };
  }

  /**
   * Note: Categories are associated with products during createProduct via productCategories field.
   * This method is kept for backwards compatibility but categories should be passed to createProduct.
   * @deprecated Use createProduct with productCategories instead
   */
  async addProductCategory(
    productParentId: string,
    productCategoryId: string
  ): Promise<ApiResponse<{ id: string }>> {
    // There's no direct endpoint to add a category to an existing product.
    // Categories must be set during product creation or via updateProduct.
    return {
      success: false,
      error: "Categories must be set during product creation via productCategories field, or use updateProduct",
    };
  }

  // Product Specification endpoints

  /**
   * List all specification types (e.g., "Width", "Content", "Country of Origin")
   */
  async listSpecificationTypes(): Promise<ApiResponse<Array<{
    id: string;
    name: string;
    isFilterable: boolean;
    orderIndex: string;
  }>>> {
    const result = await this.request<{ data: Array<{
      id: string;
      name: string;
      isFilterable: boolean;
      orderIndex: string;
    }> }>("GET", "/api/v1/admin/product/specification-type");

    if (result.success && result.data) {
      const data = result.data as unknown as { data?: Array<{
        id: string;
        name: string;
        isFilterable: boolean;
        orderIndex: string;
      }> };
      return {
        success: true,
        data: data?.data || (result.data as unknown as Array<{
          id: string;
          name: string;
          isFilterable: boolean;
          orderIndex: string;
        }>),
      };
    }
    return result as unknown as ApiResponse<Array<{
      id: string;
      name: string;
      isFilterable: boolean;
      orderIndex: string;
    }>>;
  }

  /**
   * Find a specification type by name (case-insensitive)
   */
  async findSpecificationTypeByName(name: string): Promise<ApiResponse<{
    id: string;
    name: string;
    isFilterable: boolean;
  } | null>> {
    const result = await this.listSpecificationTypes();
    if (!result.success || !result.data) {
      return { success: false, error: result.error || "Failed to list specification types" };
    }

    const normalizedName = name.toLowerCase().trim();
    const found = result.data.find((st) => st.name.toLowerCase().trim() === normalizedName);

    return { success: true, data: found || null };
  }

  /**
   * Create a new specification type
   */
  async createSpecificationType(
    name: string,
    isFilterable: boolean = true
  ): Promise<ApiResponse<{ id: string }>> {
    return this.request<{ id: string }>(
      "POST",
      "/api/v1/admin/product/specification-type/create",
      { name, isFilterable }
    );
  }

  /**
   * Find or create a specification type by name
   */
  async findOrCreateSpecificationType(
    name: string,
    isFilterable: boolean = true
  ): Promise<ApiResponse<{ id: string; name: string; created: boolean }>> {
    const findResult = await this.findSpecificationTypeByName(name);
    if (!findResult.success) {
      return { success: false, error: findResult.error };
    }

    if (findResult.data) {
      return {
        success: true,
        data: { id: findResult.data.id, name: findResult.data.name, created: false },
      };
    }

    const createResult = await this.createSpecificationType(name, isFilterable);
    if (!createResult.success) {
      return { success: false, error: createResult.error };
    }

    const refetchResult = await this.findSpecificationTypeByName(name);
    if (refetchResult.success && refetchResult.data) {
      return {
        success: true,
        data: { id: refetchResult.data.id, name: refetchResult.data.name, created: true },
      };
    }

    return { success: false, error: "Created specification type but failed to retrieve it" };
  }

  /**
   * List specification values for a given specification type
   */
  async listSpecifications(specificationTypeId: string): Promise<ApiResponse<Array<{
    id: string;
    value: string;
  }>>> {
    const result = await this.request<{ data: Array<{ id: string; value: string }> }>(
      "GET",
      `/api/v1/admin/product/data/specification-list?specificationTypeId=${specificationTypeId}`
    );

    if (result.success && result.data) {
      const data = result.data as unknown as { data?: Array<{ id: string; value: string }> };
      return {
        success: true,
        data: data?.data || (result.data as unknown as Array<{ id: string; value: string }>),
      };
    }
    return result as unknown as ApiResponse<Array<{ id: string; value: string }>>;
  }

  /**
   * Find a specification value by name within a specification type
   */
  async findSpecificationByName(
    specificationTypeId: string,
    name: string
  ): Promise<ApiResponse<{ id: string; value: string } | null>> {
    const result = await this.listSpecifications(specificationTypeId);
    if (!result.success || !result.data) {
      return { success: false, error: result.error || "Failed to list specifications" };
    }

    const normalizedName = name.toLowerCase().trim();
    const found = result.data.find((s) => s.value.toLowerCase().trim() === normalizedName);

    return { success: true, data: found || null };
  }

  /**
   * Create a new specification value
   */
  async createSpecification(
    specificationTypeId: string,
    specName: string
  ): Promise<ApiResponse<{ id: string; value: string }>> {
    return this.request<{ id: string; value: string }>(
      "POST",
      "/api/v1/admin/product/data/specification-list/create",
      { specificationTypeId: Number(specificationTypeId), specName }
    );
  }

  /**
   * Find or create a specification value within a specification type
   */
  async findOrCreateSpecification(
    specificationTypeId: string,
    specificationTypeName: string,
    value: string
  ): Promise<ApiResponse<{
    specificationTypeId: string;
    specificationTypeName: string;
    specification: { id: string; value: string };
    created: boolean;
  }>> {
    const findResult = await this.findSpecificationByName(specificationTypeId, value);
    if (!findResult.success) {
      return { success: false, error: findResult.error };
    }

    if (findResult.data) {
      return {
        success: true,
        data: {
          specificationTypeId,
          specificationTypeName,
          specification: findResult.data,
          created: false,
        },
      };
    }

    const createResult = await this.createSpecification(specificationTypeId, value);
    if (!createResult.success) {
      return { success: false, error: createResult.error };
    }

    // The create endpoint returns the new specification directly
    const responseData = createResult.data as unknown as { data?: { id: string; value: string } };
    const newSpec = responseData?.data || createResult.data;

    if (newSpec) {
      return {
        success: true,
        data: {
          specificationTypeId,
          specificationTypeName,
          specification: newSpec,
          created: true,
        },
      };
    }

    return { success: false, error: "Created specification but failed to retrieve it" };
  }

  /**
   * Note: Specifications are associated with products during createProduct via technicalSpec field.
   * This method is kept for backwards compatibility.
   * @deprecated Use createProduct with technicalSpec instead
   */
  async addProductSpecification(
    productParentId: string,
    specificationId: string,
    orderIndex: number
  ): Promise<ApiResponse<{ id: string }>> {
    return {
      success: false,
      error: "Specifications must be set during product creation via technicalSpec field, or use updateProduct",
    };
  }

  // Variation endpoints

  /**
   * List available variation types (e.g., "Image", "Data")
   */
  async listVariationTypes(): Promise<ApiResponse<Array<{
    id: string;
    value: string;
    type: string;
  }>>> {
    const result = await this.request<{ data: Array<{
      id: string;
      value: string;
      type: string;
    }> }>("GET", "/api/v1/admin/product/data/variation-type-list");

    if (result.success && result.data) {
      const data = result.data as unknown as { data?: Array<{
        id: string;
        value: string;
        type: string;
      }> };
      return {
        success: true,
        data: data?.data || (result.data as unknown as Array<{
          id: string;
          value: string;
          type: string;
        }>),
      };
    }
    return result as unknown as ApiResponse<Array<{ id: string; value: string; type: string }>>;
  }

  /**
   * List current variations for a product
   */
  async listProductVariations(
    productId: string,
    productTypeId: string
  ): Promise<ApiResponse<{
    keyVariationTypeId: string | null;
    variationArr: Array<{
      variationType: { id: string; value: string; type: string };
      variations: Array<{ id: string; value: string; hex: string | null; image?: string }>;
    }>;
  }>> {
    const params = new URLSearchParams({ productId, productTypeId });
    const result = await this.request<{ data: {
      keyVariationTypeId: string | null;
      variationArr: Array<{
        variationType: { id: string; value: string; type: string };
        variations: Array<{ id: string; value: string; hex: string | null; image?: string }>;
      }>;
    } }>("GET", `/api/v1/admin/product/product-variation-list?${params}`);

    if (result.success && result.data) {
      const data = result.data as unknown as { data?: {
        keyVariationTypeId: string | null;
        variationArr: Array<{
          variationType: { id: string; value: string; type: string };
          variations: Array<{ id: string; value: string; hex: string | null; image?: string }>;
        }>;
      } };
      return {
        success: true,
        data: data?.data || (result.data as unknown as {
          keyVariationTypeId: string | null;
          variationArr: Array<{
            variationType: { id: string; value: string; type: string };
            variations: Array<{ id: string; value: string; hex: string | null; image?: string }>;
          }>;
        }),
      };
    }
    return result as unknown as ApiResponse<{
      keyVariationTypeId: string | null;
      variationArr: Array<{
        variationType: { id: string; value: string; type: string };
        variations: Array<{ id: string; value: string; hex: string | null; image?: string }>;
      }>;
    }>;
  }

  /**
   * Update variations for a product (create/update/delete)
   * This is the main method for managing variations.
   * For image-type variations, pass imageUrl in the variation to upload an image.
   */
  async updateProductVariations(params: {
    productId: string;
    productTypeId: string;
    productName: string;
    keyVariationTypeId: string;
    variationArr: Array<{
      variationType: { id: string; value: string; type: string };
      variations: Array<{ id: string; value: string; hex: string | null; imageUrl?: string }>;
    }>;
  }): Promise<ApiResponse<{ success: boolean }>> {
    // Build query string for dynamic varImage fields
    const imageVariationIds: string[] = [];
    for (const group of params.variationArr) {
      if (group.variationType.type === "image") {
        for (const v of group.variations) {
          if (v.imageUrl) {
            imageVariationIds.push(v.id);
          }
        }
      }
    }

    const queryParams = imageVariationIds.map(id => `varImage=${id}`).join("&");
    const url = `${this.config.apiUrl}/api/v1/admin/product/product-variation-list/update${queryParams ? `?${queryParams}` : ""}`;

    try {
      const formData = new FormData();
      formData.append("productId", JSON.stringify(params.productId));
      formData.append("productTypeId", JSON.stringify(params.productTypeId));
      formData.append("productName", JSON.stringify(params.productName));
      formData.append("keyVariationTypeId", JSON.stringify(params.keyVariationTypeId));

      // Strip imageUrl from variationArr before sending (it's not part of the schema)
      const cleanVariationArr = params.variationArr.map(group => ({
        variationType: group.variationType,
        variations: group.variations.map(v => ({
          id: v.id,
          value: v.value,
          hex: v.hex,
        })),
      }));
      formData.append("variationArr", JSON.stringify(cleanVariationArr));

      // Fetch and append images for image-type variations
      for (const group of params.variationArr) {
        if (group.variationType.type === "image") {
          for (const v of group.variations) {
            if (v.imageUrl) {
              const imageResponse = await fetch(v.imageUrl);
              if (imageResponse.ok) {
                const imageBlob = await imageResponse.blob();
                const filename = v.imageUrl.split("/").pop() || "image.jpg";
                formData.append(`varImage-${v.id}`, imageBlob, filename);
              }
            }
          }
        }
      }

      const response = await fetch(url, {
        method: "PUT",
        headers: {
          "x-api-key": this.config.apiKey,
        },
        body: formData,
      });

      if (response.status === 404) {
        return {
          success: false,
          error: "Endpoint not found: /api/v1/admin/product/product-variation-list/update",
        };
      }

      const contentType = response.headers.get("content-type") || "";
      if (!contentType.includes("application/json")) {
        return {
          success: false,
          error: `Non-JSON response (${response.status}): ${contentType}`,
        };
      }

      const data = (await response.json()) as Record<string, unknown>;

      if (!response.ok) {
        return {
          success: false,
          error:
            (data.message as string) ||
            (data.error as string) ||
            `HTTP ${response.status}`,
        };
      }

      return { success: true, data: { success: true } };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Add a variation to a product.
   * Uses a single variation type (the key variation type) for simplicity.
   * Each variation generates one product combination automatically.
   * For image-type variations, pass imageUrl to upload an image.
   */
  async addVariation(
    productId: string,
    productTypeId: string,
    productName: string,
    variationType: { id: string; value: string; type: string },
    variation: { value: string; hex?: string | null; imageUrl?: string }
  ): Promise<ApiResponse<{ id: string; value: string }>> {
    // 1. Get current variations
    const currentResult = await this.listProductVariations(productId, productTypeId);

    let variationArr: Array<{
      variationType: { id: string; value: string; type: string };
      variations: Array<{ id: string; value: string; hex: string | null; imageUrl?: string }>;
    }> = [];

    if (currentResult.success && currentResult.data) {
      variationArr = currentResult.data.variationArr || [];
    }

    // 2. Find or create the variation type group (single layer only)
    let typeGroup = variationArr.find(g => g.variationType.id === variationType.id);
    if (!typeGroup) {
      // Clear any other variation types - keep only one layer
      variationArr = [{
        variationType,
        variations: [],
      }];
      typeGroup = variationArr[0];
    }

    // 3. Add the new variation with a temp ID
    const tempId = `temp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    typeGroup.variations.push({
      id: tempId,
      value: variation.value,
      hex: variation.hex ?? null,
      imageUrl: variation.imageUrl,
    });

    // 4. keyVariationTypeId is always the single variation type being used
    const keyVariationTypeId = variationType.id;

    // 5. Update variations
    const updateResult = await this.updateProductVariations({
      productId,
      productTypeId,
      productName,
      keyVariationTypeId,
      variationArr,
    });

    if (!updateResult.success) {
      return { success: false, error: updateResult.error };
    }

    // 6. Fetch updated variations to get the real ID
    const updatedResult = await this.listProductVariations(productId, productTypeId);
    if (updatedResult.success && updatedResult.data) {
      const updatedGroup = updatedResult.data.variationArr.find(
        g => g.variationType.id === variationType.id
      );
      const newVariation = updatedGroup?.variations.find(
        v => v.value === variation.value
      );
      if (newVariation) {
        return {
          success: true,
          data: { id: newVariation.id, value: newVariation.value },
        };
      }
    }

    return {
      success: true,
      data: { id: tempId, value: variation.value },
    };
  }

  /**
   * @deprecated Use addVariation or updateProductVariations instead
   */
  async createVariation(
    productParentId: string,
    variation: VariationInput
  ): Promise<ApiResponse<Variation>> {
    return {
      success: false,
      error: "Use addVariation() or updateProductVariations() instead. Variations are managed via the update endpoint.",
    };
  }

  async listVariations(productParentId: string): Promise<ApiResponse<Variation[]>> {
    const params = new URLSearchParams({ productParentId });
    return this.request<Variation[]>(
      "GET",
      `/api/v1/admin/product/variation?${params}`
    );
  }

  // Variation Combination endpoints

  /**
   * List variation combinations for a product.
   * Returns the auto-generated combinations created when variations are added.
   * Tries multiple endpoint patterns as the backend may use different routes.
   */
  async listVariationCombinations(
    productId: string,
    status: "pending" | "active" = "pending"
  ): Promise<
    ApiResponse<
      Array<{
        id: string;
        name: string;
        signature?: string;
        productParentId?: string;
      }>
    >
  > {
    // Try different endpoint patterns
    const endpoints = [
      `/api/v1/admin/product/product-variation/list?productId=${productId}&status=${status}`,
      `/api/v1/admin/product/variation-combination-${status}/list?productId=${productId}`,
      `/api/v1/admin/product/variation-combination/list?productId=${productId}&status=${status}`,
    ];

    for (const endpoint of endpoints) {
      const url = `${this.config.apiUrl}${endpoint}`;
      console.log("[MatterbaseAPI] listVariationCombinations trying:", url);

      try {
        const response = await fetch(url, {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": this.config.apiKey,
          },
        });

        if (response.status === 404) {
          continue; // Try next endpoint
        }

        const responseText = await response.text();
        console.log(
          "[MatterbaseAPI] listVariationCombinations response status:",
          response.status
        );
        console.log(
          "[MatterbaseAPI] listVariationCombinations response:",
          responseText.substring(0, 500)
        );

        if (!response.ok) {
          continue; // Try next endpoint
        }

        let data;
        try {
          data = JSON.parse(responseText);
        } catch {
          continue; // Try next endpoint
        }

        // Handle various response structures
        const combinations =
          data?.data?.combinations ||
          data?.data?.variationCombinations ||
          data?.data ||
          data?.combinations ||
          data ||
          [];

        if (Array.isArray(combinations) && combinations.length > 0) {
          return {
            success: true,
            data: combinations,
          };
        }
      } catch (error) {
        console.log("[MatterbaseAPI] listVariationCombinations endpoint failed:", endpoint);
        continue; // Try next endpoint
      }
    }

    // All endpoints failed
    return {
      success: false,
      error: "Endpoint not found: variation combination list",
    };
  }

  async createVariationCombination(
    productParentId: string,
    combination: VariationCombinationInput
  ): Promise<ApiResponse<VariationCombination>> {
    return this.request<VariationCombination>(
      "POST",
      "/api/v1/admin/product/variation-combination-pending/create",
      { productParentId, ...combination }
    );
  }

  async addCombinationDetail(
    variationCombinationPendingId: string,
    variationId: string,
    isKeyVariation: boolean
  ): Promise<ApiResponse<{ id: string }>> {
    return this.request<{ id: string }>(
      "POST",
      "/api/v1/admin/product/variation-combination-detail-pending/create",
      { variationCombinationPendingId, variationId, isKeyVariation }
    );
  }

  async addCombinationSpecification(
    variationCombinationPendingId: string,
    specificationId: string
  ): Promise<ApiResponse<{ id: string }>> {
    return this.request<{ id: string }>(
      "POST",
      "/api/v1/admin/product/variation-combination-specification-pending/create",
      { variationCombinationPendingId, specificationId }
    );
  }

  /**
   * Update variation combination specifications.
   * Specs can either inherit from product_parent (isUnique: false) or be overridden (isUnique: true).
   * To remove a spec from a variation, simply don't include it in the technicalSpec array.
   *
   * @param params.id - Variation combination ID
   * @param params.productId - Product parent ID
   * @param params.status - 'pending' or 'active'
   * @param params.variationName - Name of the variation combination
   * @param params.technicalSpec - Array of specifications to set
   */
  async updateVariationCombinationSpecs(params: {
    id: string;
    productId: string;
    status: "pending" | "active";
    variationName: string;
    technicalSpec: Array<{
      isUnique: boolean;
      specificationTypeId: string;
      specificationTypeName: string;
      value?: Array<{ id: string; value: string }>;
    }>;
  }): Promise<
    ApiResponse<{
      success: boolean;
      message?: string;
    }>
  > {
    const url = `${this.config.apiUrl}/api/v1/admin/product/product-variation/update`;

    const body = {
      id: params.id,
      productId: params.productId,
      status: params.status,
      variationName: params.variationName,
      technicalSpec: params.technicalSpec,
    };

    console.log(
      "[MatterbaseAPI] updateVariationCombinationSpecs request:",
      JSON.stringify(body, null, 2)
    );

    try {
      const response = await fetch(url, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": this.config.apiKey,
        },
        body: JSON.stringify(body),
      });

      const responseText = await response.text();
      console.log(
        "[MatterbaseAPI] updateVariationCombinationSpecs response status:",
        response.status
      );
      console.log(
        "[MatterbaseAPI] updateVariationCombinationSpecs response:",
        responseText
      );

      if (!response.ok) {
        return {
          success: false,
          error: `HTTP ${response.status}: ${responseText}`,
        };
      }

      // Parse response if JSON
      let data;
      try {
        data = JSON.parse(responseText);
      } catch {
        data = { message: responseText };
      }

      return {
        success: true,
        data: {
          success: true,
          message: data.message || "Variation combination specs updated",
        },
      };
    } catch (error) {
      console.error(
        "[MatterbaseAPI] updateVariationCombinationSpecs error:",
        error
      );
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to update variation combination specs",
      };
    }
  }

  // Upload endpoints

  async uploadImageFromUrl(
    imageUrl: string,
    filename?: string
  ): Promise<ApiResponse<UploadedImage>> {
    const uploadEndpoint = `${this.config.apiUrl}/api/v1/admin/matterai/upload-file`;

    try {
      // Fetch the image from the source URL (with retries for transient CDN errors)
      const maxRetries = 3;
      let imageResponse: Response | undefined;
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          imageResponse = await fetch(imageUrl);
          if (imageResponse.ok) break;
          // Only retry on 5xx (server/CDN transient errors)
          if (imageResponse.status < 500 || attempt === maxRetries) {
            return {
              success: false,
              error: `Failed to fetch image: HTTP ${imageResponse.status}`,
            };
          }
        } catch (err) {
          // Network error — retry unless last attempt
          if (attempt === maxRetries) {
            return {
              success: false,
              error: `Failed to fetch image: ${err instanceof Error ? err.message : "Network error"}`,
            };
          }
        }
        const delay = 1000 * 2 ** attempt;
        console.error(`[matterbase] Image fetch retry ${attempt + 1}/${maxRetries} in ${delay}ms`);
        await new Promise((r) => setTimeout(r, delay));
      }

      if (!imageResponse) {
        return { success: false, error: "Failed to fetch image: no response" };
      }

      const contentType = imageResponse.headers.get("content-type") || "image/jpeg";
      const imageBuffer = await imageResponse.arrayBuffer();

      // Determine filename and extension
      const urlPath = new URL(imageUrl).pathname;
      const urlFilename = urlPath.split("/").pop() || "image";
      const extension = urlFilename.includes(".")
        ? urlFilename.split(".").pop()
        : contentType.split("/").pop() || "jpg";
      const finalFilename = filename
        ? `${filename}.${extension}`
        : urlFilename.includes(".")
          ? urlFilename
          : `${urlFilename}.${extension}`;

      // Create FormData with the file
      const formData = new FormData();
      const blob = new Blob([imageBuffer], { type: contentType });
      formData.append("file", blob, finalFilename);

      const uploadWithHeaders = async (
        headers: Record<string, string>
      ): Promise<{
        response: Response;
        data: Record<string, unknown>;
        payload: Record<string, unknown>;
      }> => {
        const response = await fetch(uploadEndpoint, {
          method: "POST",
          headers,
          body: formData,
        });

        const responseText = await response.text();
        let data: Record<string, unknown> = {};
        try {
          data = JSON.parse(responseText) as Record<string, unknown>;
        } catch {
          data = { raw: responseText };
        }
        const payload = (data.data as Record<string, unknown>) ?? data;
        return { response, data, payload };
      };

      // Try x-api-key first (works for most admin endpoints), then bearer fallback for stricter upload auth.
      let attempt = await uploadWithHeaders({
        "x-api-key": this.config.apiKey,
      });
      if (attempt.response.status === 401) {
        attempt = await uploadWithHeaders({
          Authorization: `Bearer ${this.config.apiKey}`,
          "x-api-key": this.config.apiKey,
        });
      }

      const uploadedUrl =
        (attempt.payload.url as string) ||
        (attempt.data.url as string);
      const fallbackS3KeyFromUrl = (() => {
        try {
          const parsed = new URL(uploadedUrl);
          return parsed.pathname.replace(/^\/+/, "");
        } catch {
          return undefined;
        }
      })();

      // Some backend deployments incorrectly return 401 while still returning a valid upload URL.
      // Treat it as success only when backend actually returns upload metadata.
      if (!attempt.response.ok && !uploadedUrl) {
        return {
          success: false,
          error:
            (attempt.data.message as string) ||
            (attempt.data.error as string) ||
            (attempt.data.raw as string) ||
            `HTTP ${attempt.response.status}`,
        };
      }
      const s3Key =
        (attempt.payload.s3Key as string) ||
        (attempt.payload.s3_key as string) ||
        (attempt.data.s3Key as string) ||
        (attempt.data.s3_key as string) ||
        fallbackS3KeyFromUrl;
      const urlForResponse = uploadedUrl ?? imageUrl;
      const fileIdRaw =
        attempt.payload.fileId ??
        attempt.payload.file_id ??
        attempt.data.fileId ??
        attempt.data.file_id;
      const fileId =
        typeof fileIdRaw === "number"
          ? fileIdRaw
          : typeof fileIdRaw === "string" && fileIdRaw.trim() !== ""
            ? Number(fileIdRaw)
            : undefined;

      return {
        success: true,
        data: {
          url: urlForResponse,
          s3Key,
          name: (attempt.payload.name as string) || finalFilename,
          mimetype: (attempt.payload.mimetype as string) || contentType,
          fileId: Number.isFinite(fileId) ? fileId : undefined,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }
}

let client: MatterbaseApiClient | null = null;

export function getMatterbaseClient(): MatterbaseApiClient {
  if (!client) {
    const apiUrl = process.env.MATTERBASE_API_URL;
    const apiKey = process.env.MATTERBASE_API_KEY;

    if (!apiUrl) {
      throw new Error("MATTERBASE_API_URL environment variable not set");
    }
    if (!apiKey) {
      throw new Error("MATTERBASE_API_KEY environment variable not set");
    }

    client = new MatterbaseApiClient({ apiUrl, apiKey });
  }
  return client;
}
