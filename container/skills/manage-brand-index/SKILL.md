---
name: Manage Brand Index
description: Populate and maintain the Notion brand index from Architonic
---

# Manage Brand Index

Manage the Notion brand index - populate with new brands from Architonic, backfill missing data, and identify gaps.

## Workflows

### Brand Index Population Workflow (Refresh Index)

Use this when the user asks to "add brands to the index", "populate the index", "refresh the index", or "scrape brand list".

1. **Ask the user**: "How many pages do you want to scrape? Each page has ~48 brands. Options: 1 page (~48 brands), 5 pages (~240 brands), 10 pages (~480 brands), or all 68 pages (~3,264 brands)"
2. Use `list_brands` to scrape the brand list from Architonic:
   - Pass `page` parameter (1-68) to get different pages
   - Each page returns ~48 pre-parsed brands with: name, url, architonicId, location, type
   - Loop through pages as needed based on user's choice
3. Use `add_brands_to_index` to add the returned brands directly to the Notion index (no parsing needed - brands are already extracted)
4. Report progress after each page: "Page X/Y complete. Added A brands, skipped B (already exist)"
5. Final summary: "Completed X pages. Total: Added A brands, skipped B, failed C"

### Backfill Missing Location/Type Workflow

Use this when the user asks to "update brands with missing location/type", "backfill location", or "fix missing data".

1. Use `list_brands` to scrape brand pages from Architonic (returns brands with location and type)
2. Use `update_brands_in_index` to update existing brands in the Notion index with the location/type data
   - Only updates brands that have empty location/type fields
   - Skips brands that already have this data
3. Report progress: "Updated X brands, skipped Y (already have data), not found Z"

### Find Unindexed Brands Workflow

Use this when the user asks to "find missing brands", "check for unindexed brands", or "identify gaps in the index".

1. Use `find_unindexed_brands` to check Architonic pages for brands not in the index:
   - `pages: [1, 2, 3]` - Check specific pages
   - `checkAll: true` - Check all 68 pages (full gap analysis)
   - Default: checks page 1 only
2. Returns only brands that are NOT in the Notion index, with page info
3. Use `add_brands_to_index` to add the missing brands if desired

## Available Tools

### Scraping Tools
- `list_brands` - Scrape brand list from Architonic (uses Firecrawl). Returns ~48 pre-parsed brands per page (name, url, architonicId, location, type). Use `page` param (1-68) to paginate.

### Brand Index Tools
- `add_brands_to_index` - Add brands to the Notion index
- `update_brands_in_index` - Update existing brands with missing location/type data (for backfilling)
- `find_unindexed_brands` - Find brands from Architonic that are NOT in the index. Supports `pages: [1,2,3]` for specific pages or `checkAll: true` for all 68 pages.
- `list_brands_from_index` - Query the Notion brand index (for checking existing brands)

## Example Interactions

### Populate Index

User: "Add brands to the index"

Agent: "I'll help you populate the brand index from Architonic. How many pages do you want to scrape? Each page has ~48 brands.
- 1 page (~48 brands)
- 5 pages (~240 brands)
- 10 pages (~480 brands)
- All 68 pages (~3,264 brands)"

User: "5 pages"

Agent: "Scraping page 1/5..."
[Proceeds with scraping and adding to index]

### Find Missing Brands

User: "Check for unindexed brands on pages 1-5"

Agent: "Checking Architonic pages 1-5 for brands not in the index..."
[Uses find_unindexed_brands with pages: [1,2,3,4,5], reports results]

User: "Find all missing brands"

Agent: "Running full gap analysis across all 68 Architonic pages..."
[Uses find_unindexed_brands with checkAll: true]
