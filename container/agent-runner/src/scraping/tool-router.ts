import { executeListBrands, executeScrapeBrand } from "./brands.js";
import { executeListProductsByBrand, executeScrapeProduct } from "./products.js";
import {
  executeSaveBrandToNotion,
  executeEnrichExistingBrandHunterContacts,
  executeEnrichBrandHunterContactsByName,
  executeCheckBrandExistsInNotion,
  executeUpdateBrandNotionMatterbaseId,
  type SaveBrandArgs,
  type EnrichExistingBrandHunterContactsArgs,
  type EnrichBrandHunterContactsByNameArgs,
  type CheckBrandExistsArgs,
  type UpdateBrandNotionMatterbaseIdArgs,
} from "./notion-tools.js";
import {
  executeListBrandsFromIndex,
  executeUpdateBrandIndexStatus,
  executeAddBrandsToIndex,
  executeUpdateBrandsInIndex,
  executeFindUnindexedBrands,
  type ListBrandsFromIndexArgs,
  type UpdateBrandIndexStatusArgs,
  type AddBrandsToIndexArgs,
  type UpdateBrandsInIndexArgs,
  type FindUnindexedBrandsArgs,
} from "./brand-index.js";
import {
  executeSearchDomainContacts,
  type SearchDomainContactsArgs,
} from "./contacts.js";
import {
  executeValidateBrandData,
  type ValidateBrandDataArgs,
} from "./validation.js";
import {
  executeMatterbaseCreateBrandFromNotion,
  type CreateMatterbaseBrandFromNotionArgs,
} from "./matterbase-brand-tools.js";

export async function executeScrapingTool(
  name: string,
  args: Record<string, unknown>
): Promise<string> {
  switch (name) {
    case "list_brands":
      return executeListBrands(args as Parameters<typeof executeListBrands>[0]);
    case "scrape_brand":
      return executeScrapeBrand(args as Parameters<typeof executeScrapeBrand>[0]);
    case "list_products_by_brand":
      return executeListProductsByBrand(args as Parameters<typeof executeListProductsByBrand>[0]);
    case "scrape_product":
      return executeScrapeProduct(args as Parameters<typeof executeScrapeProduct>[0]);
    case "save_brand_to_notion":
      return executeSaveBrandToNotion(args as unknown as SaveBrandArgs);
    case "enrich_existing_brand_hunter_contacts":
      return executeEnrichExistingBrandHunterContacts(
        args as unknown as EnrichExistingBrandHunterContactsArgs
      );
    case "enrich_brand_hunter_contacts_by_name":
      return executeEnrichBrandHunterContactsByName(
        args as unknown as EnrichBrandHunterContactsByNameArgs
      );
    case "check_brand_exists_in_notion":
      return executeCheckBrandExistsInNotion(args as unknown as CheckBrandExistsArgs);
    case "update_brand_notion_matterbase_id":
      return executeUpdateBrandNotionMatterbaseId(args as unknown as UpdateBrandNotionMatterbaseIdArgs);
    case "matterbase_create_brand":
      return executeMatterbaseCreateBrandFromNotion(args as unknown as CreateMatterbaseBrandFromNotionArgs);
    case "list_brands_from_index":
      return executeListBrandsFromIndex(args as unknown as ListBrandsFromIndexArgs);
    case "update_brand_index_status":
      return executeUpdateBrandIndexStatus(args as unknown as UpdateBrandIndexStatusArgs);
    case "add_brands_to_index":
      return executeAddBrandsToIndex(args as unknown as AddBrandsToIndexArgs);
    case "update_brands_in_index":
      return executeUpdateBrandsInIndex(args as unknown as UpdateBrandsInIndexArgs);
    case "find_unindexed_brands":
      return executeFindUnindexedBrands(args as unknown as FindUnindexedBrandsArgs);
    case "search_domain_contacts":
      return executeSearchDomainContacts(args as unknown as SearchDomainContactsArgs);
    case "validate_brand_data":
      return executeValidateBrandData(args as unknown as ValidateBrandDataArgs);
    default:
      return JSON.stringify({ error: `Unknown scraping tool: ${name}` });
  }
}
