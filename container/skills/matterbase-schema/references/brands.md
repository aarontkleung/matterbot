# Brand Schema Reference

## Brand Table Structure

The `brand` table stores manufacturer/brand information.

### Required Fields for Creation

| Field | Type | Description |
|-------|------|-------------|
| name | string | Brand display name |
| companyName | string | Legal company name (usually same as name) |
| productType | string[] | Array of: "material", "furniture", "lighting" |
| countryCode | string | ISO 2-letter code (e.g., "DE", "US") |
| countryName | string | Full country name |
| website | string | Brand website URL |
| contactName | string | Contact person name (prefer Architonic scrape contact, else default: "Unknown") |
| contactJobTitle | string | Contact title (prefer Architonic scrape contact, else default: "Contact") |
| contactEmail | string | Contact email (prefer Architonic scrape email, else fallback: "info@domain.com") |

### Optional Fields

| Field | Type | Description |
|-------|------|-------------|
| excludedCountries | string[] | Countries where brand is unavailable |
| logo | object | Logo image object (see below) |
| isDisabled | boolean | Whether brand is disabled |

## Logo Object Structure

Logos cannot be set during brand creation. Upload first, then update.

```json
{
  "s3Key": "brands/logo-filename.png",
  "name": "logo-filename.png",
  "mimetype": "image/png",
  "fileId": 12345
}
```

### Logo Upload Workflow

1. Upload image via `matterbase_upload_image`
2. Extract `s3Key` from response (or URL fallback), and keep `fileId` when present
3. Update brand with logo object via `matterbase_update_brand`

**Example:**
- Returned URL: `https://cdn.matterbase.com/brands/example-logo.png`
- S3 key: `brands/example-logo.png`

## MCP Brand Tools

### matterbase_list_brands

List all brands with pagination.

```json
{ "page": 1, "limit": 50 }
```

### matterbase_search_brands

Search brands by name.

```json
{ "query": "Vitra" }
```

### matterbase_create_brand

Create a new brand (without logo).

```json
{
  "name": "Example Brand",
  "companyName": "Example Brand",
  "productType": ["furniture"],
  "countryCode": "DE",
  "countryName": "Germany",
  "website": "https://example.com",
  "contactName": "Unknown",
  "contactJobTitle": "Contact",
  "contactEmail": "info@example.com"
}
```

### matterbase_update_brand

Update an existing brand (all fields required).

```json
{
  "id": "brand-uuid",
  "name": "Example Brand",
  "companyName": "Example Brand",
  "productType": ["furniture"],
  "countryCode": "DE",
  "countryName": "Germany",
  "website": "https://example.com",
  "logo": {
    "s3Key": "brands/logo.png",
    "name": "logo.png",
    "mimetype": "image/png"
  },
  "contactName": "Unknown",
  "contactJobTitle": "Contact",
  "contactEmail": "info@example.com",
  "excludedCountries": [],
  "isDisabled": false
}
```
