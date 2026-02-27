---
name: Matterbase Schema
description: Database schema reference for Matterbase brands and products
---

# Matterbase Schema

Reference for Matterbase database structure, field requirements, and data types.

## Product Types

Matterbase supports three product types:

| Type | Description |
|------|-------------|
| furniture | Tables, chairs, sofas, storage, beds |
| lighting | Pendant, floor, table, wall lights |
| material | Surfaces, textiles, flooring, finishes |

## Core Entities

### Brands

Manufacturers and design companies. Each product belongs to one brand.

Key fields: name, companyName, productType[], countryCode, website, logo

See: [references/brands.md](references/brands.md)

### Products

Product parents with variations. Products belong to a brand and have a type/category.

Key fields: name, brandId, productType, productCategory, images[], specifications

See: [references/products.md](references/products.md)

## Image Handling

All images are uploaded to Matterbase storage and referenced by S3 key.

### Upload Workflow

1. Call `matterbase_upload_image` with source URL and folder
2. Extract S3 key from returned CDN URL
3. Include image object in create/update calls

### Image Object Structure

```json
{
  "s3Key": "folder/filename.jpg",
  "name": "filename.jpg",
  "mimetype": "image/jpeg"
}
```

### Folders

| Entity | Folder |
|--------|--------|
| Brand logos | brands |
| Product images | products |
| Textures | textures |

## Data Mappings

For Architonic to Matterbase field mappings:

- Product type mapping
- Product category mapping
- Country code mapping
- Specification mapping

See: [references/mappings.md](references/mappings.md)

## MCP Tools

### Brand Tools

- `matterbase_list_brands` - List with pagination
- `matterbase_search_brands` - Search by name
- `matterbase_create_brand` - Create new brand
- `matterbase_update_brand` - Update existing brand

### Product Tools

- `matterbase_list_products` - List with pagination
- `matterbase_search_products` - Search by name
- `matterbase_get_product` - Get by ID
- `matterbase_create_product` - Create new product
- `matterbase_update_product` - Update existing product

### Utility Tools

- `matterbase_upload_image` - Upload image to storage
