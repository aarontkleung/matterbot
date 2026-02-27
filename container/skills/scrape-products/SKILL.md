---
name: Scrape Products
description: Scrape product data from Architonic and create in Matterbase
---

# Scrape Products

Guide the user through scraping products for a brand from Architonic and creating them in Matterbase following the systematic schema hierarchy.

## Schema Hierarchy (Entry Order)

Products must be created following this systematic order:

```
1. product_parent              → Base product
2. product_parent_images       → Product images
3. product_parent_product_category → Category assignments
4. product_parent_specification → Specifications
5. variation                   → Individual variations (color, size, material)
6. variation_combination_pending → 3D/PBR combinations
7. variation_combination_detail_pending → Links combinations to variations
8. variation_combination_specification_pending → Combination-specific specs
```

## Workflow

1. **Ask for brand**: Prompt the user to specify which brand to scrape products for

2. **Verify brand exists**: Use `matterbase_search_brands` to find the brand and get its UUID

3. **Ask for limit**: How many products to scrape (default: 50)

4. **Execute scraping**:
   - Use `list_products_by_brand` to fetch all product URLs
   - Parse the returned markdown to extract product names and URLs
   - For each product, follow the **Systematic Product Creation** workflow below

5. **Report progress**: Show "Scraped X/Y products" as you go

6. **Summarize**: Report total scraped, skipped (duplicates), and any errors

## Systematic Product Creation

For each scraped product, follow these steps in order:

### Step 1: Create Product Parent

Use `matterbase_create_product` with base product data:

```json
{
  "name": "Example Chair",
  "brandId": "brand-uuid",
  "description": "Modern office chair with ergonomic design",
  "designerName": "Designer Name"
}
```

**Save the returned product ID** for subsequent steps.

### Step 2: Add Images

For each image, first upload then add to product:

1. Upload via `matterbase_upload_image`:
```json
{
  "imageUrl": "https://architonic.com/product-image.jpg",
  "filename": "product-name-1",
  "folder": "products"
}
```

2. Add to product via `matterbase_add_product_image`:
```json
{
  "productParentId": "product-uuid",
  "image": {
    "s3Key": "products/product-name-1.jpg",
    "name": "product-name-1.jpg",
    "mimetype": "image/jpeg"
  },
  "orderIndex": 0
}
```

### Step 3: Add Categories

Use `matterbase_add_product_category` for each category:

```json
{
  "productParentId": "product-uuid",
  "productCategoryId": "category-uuid"
}
```

Map Architonic categories to Matterbase category IDs (see Category Mapping below).

### Step 4: Add Specifications

Use `matterbase_add_product_specification` for dimensions and other specs:

```json
{
  "productParentId": "product-uuid",
  "specificationId": "width-spec-uuid",
  "orderIndex": 0
}
```

### Step 5: Create Variations

For each color, size, or material option, use `matterbase_create_variation`:

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
  "value": "Oak"
}
```

**Save all returned variation IDs** for combination linking.

### Step 6: Create Variation Combinations

For each unique combination of variations, use `matterbase_create_variation_combination`:

```json
{
  "productParentId": "product-uuid",
  "signature": "black-large-oak",
  "name": "Black / Large / Oak",
  "keyImage": {
    "s3Key": "products/chair-black-large-oak.jpg",
    "name": "chair-black-large-oak.jpg",
    "mimetype": "image/jpeg"
  }
}
```

**Save the returned combination ID** for linking.

### Step 7: Link Combination Details

For each variation in the combination, use `matterbase_add_combination_detail`:

```json
{
  "variationCombinationPendingId": "combination-uuid",
  "variationId": "black-variation-uuid",
  "isKeyVariation": true
}
```

Set `isKeyVariation: true` for the primary variation (usually color).

### Step 8: Add Combination Specifications (Optional)

If the combination has specific specs, use `matterbase_add_combination_specification`:

```json
{
  "variationCombinationPendingId": "combination-uuid",
  "specificationId": "spec-uuid"
}
```

## Field Mapping from Architonic

| Architonic Data | Target Entity | MCP Tool |
|-----------------|---------------|----------|
| Product name | product_parent | matterbase_create_product |
| Description | product_parent | matterbase_create_product |
| Brand | product_parent | matterbase_create_product |
| Images[] | product_parent_images | matterbase_add_product_image |
| Category | product_parent_product_category | matterbase_add_product_category |
| Dimensions | product_parent_specification | matterbase_add_product_specification |
| Colors[] | variation | matterbase_create_variation |
| Sizes[] | variation | matterbase_create_variation |
| Materials[] | variation | matterbase_create_variation |
| Color+Size combos | variation_combination_pending | matterbase_create_variation_combination |

## Category Mapping Quick Reference

### Furniture

| Architonic | productCategory |
|------------|-----------------|
| Chairs | chairs |
| Office chairs | office-chairs |
| Sofas | sofas |
| Tables | tables |
| Desks | desks |
| Storage | storage |

### Lighting

| Architonic | productCategory |
|------------|-----------------|
| Pendant lights | pendant-lights |
| Floor lamps | floor-lamps |
| Table lamps | table-lamps |
| Wall lights | wall-lights |

## MCP Tools Reference

### Product Parent
- `matterbase_create_product` - Create base product
- `matterbase_update_product` - Update product
- `matterbase_search_products` - Check for duplicates

### Child Entities
- `matterbase_add_product_image` - Add image to product
- `matterbase_add_product_category` - Add category to product
- `matterbase_add_product_specification` - Add specification to product

### Variations
- `matterbase_create_variation` - Create variation (color/size/material)
- `matterbase_list_variations` - List existing variations

### Variation Combinations
- `matterbase_create_variation_combination` - Create combination
- `matterbase_add_combination_detail` - Link variation to combination
- `matterbase_add_combination_specification` - Add spec to combination

## Example Interaction

User: "Scrape products for Vitra"

Agent: "I'll scrape products for Vitra from Architonic. Let me first verify the brand exists in Matterbase."

[Searches for Vitra, finds brand UUID]

Agent: "Found Vitra (ID: abc-123). How many products would you like to scrape? (default: 50)"

User: "5"

Agent: "Fetching product list for Vitra..."

[Lists products, then for each:]

Agent: "Scraped 1/5: Eames Lounge Chair
- Creating product parent...
- Adding 4 images...
- Adding category: chairs...
- Adding specifications: width, height, depth...
- Creating 3 color variations: Black, White, Walnut...
- Creating 3 variation combinations..."

[Continues until complete]

Agent: "Complete! Scraped 5 products:
- Created: 4
- Skipped (duplicates): 1
- Errors: 0

Each product created with:
- Product parent entry
- Images added to product_parent_images
- Categories linked via product_parent_product_category
- Specifications added to product_parent_specification
- Variations created in variation table
- Combinations created in variation_combination_pending"
