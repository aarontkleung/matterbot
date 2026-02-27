---
name: Scrape Brands
description: Scrape brand details from Architonic, enrich contacts via Hunter.io, save to Notion with strict scrape-session provenance, and create in Matterbase
---

# Scrape Brands

Scrape detailed brand information from Architonic, optionally discover contacts via Hunter.io, save to Notion with provenance enforcement, and create the brand in Matterbase.

**Prerequisites**: Brands should already be in the Notion index. Use [manage-brand-index](../manage-brand-index/SKILL.md) to populate the index first.

## Data Flow

```
Architonic Brand Page
    ↓ scrape_brand
Scrape payload + scrapeSessionId
    ↓ optional search_domain_contacts (from contactDetails.website domain)
Hunter.io contacts
    ↓ save_brand_to_notion (name + architonicUrl + scrapeSessionId + optional enrichments)
Notion Brands DB (provenance-validated, with distributor + contacts sub-tables)
    ↓ mcp__scraping-tools__matterbase_create_brand (enforced saved Notion payload via notionPageId)
Matterbase DB
    ↓ optional update_brand_notion_matterbase_id fallback when create returns NOTION_MATTERBASE_ID_UPDATE_FAILED
Notion "Matterbase ID" linked
    ↓ update_brand_index_status
Done
```

## Workflow

> **IMPORTANT**: Initialize and maintain a TodoWrite checklist before multi-step execution.

1. Get candidate brands from `list_brands_from_index` (usually `status: "pending"`).
2. Fetch valid country codes using `matterbase_list_countries`.
3. For each brand:
   a. Check duplicates with `matterbase_search_brands`. If exact/near match exists, set index status to `skipped` and continue.
   b. Call `scrape_brand` once and keep that exact `scrapeSessionId` for the brand.
   c. Optionally call `search_domain_contacts` if `contactDetails.website` exists.
   d. Save to Notion with `save_brand_to_notion` using only:
      - required: `name`, `architonicUrl`, `scrapeSessionId`
      - optional enrichments: `countryCode`, `countryName`, `companyName`, `productType`, `excludedCountries`, `isDisabled`, `contactName`, `contactJobTitle`, `contactEmail`, `hunterContacts`
      - primary-contact rule: use Architonic `contactDetails` as primary contact when available; use Hunter contacts in `hunterContacts` as enrichment only
   e. Create in Matterbase with `mcp__scraping-tools__matterbase_create_brand` (the `notionPageId`-only wrapper), passing only `notionPageId` from `save_brand_to_notion` (this auto-updates Notion "Matterbase ID" on success). Do not use raw `mcp__matterbase__matterbase_create_brand` for this step.
   f. If step (e) returns code `NOTION_MATTERBASE_ID_UPDATE_FAILED` and includes `matterbaseId`, call `update_brand_notion_matterbase_id` once using `notionPageId` + `matterbaseId`.
   g. Set index status to `scraped` only when Matterbase create succeeded and Notion "Matterbase ID" is set; otherwise set `failed` with notes.
4. Report progress during the run and summarize totals at the end.

## Provenance Rules

- `save_brand_to_notion` is strict: it validates saved scraped fields against the `scrapeSessionId` snapshot.
- Do **not** pass scraped fields manually to `save_brand_to_notion` (address, socials, distributors, catalogs, image URLs, etc.).
- Do **not** re-run `scrape_brand` for the same URL just to get a "correct" session ID. Reuse the original `scrapeSessionId`.
- If `save_brand_to_notion` returns `PROVENANCE_SESSION_NOT_FOUND`, re-run `scrape_brand` and retry with the new `scrapeSessionId`.
- If `save_brand_to_notion` returns `PROVENANCE_URL_MISMATCH`, retry with the matching URL/session pair; only re-scrape if needed.
- `validate_brand_data` is optional for debugging extraction quality; save enforces validation internally.

## Predefined Todo Checklist

### Run-level
1. Confirm scrape criteria
2. Fetch candidate brands from index
3. Fetch valid countries
4. Process each brand end-to-end
5. Share final summary

### Per-brand
1. Duplicate check (`matterbase_search_brands`)
2. Scrape brand (`scrape_brand`)
3. Optional Hunter enrichment (`search_domain_contacts`)
4. Save to Notion with provenance (`save_brand_to_notion`)
5. Create in Matterbase (`mcp__scraping-tools__matterbase_create_brand`)
6. Fallback Notion ID link if needed (`update_brand_notion_matterbase_id`)
7. Update index status (`update_brand_index_status`)

## Available Tools

### Index
- `list_brands_from_index`
- `update_brand_index_status`

### Scraping
- `scrape_brand` (returns scrape payload + `scrapeSessionId`)

### Validation
- `validate_brand_data` (debug only)

### Contacts
- `search_domain_contacts`

### Notion
- `save_brand_to_notion` (strict provenance enforcement)
- `check_brand_exists_in_notion`
- `update_brand_notion_matterbase_id` (fallback/manual recovery if auto-linking fails)

### Matterbase
- `matterbase_list_countries`
- `matterbase_search_brands`
- `matterbase_create_brand` (raw Matterbase MCP tool; do not use for scrape-to-Notion brand creation)
- `matterbase_update_brand`
- `matterbase_upload_image`
