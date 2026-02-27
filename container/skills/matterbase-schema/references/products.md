# Product Schema Reference

## Entity Hierarchy

Products in Matterbase follow a systematic hierarchy. When creating products, entries must be made in this order:

```
1. product_parent                          → Base product
2. product_parent_images                   → Product images
3. product_parent_product_category         → Category assignments (junction)
4. product_parent_specification            → Specifications
5. variation                               → Individual variations (color, size, material)
6. variation_combination_pending           → 3D/PBR combinations awaiting approval
7. variation_combination_detail_pending    → Links combinations to variations
8. variation_combination_specification_pending → Combination-specific specs
```

---

## 1. Product Parent (`product_parent`)

Base product information. All other entities reference this.

### Required Fields

| Field | Type | Description |
|-------|------|-------------|
| name | string | Product display name |
| brandId | uuid | UUID of the brand |

### Optional Fields

| Field | Type | Description |
|-------|------|-------------|
| description | string | Product description |
| designerName | string | Designer/architect name |
| slug | string | URL-friendly slug (auto-generated) |

### MCP Tool: `matterbase_create_product`

```json
{
  "name": "Example Chair",
  "brandId": "brand-uuid",
  "description": "Modern office chair with ergonomic design",
  "designerName": "Designer Name"
}
```

---

## 2. Product Images (`product_parent_images`)

Multiple images per product, stored separately with ordering.

### Fields

| Field | Type | Description |
|-------|------|-------------|
| productParentId | uuid | Reference to product_parent |
| image | jsonb | Image object (s3Key, name, mimetype) |
| orderIndex | integer | Display order (0-based) |

### Image Object Structure

```json
{
  "s3Key": "products/product-image.jpg",
  "name": "product-image.jpg",
  "mimetype": "image/jpeg"
}
```

### MCP Tool: `matterbase_add_product_image`

```json
{
  "productParentId": "product-uuid",
  "image": {
    "s3Key": "products/chair-front.jpg",
    "name": "chair-front.jpg",
    "mimetype": "image/jpeg"
  },
  "orderIndex": 0
}
```

### Image Upload Workflow

1. Upload via `matterbase_upload_image` with `folder: "products"`
2. Extract S3 key from returned URL
3. Add to product via `matterbase_add_product_image`

---

## 3. Product Categories (`product_parent_product_category`)

Junction table linking products to categories (many-to-many).

### Fields

| Field | Type | Description |
|-------|------|-------------|
| productParentId | uuid | Reference to product_parent |
| productCategoryId | uuid | Reference to product_category |

### MCP Tool: `matterbase_add_product_category`

```json
{
  "productParentId": "product-uuid",
  "productCategoryId": "chairs-category-uuid"
}
```

---

## 4. Product Specifications (`product_parent_specification`)

Links products to specifications with ordering.

### Fields

| Field | Type | Description |
|-------|------|-------------|
| productParentId | uuid | Reference to product_parent |
| specificationId | uuid | Reference to specification |
| orderIndex | integer | Display order |

### MCP Tool: `matterbase_add_product_specification`

```json
{
  "productParentId": "product-uuid",
  "specificationId": "width-spec-uuid",
  "orderIndex": 0
}
```

### Common Specifications

- Dimensions: width, height, depth (in cm)
- Weight (in kg)
- Materials
- Colors

---

## 5. Variations (`variation`)

Individual variation values for a product (colors, sizes, materials, finishes).

### Fields

| Field | Type | Description |
|-------|------|-------------|
| productParentId | uuid | Reference to product_parent |
| variationTypeId | uuid | Type of variation (color, size, material) |
| value | string | Variation value (e.g., "Black", "Large") |
| image | jsonb | Optional image for this variation |
| hex | string | Hex color code for color variations |

### MCP Tool: `matterbase_create_variation`

**Color variation:**
```json
{
  "productParentId": "product-uuid",
  "variationTypeId": "color-type-uuid",
  "value": "Black",
  "hex": "#000000"
}
```

**Size variation:**
```json
{
  "productParentId": "product-uuid",
  "variationTypeId": "size-type-uuid",
  "value": "Large"
}
```

**Material variation:**
```json
{
  "productParentId": "product-uuid",
  "variationTypeId": "material-type-uuid",
  "value": "Oak",
  "image": {
    "s3Key": "variations/oak-swatch.jpg",
    "name": "oak-swatch.jpg",
    "mimetype": "image/jpeg"
  }
}
```

### MCP Tool: `matterbase_list_variations`

```json
{
  "productParentId": "product-uuid"
}
```

---

## 6. Variation Combinations (`variation_combination_pending`)

Combinations of variations with 3D/PBR assets, awaiting approval.

### Fields

| Field | Type | Description |
|-------|------|-------------|
| productParentId | uuid | Reference to product_parent |
| signature | string | Unique identifier (e.g., "black-large-oak") |
| name | string | Display name (e.g., "Black / Large / Oak") |
| keyImage | jsonb | Primary image for this combination |
| model | jsonb | 3D model file |
| diffuse | jsonb | Diffuse/albedo texture |
| orm | jsonb | ORM (Occlusion, Roughness, Metallic) texture |
| normal | jsonb | Normal map texture |
| transThick | jsonb | Transmission/thickness texture |
| materialValues | jsonb | Material property values |

### MCP Tool: `matterbase_create_variation_combination`

```json
{
  "productParentId": "product-uuid",
  "signature": "black-large-oak",
  "name": "Black / Large / Oak",
  "keyImage": {
    "s3Key": "products/chair-black-large-oak.jpg",
    "name": "chair-black-large-oak.jpg",
    "mimetype": "image/jpeg"
  },
  "model": {
    "s3Key": "models/chair-black-large-oak.glb",
    "name": "chair.glb",
    "mimetype": "model/gltf-binary"
  },
  "diffuse": {
    "s3Key": "textures/chair-diffuse.jpg",
    "name": "diffuse.jpg",
    "mimetype": "image/jpeg"
  },
  "orm": {
    "s3Key": "textures/chair-orm.jpg",
    "name": "orm.jpg",
    "mimetype": "image/jpeg"
  },
  "normal": {
    "s3Key": "textures/chair-normal.jpg",
    "name": "normal.jpg",
    "mimetype": "image/jpeg"
  }
}
```

---

## 7. Combination Details (`variation_combination_detail_pending`)

Links variation combinations to their constituent variations.

### Fields

| Field | Type | Description |
|-------|------|-------------|
| variationCombinationPendingId | uuid | Reference to variation_combination_pending |
| variationId | uuid | Reference to variation |
| isKeyVariation | boolean | Whether this is the primary variation |

### MCP Tool: `matterbase_add_combination_detail`

```json
{
  "variationCombinationPendingId": "combination-uuid",
  "variationId": "black-variation-uuid",
  "isKeyVariation": true
}
```

For a combination "Black / Large / Oak", you would add three details:
1. Black color variation (`isKeyVariation: true`)
2. Large size variation (`isKeyVariation: false`)
3. Oak material variation (`isKeyVariation: false`)

---

## 8. Combination Specifications (`variation_combination_specification_pending`)

Specifications specific to a variation combination.

### Fields

| Field | Type | Description |
|-------|------|-------------|
| variationCombinationPendingId | uuid | Reference to variation_combination_pending |
| specificationId | uuid | Reference to specification |

### MCP Tool: `matterbase_add_combination_specification`

```json
{
  "variationCombinationPendingId": "combination-uuid",
  "specificationId": "weight-spec-uuid"
}
```

---

## MCP Tools Summary

### Product Parent
| Tool | Description |
|------|-------------|
| `matterbase_list_products` | List products with pagination |
| `matterbase_search_products` | Search products by name |
| `matterbase_get_product` | Get product by ID |
| `matterbase_create_product` | Create base product |
| `matterbase_update_product` | Update existing product |

### Child Entities
| Tool | Description |
|------|-------------|
| `matterbase_add_product_image` | Add image to product |
| `matterbase_add_product_category` | Add category to product |
| `matterbase_add_product_specification` | Add specification to product |

### Variations
| Tool | Description |
|------|-------------|
| `matterbase_create_variation` | Create variation (color/size/material) |
| `matterbase_list_variations` | List variations for a product |

### Variation Combinations
| Tool | Description |
|------|-------------|
| `matterbase_create_variation_combination` | Create combination with 3D/PBR assets |
| `matterbase_add_combination_detail` | Link variation to combination |
| `matterbase_add_combination_specification` | Add spec to combination |

### Utilities
| Tool | Description |
|------|-------------|
| `matterbase_upload_image` | Upload image to storage |
