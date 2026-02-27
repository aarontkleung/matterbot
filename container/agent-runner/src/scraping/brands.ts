import { scrapeUrl } from "./integrations/firecrawl.js";
import { readFile, writeFile, mkdir } from "fs/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = join(__dirname, "../../.cache");
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const BRAND_SCRAPE_SESSION_TTL_MS = 60 * 60 * 1000; // 60 minutes
const BRAND_SCRAPE_SESSION_MAX_ENTRIES = 300;

// Module-level cache: Architonic URL → parsed distributors
// Avoids LLM truncation when passing large distributor arrays through tool calls
const distributorCache = new Map<string, ParsedDistributor[]>();

export function getCachedDistributors(url: string): ParsedDistributor[] | undefined {
  return distributorCache.get(url);
}

// Module-level cache: Architonic URL → parsed catalog download links
// Extracted deterministically from firecrawl links array to avoid LLM dropping download URLs
export interface ParsedCatalogLink {
  url: string;
  filename?: string;
}

const catalogLinkCache = new Map<string, ParsedCatalogLink[]>();

export function getCachedCatalogLinks(url: string): ParsedCatalogLink[] | undefined {
  return catalogLinkCache.get(url);
}

export interface BrandScrapeSessionSnapshot {
  scrapeSessionId: string;
  architonicUrl: string;
  createdAt: number;
  contactDetails: Record<string, string | number | null>;
  parsedDistributors: ParsedDistributor[];
  parsedCatalogLinks: ParsedCatalogLink[];
  extractedImageUrls: ExtractedImageUrls;
  markdown?: string;
  links?: string[];
  metadata?: { ogImage?: string; [key: string]: unknown };
}

const brandScrapeSessionCache = new Map<string, BrandScrapeSessionSnapshot>();

function pruneBrandScrapeSessionCache(now: number = Date.now()): void {
  for (const [sessionId, snapshot] of brandScrapeSessionCache.entries()) {
    if (now - snapshot.createdAt > BRAND_SCRAPE_SESSION_TTL_MS) {
      brandScrapeSessionCache.delete(sessionId);
    }
  }

  if (brandScrapeSessionCache.size <= BRAND_SCRAPE_SESSION_MAX_ENTRIES) return;

  const sortedByCreatedAt = Array.from(brandScrapeSessionCache.entries())
    .sort((a, b) => a[1].createdAt - b[1].createdAt);

  const removeCount = brandScrapeSessionCache.size - BRAND_SCRAPE_SESSION_MAX_ENTRIES;
  for (let i = 0; i < removeCount; i++) {
    const [sessionId] = sortedByCreatedAt[i];
    brandScrapeSessionCache.delete(sessionId);
  }
}

export function createBrandScrapeSession(
  snapshotInput: Omit<BrandScrapeSessionSnapshot, "scrapeSessionId" | "createdAt">
): string {
  pruneBrandScrapeSessionCache();

  const scrapeSessionId = randomUUID();
  const snapshot: BrandScrapeSessionSnapshot = {
    scrapeSessionId,
    createdAt: Date.now(),
    architonicUrl: snapshotInput.architonicUrl,
    contactDetails: { ...(snapshotInput.contactDetails || {}) },
    parsedDistributors: [...(snapshotInput.parsedDistributors || [])],
    parsedCatalogLinks: [...(snapshotInput.parsedCatalogLinks || [])],
    extractedImageUrls: { ...(snapshotInput.extractedImageUrls || {}) },
    markdown: snapshotInput.markdown,
    links: snapshotInput.links ? [...snapshotInput.links] : undefined,
    metadata: snapshotInput.metadata ? { ...snapshotInput.metadata } : undefined,
  };

  brandScrapeSessionCache.set(scrapeSessionId, snapshot);
  pruneBrandScrapeSessionCache();
  return scrapeSessionId;
}

export function getBrandScrapeSession(scrapeSessionId: string): BrandScrapeSessionSnapshot | null {
  pruneBrandScrapeSessionCache();

  const snapshot = brandScrapeSessionCache.get(scrapeSessionId);
  if (!snapshot) return null;

  if (Date.now() - snapshot.createdAt > BRAND_SCRAPE_SESSION_TTL_MS) {
    brandScrapeSessionCache.delete(scrapeSessionId);
    return null;
  }

  return {
    ...snapshot,
    contactDetails: { ...snapshot.contactDetails },
    parsedDistributors: [...snapshot.parsedDistributors],
    parsedCatalogLinks: [...snapshot.parsedCatalogLinks],
    extractedImageUrls: { ...snapshot.extractedImageUrls },
    links: snapshot.links ? [...snapshot.links] : undefined,
    metadata: snapshot.metadata ? { ...snapshot.metadata } : undefined,
  };
}

export interface ParsedBrand {
  name: string;
  architonicUrl: string;
  architonicId: string;
  location?: string;
  type?: string;
}

function parseBrandsFromContent(
  markdown: string | undefined,
  links: string[] | undefined
): ParsedBrand[] {
  const brands: ParsedBrand[] = [];
  const seenIds = new Set<string>();
  const brandUrlPattern = /architonic\.com\/en\/b\/([^/]+)\/(\d+)/;

  // Pattern to extract brand info from markdown:
  // BrandName\\\\\\n\\\\\\n(Type)\\\\\\n\\\\\\n(Location)](url)
  const brandBlockPattern = /([^[\]\\]+)\\\\\\\\\\s*\\\\\\\\\\s*([^\\\\]+)\\\\\\\\\\s*\\\\\\\\\\s*([^\\\\]+)\]\((https:\/\/www\.architonic\.com\/en\/b\/[^)]+)\)/g;

  // First, build a map of URL -> {type, location} from markdown
  const brandInfoMap = new Map<string, { type: string; location: string }>();
  if (markdown) {
    let match;
    while ((match = brandBlockPattern.exec(markdown)) !== null) {
      const [, , type, location, url] = match;
      brandInfoMap.set(url, {
        type: type.trim(),
        location: location.trim(),
      });
    }
  }

  // Then extract brands from links and enrich with markdown info
  if (links) {
    for (const link of links) {
      const match = link.match(brandUrlPattern);
      if (match) {
        const [, slug, id] = match;
        if (!seenIds.has(id)) {
          seenIds.add(id);
          const name = slug
            .split("-")
            .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
            .join(" ");
          const fullUrl = link.startsWith("http") ? link : `https://www.architonic.com${link}`;
          const info = brandInfoMap.get(fullUrl);
          brands.push({
            name,
            architonicUrl: fullUrl,
            architonicId: id,
            location: info?.location,
            type: info?.type,
          });
        }
      }
    }
  }
  return brands;
}

interface CacheEntry {
  timestamp: number;
  data: {
    markdown?: string;
    links?: string[];
    metadata?: Record<string, unknown>;
  };
}

async function getCacheKey(criteria: string, category?: string, page?: number): Promise<string> {
  let key = category ? `${criteria}_${category}` : criteria;
  if (page && page > 1) {
    key += `_page${page}`;
  }
  return key.replace(/[^a-z0-9_-]/gi, "_");
}

async function readCache(key: string): Promise<CacheEntry | null> {
  try {
    const cachePath = join(CACHE_DIR, `brands_${key}.json`);
    const content = await readFile(cachePath, "utf-8");
    const entry: CacheEntry = JSON.parse(content);

    if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
      return null; // Cache expired
    }
    return entry;
  } catch {
    return null; // Cache miss or read error
  }
}

async function writeCache(key: string, data: CacheEntry["data"]): Promise<void> {
  try {
    await mkdir(CACHE_DIR, { recursive: true });
    const cachePath = join(CACHE_DIR, `brands_${key}.json`);
    const entry: CacheEntry = { timestamp: Date.now(), data };
    await writeFile(cachePath, JSON.stringify(entry, null, 2));
  } catch {
    // Ignore cache write errors
  }
}

export async function executeListBrands(args: {
  criteria: string;
  category?: string;
  page?: number;
  forceRefresh?: boolean;
}): Promise<string> {
  const { criteria, category, page = 1, forceRefresh = false } = args;

  // Base URL for scraping (always use /en/brands for pagination)
  let baseUrl = "https://www.architonic.com/en/brands";

  // For category filtering, use the category path
  if (criteria === "by_category") {
    if (!category) {
      return JSON.stringify({ error: "Category required for by_category criteria" });
    }
    baseUrl = `https://www.architonic.com/en/brands/${category}`;
  }

  // Construct the final URL with page number
  // Note: /en/brands/a-z redirects to /en/brands, so we use /en/brands for both most_popular and alphabetical
  const url = page > 1 ? `${baseUrl}/${page}` : baseUrl;

  const cacheKey = await getCacheKey(criteria, category, page);

  // Check cache first (unless force refresh)
  if (!forceRefresh) {
    const cached = await readCache(cacheKey);
    if (cached) {
      const brands = parseBrandsFromContent(cached.data.markdown, cached.data.links);
      return JSON.stringify({
        success: true,
        url,
        criteria,
        page,
        totalPages: 68,
        cached: true,
        cachedAt: new Date(cached.timestamp).toISOString(),
        brands,
        brandCount: brands.length,
        instructions:
          "Use add_brands_to_index to save these brands to the Notion index. Each brand has: name, architonicUrl, architonicId. To get more brands, call this tool again with the next page number.",
      });
    }
  }

  try {
    console.log(`[list_brands] Scraping URL: ${url} (page ${page})`);
    const result = await scrapeUrl(url, {
      formats: ["markdown", "links"],
      waitFor: 2000,
    });
    console.log(`[list_brands] Successfully scraped page ${page}`);

    // Cache the result
    await writeCache(cacheKey, {
      markdown: result.markdown,
      links: result.links,
      metadata: result.metadata,
    });

    const brands = parseBrandsFromContent(result.markdown, result.links);
    return JSON.stringify({
      success: true,
      url,
      criteria,
      page,
      totalPages: 68,
      cached: false,
      brands,
      brandCount: brands.length,
      instructions:
        "Use add_brands_to_index to save these brands to the Notion index. Each brand has: name, url, architonicId. To get more brands, call this tool again with the next page number.",
    });
  } catch (error) {
    console.error(`[list_brands] Error scraping ${url}:`, error);
    return JSON.stringify({
      success: false,
      url,
      page,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export function extractContactFromHtml(rawHtml: string): Record<string, string | number | null> {
  const contact: Record<string, string | number | null> = {};

  // The brand contact data lives in the React Router hydration payload as a serialized block.
  // Format: "phone","<phone>","street","<street>","<city>","zip","<zip>","pobox","<pobox>","contactEmail","<email>",...
  //         "geoLocation",{...},<lat>,"lng",<lng>,"contactLanguage","homepage","<url>","socialMedia",...
  //         "facebook","<url>","twitter","instagram","<url>","linkedin","pinterest","<url>"

  // Find the brand contact block — starts at "phone" before "street" and extends through "distributors"
  const blockMatch = rawHtml.match(/["\\]phone["\\][,:"\\]+[^"\\]+["\\,]+["\\]street["\\][\s\S]{0,3000}?["\\]distributors["\\]/);
  if (!blockMatch) {
    // Fallback: start at "street"
    const fallback = rawHtml.match(/["\\]street["\\][\s\S]{0,3000}?["\\]distributors["\\]/);
    if (!fallback) {
      const shortBlock = rawHtml.match(/["\\]street["\\][\s\S]{0,2000}?["\\]pinterest["\\]/);
      if (shortBlock) {
        extractFromBlock(shortBlock[0], contact);
      }

      // Loose fallback: some pages expose contact details in a different shape
      // (e.g. escaped JSON fragments without the expected distributors boundary).
      const likelyRegion = extractLikelyContactRegion(rawHtml);
      extractContactFromLoosePatterns(likelyRegion, contact);
      if (!hasAnyContactField(contact) && likelyRegion !== rawHtml) {
        extractContactFromLoosePatterns(rawHtml, contact);
      }
      return contact;
    }
    extractFromBlock(fallback[0], contact);
    if (!hasAnyContactField(contact)) {
      const likelyRegion = extractLikelyContactRegion(rawHtml);
      extractContactFromLoosePatterns(likelyRegion, contact);
    }
    return contact;
  }

  extractFromBlock(blockMatch[0], contact);

  // Fill any missing fields from a looser key-based pass.
  const likelyRegion = extractLikelyContactRegion(rawHtml);
  extractContactFromLoosePatterns(likelyRegion, contact);
  return contact;
}

function extractFromBlock(block: string, contact: Record<string, string | number | null>): Record<string, string | number | null> {
  const extractStringForKeys = (keys: string[]): string | undefined => {
    for (const key of keys) {
      const pattern = new RegExp(`["\\\\]${key}["\\\\][,:"\\\\]+([^"\\\\]+)`);
      const match = block.match(pattern);
      if (!match?.[1]) continue;
      const value = match[1].trim();
      if (value) return value;
    }
    return undefined;
  };

  // Street: "street","<value>","<city>"
  const streetMatch = block.match(/["\\]street["\\][,:"\\]+([^"\\]+)[,"\\]+([^"\\]+)[,"\\]+["\\]zip["\\]/);
  if (streetMatch) {
    contact.street = streetMatch[1];
    contact.city = streetMatch[2];
  }

  // Zip
  const zipMatch = block.match(/["\\]zip["\\][,:"\\]+([^"\\]+)/);
  if (zipMatch) contact.zip = zipMatch[1];

  // Phone
  const phoneMatch = block.match(/["\\]phone["\\][,:"\\]+([^"\\]+)/);
  if (phoneMatch) contact.phone = phoneMatch[1];

  // Contact email
  const emailMatch = block.match(/["\\]contactEmail["\\][,:"\\]+([^"\\]+)/);
  if (emailMatch && isPlausibleEmail(emailMatch[1])) contact.email = emailMatch[1];

  // Optional person-level contact fields (not always present in Architonic payloads)
  const contactName = extractStringForKeys(["contactName", "contactPerson", "contactFullName"]);
  if (contactName && isPlausibleContactString(contactName)) contact.contactName = contactName;

  const contactJobTitle = extractStringForKeys([
    "contactJobTitle",
    "contactTitle",
    "contactRole",
    "jobTitle",
    "position",
  ]);
  if (contactJobTitle && isPlausibleContactString(contactJobTitle)) contact.contactJobTitle = contactJobTitle;

  // Geo coordinates — near "geoLocation": pattern is },<lat>,"lng",<lng>
  const geoMatch = block.match(/["\\]geoLocation["\\][\s\S]*?},?([\d.]+)[,:"\\]+["\\]?lng["\\]?[,:"\\]+([\d.]+)/);
  if (geoMatch) {
    contact.lat = parseFloat(geoMatch[1]);
    contact.lng = parseFloat(geoMatch[2]);
  }

  // Homepage (not "website" in this format)
  const homepageMatch = block.match(/["\\]homepage["\\][,:"\\]+((?:https?:\\?\/\\?\/)?[^"\n]+)/);
  if (homepageMatch) {
    const website = normalizePossibleUrl(homepageMatch[1]);
    if (website) contact.website = website;
  }

  // Social media
  const facebookMatch = block.match(/["\\]facebook["\\][,:"\\]+((?:https?:\\?\/\\?\/)?[^"\n]+)/);
  if (facebookMatch) {
    const facebook = normalizePossibleUrl(facebookMatch[1]);
    if (facebook) contact.facebook = facebook;
  }

  const instagramMatch = block.match(/["\\]instagram["\\][,:"\\]+((?:https?:\\?\/\\?\/)?[^"\n]+)/);
  if (instagramMatch) {
    const instagram = normalizePossibleUrl(instagramMatch[1]);
    if (instagram) contact.instagram = instagram;
  }

  const pinterestMatch = block.match(/["\\]pinterest["\\][,:"\\]+((?:https?:\\?\/\\?\/)?[^"\n]+)/);
  if (pinterestMatch) {
    const pinterest = normalizePossibleUrl(pinterestMatch[1]);
    if (pinterest) contact.pinterest = pinterest;
  }

  // Fill missing fields from a loose pass against this block.
  extractContactFromLoosePatterns(block, contact);

  return contact;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function decodeEscapedValue(value: string): string {
  return value
    .trim()
    .replace(/\\u002f/gi, "/")
    .replace(/\\u003a/gi, ":")
    .replace(/\\u0026/gi, "&")
    .replace(/\\\//g, "/")
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, "\\")
    .replace(/^\\+|\\+$/g, "")
    .trim();
}

function normalizePossibleUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const decoded = decodeEscapedValue(value);
  if (!decoded) return undefined;

  const trimmed = decoded.replace(/[),.;]+$/g, "");
  if (/^https?:\/\/\S+$/i.test(trimmed)) return trimmed;
  // Handle URLs missing protocol prefix (e.g. "www.example.com")
  if (/^www\.\S+$/i.test(trimmed)) return `https://${trimmed}`;
  return undefined;
}

/**
 * Returns true when the value looks like a plausible email address
 * (at least `x@y.z`). This is intentionally loose — the goal is to
 * reject obvious non-emails like "requestCatalogue", not to enforce
 * RFC 5322.
 */
export function isPlausibleEmail(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  const atIdx = trimmed.indexOf("@");
  if (atIdx < 1) return false; // need at least one char before @
  const domain = trimmed.slice(atIdx + 1);
  return domain.includes(".") && domain.indexOf(".") < domain.length - 1;
}

/**
 * Returns true when the value looks like a plausible contact name or
 * job-title string. Rejects values that are too short, look like URLs,
 * look like email addresses, are purely numeric, or contain structural
 * JSON-like characters.
 */
export function isPlausibleContactString(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length < 2) return false;
  if (/[{}\[\]]/.test(trimmed)) return false;
  if (/^https?[:\/]/i.test(trimmed) || /^www\./i.test(trimmed)) return false;
  if (trimmed.includes("@")) return false;
  if (/^\d+$/.test(trimmed)) return false;
  return true;
}

function extractLooseValue(source: string, keys: string[]): string | undefined {
  for (const key of keys) {
    const escapedKey = escapeRegex(key);
    const patterns = [
      new RegExp(`(?:\\\\?"|\")${escapedKey}(?:\\\\?"|\")\\s*[:=,]\\s*(?:\\\\?"|\")([^"\\n]+)`, "i"),
      new RegExp(`(?:\\\\?"|\")${escapedKey}(?:\\\\?"|\")\\s*[:=,]\\s*([^,}\\]]+)`, "i"),
    ];

    for (const pattern of patterns) {
      const match = source.match(pattern);
      if (!match?.[1]) continue;
      const decoded = decodeEscapedValue(match[1]);
      if (decoded) return decoded;
    }
  }
  return undefined;
}

function extractLooseNumber(source: string, keys: string[]): number | undefined {
  for (const key of keys) {
    const escapedKey = escapeRegex(key);
    const pattern = new RegExp(
      `(?:\\\\?"|\")${escapedKey}(?:\\\\?"|\")\\s*[:=,]\\s*(-?\\d+(?:\\.\\d+)?)`,
      "i",
    );
    const match = source.match(pattern);
    if (!match?.[1]) continue;
    const parsed = Number.parseFloat(match[1]);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function hasAnyContactField(contact: Record<string, string | number | null>): boolean {
  const fields = [
    "street",
    "city",
    "zip",
    "phone",
    "email",
    "website",
    "facebook",
    "instagram",
    "pinterest",
    "lat",
    "lng",
  ];
  return fields.some((field) => {
    const value = contact[field];
    if (typeof value === "number") return Number.isFinite(value);
    return typeof value === "string" && value.trim().length > 0;
  });
}

function extractLikelyContactRegion(rawHtml: string): string {
  const markers = [
    '"contactEmail"',
    '\\"contactEmail\\"',
    '"homepage"',
    '\\"homepage\\"',
    '"contactLanguage"',
    '\\"contactLanguage\\"',
    '"phone"',
    '\\"phone\\"',
    '"street"',
    '\\"street\\"',
  ];

  let firstIdx = -1;
  for (const marker of markers) {
    const idx = rawHtml.indexOf(marker);
    if (idx === -1) continue;
    if (firstIdx === -1 || idx < firstIdx) {
      firstIdx = idx;
    }
  }

  if (firstIdx === -1) return rawHtml;

  const start = Math.max(0, firstIdx - 1800);
  const end = Math.min(rawHtml.length, firstIdx + 5500);
  return rawHtml.slice(start, end);
}

function extractContactFromLoosePatterns(
  source: string,
  contact: Record<string, string | number | null>,
): void {
  if (!contact.phone) {
    const phone = extractLooseValue(source, ["phone"]);
    if (phone) contact.phone = phone;
  }

  if (!contact.email) {
    const email = extractLooseValue(source, ["contactEmail", "email"]);
    if (email && /@/.test(email)) contact.email = email;
  }

  if (!contact.website) {
    const websiteCandidate = extractLooseValue(source, ["homepage", "website"]);
    const website = normalizePossibleUrl(websiteCandidate);
    if (website) contact.website = website;
  }

  if (!contact.street || !contact.city || !contact.zip) {
    const addressPattern =
      /(?:\\?"|\")street(?:\\?"|\")[,:"\\]+([^"\n]+)[,:"\\]+([^"\n]+)[,:"\\]+(?:\\?"|\")zip(?:\\?"|\")[,:"\\]+([^"\n]+)/i;
    const addressMatch = source.match(addressPattern);
    if (addressMatch) {
      if (!contact.street) contact.street = decodeEscapedValue(addressMatch[1]);
      if (!contact.city) contact.city = decodeEscapedValue(addressMatch[2]);
      if (!contact.zip) contact.zip = decodeEscapedValue(addressMatch[3]);
    }
  }

  if (!contact.street) {
    const street = extractLooseValue(source, ["street"]);
    if (street) contact.street = street;
  }
  if (!contact.city) {
    const city = extractLooseValue(source, ["city"]);
    if (city) contact.city = city;
  }
  if (!contact.zip) {
    const zip = extractLooseValue(source, ["zip", "postalCode", "postcode"]);
    if (zip) contact.zip = zip;
  }

  if (contact.lat === undefined || contact.lat === null) {
    const lat = extractLooseNumber(source, ["lat", "latitude"]);
    if (lat !== undefined) contact.lat = lat;
  }
  if (contact.lng === undefined || contact.lng === null) {
    const lng = extractLooseNumber(source, ["lng", "longitude"]);
    if (lng !== undefined) contact.lng = lng;
  }

  if (!contact.facebook) {
    const facebook = normalizePossibleUrl(extractLooseValue(source, ["facebook"]));
    if (facebook) contact.facebook = facebook;
  }
  if (!contact.instagram) {
    const instagram = normalizePossibleUrl(extractLooseValue(source, ["instagram"]));
    if (instagram) contact.instagram = instagram;
  }
  if (!contact.pinterest) {
    const pinterest = normalizePossibleUrl(extractLooseValue(source, ["pinterest"]));
    if (pinterest) contact.pinterest = pinterest;
  }
}

export interface ParsedDistributor {
  name: string;
  type?: string;
  street?: string;
  city?: string;
  zip?: string;
  phone?: string;
  email?: string;
  website?: string;
}

/**
 * Parse individual distributor entries from the raw turbo-stream distributor block.
 *
 * Each distributor follows this serialized pattern:
 *   {key_refs},ID,"Name","d-on/ID/logo/...",  (first entry also has "logoImage" label)
 *   "distributorType","type", [refs],{field_refs},
 *   "Street","City","Zip", [opt "countryName"], "Phone","Website","Email",{geo},lat,lng
 *
 * Address fields (street, city, zip) are the first quoted strings after the field
 * keymap that don't match phone/website/email patterns. Some distributors have
 * fewer address fields or none at all.
 */
export function parseDistributorsFromBlock(data: string): ParsedDistributor[] {
  const distributors: ParsedDistributor[] = [];

  // Match each distributor: turbo-stream ref object end "}", then 7-digit Architonic ID,
  // then quoted name, then logo path starting with "d-on/"
  const entryPattern = /},(\d{7}),\\?"([^"\\]+)\\?",\\?"(?:logoImage\\?",\\?")?d-on\//g;
  const entries: { name: string; startIndex: number }[] = [];

  let match;
  while ((match = entryPattern.exec(data)) !== null) {
    entries.push({ name: match[2], startIndex: match.index });
  }

  for (let i = 0; i < entries.length; i++) {
    const endIndex = i + 1 < entries.length ? entries[i + 1].startIndex : data.length;
    const block = data.substring(entries[i].startIndex, endIndex);

    const dist: ParsedDistributor = { name: entries[i].name };

    // Extract distributor type (e.g. "Retailer", "Representative")
    // Pattern: "distributorType","<value>" or escaped variant
    const typeMatch = block.match(/\\?"distributorType\\?"[,:"\\]+([^"\\,\]]+)/);
    if (typeMatch && typeMatch[1]) {
      dist.type = typeMatch[1];
    }

    // Find the field-level keymap (contains _1177) and extract strings after it
    const fieldKeymapIdx = block.indexOf("_1177");
    if (fieldKeymapIdx !== -1) {
      const keymapEnd = block.indexOf("}", fieldKeymapIdx);
      if (keymapEnd !== -1) {
        // Extract all quoted strings between the field keymap close and the geo object
        const geoIdx = block.indexOf('{\"_29\":', keymapEnd);
        const fieldRegion = block.substring(keymapEnd + 1, geoIdx !== -1 ? geoIdx : endIndex);

        const strPattern = /\\?"([^"\\]+)\\?"/g;
        const addressParts: string[] = [];
        let sm;
        while ((sm = strPattern.exec(fieldRegion)) !== null) {
          const val = sm[1];
          // Skip turbo-stream labels that leak through (only first entry)
          if (val === "countryName") continue;
          // Classify by pattern
          if (val.startsWith("+") || /^\d[\d\s()\-]{5,}$/.test(val)) {
            dist.phone = val;
          } else if (val.startsWith("http")) {
            dist.website = val;
          } else if (val.includes("@")) {
            dist.email = val;
          } else {
            addressParts.push(val);
          }
        }

        // First 3 unclassified strings are street, city, zip (in order)
        if (addressParts.length >= 1) dist.street = addressParts[0];
        if (addressParts.length >= 2) dist.city = addressParts[1];
        if (addressParts.length >= 3) dist.zip = addressParts[2];
      }
    } else {
      // No field keymap — fall back to pattern matching on the whole block
      const phoneMatch = block.match(/\\?"(\+[\d\s()\-]+)\\?"/);
      if (phoneMatch) dist.phone = phoneMatch[1];
      const websiteMatch = block.match(/\\?"(https?:\/\/[^"\\]+)\\?"/);
      if (websiteMatch) dist.website = websiteMatch[1];
      const emailMatch = block.match(/\\?"([^"\\]+@[^"\\]+\.[^"\\]+)\\?"/);
      if (emailMatch) dist.email = emailMatch[1];
    }

    distributors.push(dist);
  }

  return distributors;
}

export interface ExtractedImageUrls {
  logoUrl: string | null;
  headerImageUrl: string | null;
  aboutImageUrl: string | null;
}

export function extractImageUrls(
  rawHtml: string | undefined,
  metadata: { ogImage?: string; [key: string]: unknown } | undefined,
): ExtractedImageUrls {
  const result: ExtractedImageUrls = { logoUrl: null, headerImageUrl: null, aboutImageUrl: null };

  // Logo: use ogImage if it contains /logo/ path
  if (metadata?.ogImage && /\/logo\//.test(metadata.ogImage)) {
    // Strip query params (width/height/format) to get the original image
    result.logoUrl = metadata.ogImage.split('?')[0];
  }

  // Fall back to rawHtml regex for logo
  if (!result.logoUrl && rawHtml) {
    const match = rawHtml.match(/https?:\/\/media\.architonic\.com\/m-on\/\d+\/logo\/[^"\\?\s]+/);
    if (match) result.logoUrl = match[0];
  }

  // About image: extract from rawHtml
  if (rawHtml) {
    const match = rawHtml.match(/https?:\/\/media\.architonic\.com\/m-on\/\d+\/about\/[^"\\?\s]+/);
    if (match) result.aboutImageUrl = match[0];
  }

  // Header image: extract from rawHtml (may not exist on all pages)
  if (rawHtml) {
    const match = rawHtml.match(/https?:\/\/media\.architonic\.com\/m-on\/\d+\/(?:header|hero|cover)\/[^"\\?\s]+/);
    if (match) result.headerImageUrl = match[0];
  }

  // Header fallback: use ogImage if it's NOT a logo image
  if (!result.headerImageUrl && metadata?.ogImage && !/\/logo\//.test(metadata.ogImage)) {
    result.headerImageUrl = metadata.ogImage.split('?')[0];
  }

  return result;
}

// Module-level cache: Architonic URL → extracted image URLs
// Avoids LLM hallucinating image URLs from the links array
const imageUrlCache = new Map<string, ExtractedImageUrls>();

export function getCachedImageUrls(url: string): ExtractedImageUrls | undefined {
  return imageUrlCache.get(url);
}

export function extractDistributorBlock(rawHtml: string): string | null {
  // Find the distributors section in the React Router hydration data.
  // The data may use escaped quotes: \"distributors\" or regular "distributors"
  let startIdx = rawHtml.indexOf('"distributors"');
  if (startIdx === -1) startIdx = rawHtml.indexOf('\\"distributors\\"');
  if (startIdx === -1) startIdx = rawHtml.indexOf('distributors');
  if (startIdx === -1) return null;

  // The distributor block ends before the next top-level section.
  // Look for common end markers that follow the distributors array.
  const searchFrom = startIdx + 500; // skip past the opening
  const endMarkers = [
    '"hasStories"', '\\"hasStories\\"',
    '"hasCollections"', '\\"hasCollections\\"',
    '"hasProducts"', '\\"hasProducts\\"',
    '"hasProjects"', '\\"hasProjects\\"',
    '"hasDownloads"', '\\"hasDownloads\\"',
    '"domain"', '\\"domain\\"',
  ];

  let endIdx = rawHtml.length;
  for (const marker of endMarkers) {
    const idx = rawHtml.indexOf(marker, searchFrom);
    if (idx !== -1 && idx < endIdx) {
      endIdx = idx;
    }
  }

  return rawHtml.substring(startIdx, endIdx);
}

export async function executeScrapeBrand(args: {
  url: string;
  brandName?: string;
}): Promise<string> {
  const { url, brandName } = args;

  try {
    // Scrape with rawHtml to capture contact details from React Router hydration data
    const result = await scrapeUrl(url, {
      waitFor: 2000,
    });

    // Extract contact details from React Router hydration data in rawHtml
    const contactDetails = result.rawHtml ? extractContactFromHtml(result.rawHtml) : {};
    const distributorBlock = result.rawHtml ? extractDistributorBlock(result.rawHtml) : null;
    const parsedDistributors = distributorBlock ? parseDistributorsFromBlock(distributorBlock) : [];
    console.log(`[scrape_brand] Extracted contact details:`, JSON.stringify(contactDetails));
    console.log(`[scrape_brand] Parsed ${parsedDistributors.length} distributors`);

    // Cache distributors so save_brand_to_notion can auto-attach them
    // without relying on the LLM to serialize the full array
    if (parsedDistributors.length > 0) {
      distributorCache.set(url, parsedDistributors);
      console.log(`[scrape_brand] Cached ${parsedDistributors.length} distributors for ${url}`);
    }

    // Extract catalog download/preview links deterministically from firecrawl links
    const parsedCatalogLinks: ParsedCatalogLink[] = (result.links || [])
      .filter(link => /\/(catalog|download|pdf|brochure)/i.test(link) || link.endsWith('.pdf'))
      .map(link => ({ url: link, filename: link.split('/').pop() }));

    if (parsedCatalogLinks.length > 0) {
      catalogLinkCache.set(url, parsedCatalogLinks);
      console.log(`[scrape_brand] Cached ${parsedCatalogLinks.length} catalog links for ${url}`);
    }

    // Extract image URLs deterministically from rawHtml and metadata
    const extractedImageUrls = extractImageUrls(result.rawHtml, result.metadata);
    console.log(`[scrape_brand] Extracted image URLs:`, JSON.stringify(extractedImageUrls));
    if (extractedImageUrls.logoUrl || extractedImageUrls.headerImageUrl || extractedImageUrls.aboutImageUrl) {
      imageUrlCache.set(url, extractedImageUrls);
    }

    const scrapeSessionId = createBrandScrapeSession({
      architonicUrl: url,
      contactDetails,
      parsedDistributors,
      parsedCatalogLinks,
      extractedImageUrls,
      markdown: result.markdown,
      links: result.links,
      metadata: result.metadata,
    });
    console.log(`[scrape_brand] Created scrape session ${scrapeSessionId} for ${url}`);

    return JSON.stringify({
      success: true,
      url,
      brandName,
      scrapeSessionId,
      contactDetails,
      parsedDistributors,
      distributorCount: parsedDistributors.length,
      parsedCatalogLinks,
      catalogLinkCount: parsedCatalogLinks.length,
      extractedImageUrls,
      markdown: result.markdown,
      links: result.links,
      metadata: result.metadata,
      instructions:
        "IMPORTANT: For save_brand_to_notion you MUST pass scrapeSessionId and architonicUrl from this response. The save tool now enforces provenance using this session.\n\n" +
        "Primary contact should come from this scrape output (contactDetails). Treat Hunter results as enrichment only (hunterContacts child table), not the primary contact.\n\n" +
        "Do NOT call scrape_brand again for the same URL just to get a session ID. Reuse this scrapeSessionId and only re-scrape if save_brand_to_notion returns PROVENANCE_SESSION_NOT_FOUND or PROVENANCE_URL_MISMATCH.\n\n" +
        "Only pass allowed enrichment fields: countryCode, countryName, companyName, productType, excludedCountries, isDisabled, contactName, contactJobTitle, contactEmail, hunterContacts. Do NOT pass scraped fields (logoUrl, address, distributors, catalogs, etc.) — they are derived server-side from the scrape session.\n\n" +
        "For matterbase_create_brand, pass notionPageId from save_brand_to_notion. Brand fields (including logoUrl) are enforced from the saved Notion payload.\n\n" +
        "Hunter.io contacts: After calling search_domain_contacts, pass the returned contacts array as hunterContacts to save_brand_to_notion (they will be saved as an inline child database on the brand page).",
    });
  } catch (error) {
    return JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
