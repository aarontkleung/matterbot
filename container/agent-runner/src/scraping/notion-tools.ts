import { getHunterClient } from "./integrations/hunter.js";
import { notionApiRequest } from "./integrations/notion-api.js";
import { getMCPClient } from "./integrations/notion-mcp.js";
import {
    getBrandScrapeSession,
    getCachedCatalogLinks,
    getCachedDistributors,
    getCachedImageUrls,
    isPlausibleContactString,
    isPlausibleEmail,
    type BrandScrapeSessionSnapshot,
    type ParsedCatalogLink,
} from "./brands.js";
import {
    executeValidateBrandData,
    type ScrapeResultInput,
} from "./validation.js";

export const BRANDS_DATABASE_ID = "2f8ff42a-e05a-8057-b4ce-ef4a22243d31";
export const BRAND_INDEX_DATABASE_ID = "2feff42a-e05a-80e7-bb09-c82ee5afe860";
export const BRAND_INDEX_DATA_SOURCE_ID =
    "2feff42a-e05a-801e-8690-000b83ddc6d7";

export interface Distributor {
    name: string;
    type?: string;
    street?: string;
    city?: string;
    zip?: string;
    phone?: string;
    email?: string;
    website?: string;
}

export interface Catalog {
    title: string;
    year?: string;
    language?: string;
    downloadUrl?: string;
    previewUrl?: string;
}

export interface HunterContact {
    email: string;
    firstName?: string;
    lastName?: string;
    position?: string;
    confidence?: number;
    type?: "personal" | "generic";
    linkedin?: string;
    phone?: string;
    verified?: boolean;
    verificationStatus?: string;
}

export interface SaveBrandArgs {
    name: string;
    architonicUrl: string;
    scrapeSessionId: string;
    countryCode?: string;
    countryName?: string;
    companyName?: string;
    productType?: MatterbaseBrandProductType[];
    excludedCountries?: MatterbaseExcludedCountry[];
    isDisabled?: boolean;
    contactName?: string;
    contactJobTitle?: string;
    contactEmail?: string;
    hunterContacts?: HunterContact[];
}

export type MatterbaseBrandProductType =
    | "material"
    | "furniture"
    | "lighting"
    | "hardware";

export interface MatterbaseExcludedCountry {
    code: string;
    name: string;
}

export interface SavedMatterbaseCreatePayload {
    notionPageId: string;
    scrapeSessionId: string;
    name: string;
    companyName: string;
    productType: MatterbaseBrandProductType[];
    countryCode?: string;
    countryName?: string;
    website?: string;
    contactName?: string;
    contactJobTitle?: string;
    contactEmail?: string;
    excludedCountries: MatterbaseExcludedCountry[];
    isDisabled: boolean;
    logoUrl?: string;
    savedAt: string;
}

interface ValidationIssue {
    field: string;
    severity: "error" | "warning";
    message: string;
    expected?: string | number | null;
    received?: string | number | null;
}

interface ValidationResult {
    valid: boolean;
    errorCount: number;
    warningCount: number;
    issues: ValidationIssue[];
    summary: string;
}

interface ResolvedBrandData {
    name: string;
    architonicUrl: string;
    scrapeSessionId: string;
    architonicId?: string;
    countryCode?: string;
    description?: string;
    website?: string;
    logoUrl?: string;
    contactName?: string;
    contactJobTitle?: string;
    contactEmail?: string;
    street?: string;
    city?: string;
    postalCode?: string;
    phone?: string;
    email?: string;
    latitude?: number;
    longitude?: number;
    facebook?: string;
    instagram?: string;
    pinterest?: string;
    catalogs?: Catalog[];
    distributors?: Distributor[];
    hunterContacts?: HunterContact[];
    headerImageUrl?: string;
    aboutImageUrl?: string;
    scrapedAtIso: string;
}

export interface CheckBrandExistsArgs {
    brandName: string;
}

interface NotionBlock {
    object: "block";
    type: string;
    [key: string]: unknown;
}

const ALLOWED_SAVE_FIELDS = [
    "name",
    "architonicUrl",
    "scrapeSessionId",
    "countryCode",
    "countryName",
    "companyName",
    "productType",
    "excludedCountries",
    "isDisabled",
    "contactName",
    "contactJobTitle",
    "contactEmail",
    "hunterContacts",
] as const;

const DISALLOWED_SCRAPED_FIELDS = [
    "website",
    "logoUrl",
    "architonicId",
    "companyType",
    "street",
    "city",
    "postalCode",
    "phone",
    "email",
    "latitude",
    "longitude",
    "facebook",
    "instagram",
    "pinterest",
    "description",
    "catalogs",
    "distributors",
    "headerImageUrl",
    "aboutImageUrl",
    "stories",
    "similarBrands",
    "collections",
] as const;

const RETRYABLE_MATTERBASE_CREATE_FIELDS = new Set<string>([
    "productType",
    "countryCode",
    "countryName",
    "contactEmail",
]);
const DEFAULT_HUNTER_CONTACT_LIMIT = 50;

const MATTERBASE_CREATE_PAYLOAD_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
const MATTERBASE_CREATE_PAYLOAD_MAX_ENTRIES = 500;
const matterbaseCreatePayloadCache = new Map<
    string,
    SavedMatterbaseCreatePayload
>();

function pruneMatterbaseCreatePayloadCache(now: number = Date.now()): void {
    for (const [pageId, payload] of matterbaseCreatePayloadCache.entries()) {
        const savedAtMs = Date.parse(payload.savedAt);
        if (!Number.isFinite(savedAtMs)) {
            matterbaseCreatePayloadCache.delete(pageId);
            continue;
        }

        if (now - savedAtMs > MATTERBASE_CREATE_PAYLOAD_TTL_MS) {
            matterbaseCreatePayloadCache.delete(pageId);
        }
    }

    if (
        matterbaseCreatePayloadCache.size <= MATTERBASE_CREATE_PAYLOAD_MAX_ENTRIES
    ) {
        return;
    }

    const oldestFirst = Array.from(matterbaseCreatePayloadCache.entries()).sort(
        (a, b) => {
            const aMs = Date.parse(a[1].savedAt);
            const bMs = Date.parse(b[1].savedAt);
            const safeAMs = Number.isFinite(aMs) ? aMs : 0;
            const safeBMs = Number.isFinite(bMs) ? bMs : 0;
            return safeAMs - safeBMs;
        },
    );

    const removeCount =
        matterbaseCreatePayloadCache.size - MATTERBASE_CREATE_PAYLOAD_MAX_ENTRIES;
    for (let i = 0; i < removeCount; i++) {
        matterbaseCreatePayloadCache.delete(oldestFirst[i][0]);
    }
}

export function getSavedMatterbaseCreatePayload(
    notionPageId: string,
): SavedMatterbaseCreatePayload | null {
    pruneMatterbaseCreatePayloadCache();

    const payload = matterbaseCreatePayloadCache.get(notionPageId);
    if (!payload) return null;

    const savedAtMs = Date.parse(payload.savedAt);
    if (!Number.isFinite(savedAtMs)) {
        matterbaseCreatePayloadCache.delete(notionPageId);
        return null;
    }

    if (Date.now() - savedAtMs > MATTERBASE_CREATE_PAYLOAD_TTL_MS) {
        matterbaseCreatePayloadCache.delete(notionPageId);
        return null;
    }

    return {
        ...payload,
        productType: [...payload.productType],
        excludedCountries: [...payload.excludedCountries],
    };
}

function heading2Block(text: string): NotionBlock {
    return {
        object: "block",
        type: "heading_2",
        heading_2: {
            rich_text: [{ type: "text", text: { content: text } }],
        },
    };
}

function paragraphBlock(text: string): NotionBlock {
    const content = text.length > 2000 ? text.slice(0, 1997) + "..." : text;
    return {
        object: "block",
        type: "paragraph",
        paragraph: {
            rich_text: [{ type: "text", text: { content } }],
        },
    };
}

function bulletBlock(text: string): NotionBlock {
    const content = text.length > 2000 ? text.slice(0, 1997) + "..." : text;
    return {
        object: "block",
        type: "bulleted_list_item",
        bulleted_list_item: {
            rich_text: [{ type: "text", text: { content } }],
        },
    };
}

function buildPageBody(args: ResolvedBrandData): NotionBlock[] {
    const blocks: NotionBlock[] = [];

    if (args.description) {
        blocks.push(heading2Block("Description"));
        blocks.push(paragraphBlock(args.description));
    }

    {
        const items: string[] = [];
        if (args.contactName) items.push(`Name: ${args.contactName}`);
        if (args.contactJobTitle) items.push(`Job Title: ${args.contactJobTitle}`);
        if (args.contactEmail) items.push(`Contact Email: ${args.contactEmail}`);
        if (args.email && args.email !== args.contactEmail)
            items.push(`Company Email: ${args.email}`);
        if (args.website) items.push(`Website: ${args.website}`);
        if (args.phone) items.push(`Phone: ${args.phone}`);
        const addressParts = [args.street, args.postalCode, args.city].filter(
            Boolean,
        );
        if (addressParts.length > 0)
            items.push(`Address: ${addressParts.join(", ")}`);
        if (args.countryCode) items.push(`Country Code: ${args.countryCode}`);
        if (args.latitude !== undefined && args.longitude !== undefined) {
            items.push(`Coordinates: ${args.latitude}, ${args.longitude}`);
        }
        if (items.length > 0) {
            blocks.push(heading2Block("Contact Details"));
            for (const item of items) {
                blocks.push(bulletBlock(item));
            }
        }
    }

    {
        const items: string[] = [];
        if (args.facebook) items.push(`Facebook: ${args.facebook}`);
        if (args.instagram) items.push(`Instagram: ${args.instagram}`);
        if (args.pinterest) items.push(`Pinterest: ${args.pinterest}`);
        if (items.length > 0) {
            blocks.push(heading2Block("Social Media"));
            for (const item of items) {
                blocks.push(bulletBlock(item));
            }
        }
    }

    {
        const items: string[] = [];
        if (args.logoUrl) items.push(`Logo: ${args.logoUrl}`);
        if (args.headerImageUrl) items.push(`Header Image: ${args.headerImageUrl}`);
        if (args.aboutImageUrl) items.push(`About Image: ${args.aboutImageUrl}`);
        if (items.length > 0) {
            blocks.push(heading2Block("Images"));
            for (const item of items) {
                blocks.push(bulletBlock(item));
            }
        }
    }

    if (args.catalogs && args.catalogs.length > 0) {
        blocks.push(heading2Block("Catalogs"));
        for (const catalog of args.catalogs) {
            let line = catalog.title;
            if (catalog.year) line += ` (${catalog.year})`;
            if (catalog.language) line += ` [${catalog.language}]`;
            blocks.push(bulletBlock(line));
            if (catalog.downloadUrl) {
                blocks.push(bulletBlock(`Download: ${catalog.downloadUrl}`));
            }
            if (catalog.previewUrl) {
                blocks.push(bulletBlock(`Preview: ${catalog.previewUrl}`));
            }
        }
    }

    blocks.push(heading2Block("Provenance"));
    blocks.push(bulletBlock(`Source URL: ${args.architonicUrl}`));
    blocks.push(bulletBlock(`Scrape Session ID: ${args.scrapeSessionId}`));
    blocks.push(bulletBlock(`Scraped At (UTC): ${args.scrapedAtIso}`));

    return blocks;
}

function buildDistributorProps(d: Distributor): Record<string, unknown> {
    const props: Record<string, unknown> = {
        Name: { title: [{ text: { content: d.name } }] },
    };

    if (d.type) {
        const typeVal =
            d.type.charAt(0).toUpperCase() + d.type.slice(1).toLowerCase();
        props["Type"] = { select: { name: typeVal } };
    }
    if (d.street) {
        props["Street"] = { rich_text: [{ text: { content: d.street } }] };
    }
    if (d.city) {
        props["City"] = { rich_text: [{ text: { content: d.city } }] };
    }
    if (d.zip) {
        props["Postal Code"] = { rich_text: [{ text: { content: d.zip } }] };
    }
    if (d.phone) {
        props["Phone"] = { rich_text: [{ text: { content: d.phone } }] };
    }
    if (d.email) {
        props["Email"] = { email: d.email };
    }
    if (d.website) {
        props["Website"] = { url: d.website };
    }

    return props;
}

async function createDistributorChildDatabase(
    parentPageId: string,
    distributors: Distributor[],
): Promise<void> {
    const validDistributors = distributors.filter((d) => d.name);
    const skipped = distributors.length - validDistributors.length;
    if (skipped > 0) {
        console.warn(`[notion] Skipped ${skipped} distributors with missing names`);
    }
    if (validDistributors.length === 0) return;

    const db = (await notionApiRequest("POST", "/databases", {
        parent: { type: "page_id", page_id: parentPageId },
        is_inline: true,
        title: [{ type: "text", text: { content: "Distribution Network" } }],
        properties: {
            Name: { title: {} },
            Type: {
                select: {
                    options: [{ name: "Retailer" }, { name: "Representative" }],
                },
            },
            Street: { rich_text: {} },
            City: { rich_text: {} },
            "Postal Code": { rich_text: {} },
            Phone: { rich_text: {} },
            Email: { email: {} },
            Website: { url: {} },
        },
    })) as { id: string };

    const dbId = db.id;
    const BATCH_SIZE = 3;
    let created = 0;
    let failed = 0;

    for (let i = 0; i < validDistributors.length; i += BATCH_SIZE) {
        const batch = validDistributors.slice(i, i + BATCH_SIZE);
        const results = await Promise.allSettled(
            batch.map((d) =>
                notionApiRequest("POST", "/pages", {
                    parent: { database_id: dbId },
                    properties: buildDistributorProps(d),
                }),
            ),
        );

        for (const r of results) {
            if (r.status === "fulfilled") created++;
            else {
                failed++;
                console.error("[notion] Failed to create distributor row:", r.reason);
            }
        }
    }

    if (failed > 0) {
        console.warn(
            `[notion] Distributor rows: ${created} created, ${failed} failed`,
        );
    }
}

function buildContactProps(
    c: HunterContact,
    availablePropertyNames?: Set<string>,
): Record<string, unknown> {
    const displayName =
        [c.firstName, c.lastName].filter(Boolean).join(" ") || c.email;
    const hasProperty = (name: string): boolean =>
        !availablePropertyNames || availablePropertyNames.has(name);

    const props: Record<string, unknown> = {
        Name: { title: [{ text: { content: displayName } }] },
        Email: { email: c.email },
    };

    if (c.position && hasProperty("Position")) {
        props["Position"] = { rich_text: [{ text: { content: c.position } }] };
    }
    if (c.confidence !== undefined && hasProperty("Confidence")) {
        props["Confidence"] = { number: c.confidence };
    }
    if (c.type && hasProperty("Type")) {
        const typeVal = c.type.charAt(0).toUpperCase() + c.type.slice(1);
        props["Type"] = { select: { name: typeVal } };
    }
    if (c.linkedin && hasProperty("LinkedIn")) {
        props["LinkedIn"] = { url: c.linkedin };
    }
    if (c.phone && hasProperty("Phone")) {
        props["Phone"] = { rich_text: [{ text: { content: c.phone } }] };
    }
    if (c.verified !== undefined && hasProperty("Verified")) {
        props["Verified"] = { checkbox: c.verified };
    }
    if (c.verificationStatus && hasProperty("Verification Status")) {
        props["Verification Status"] = {
            rich_text: [{ text: { content: c.verificationStatus } }],
        };
    }

    return props;
}

interface NotionBlockListResponse {
    results?: Array<{
        id: string;
        type?: string;
        child_database?: { title?: string };
        bulleted_list_item?: {
            rich_text?: Array<{
                plain_text?: string;
                text?: { content?: string };
            }>;
        };
        paragraph?: {
            rich_text?: Array<{
                plain_text?: string;
                text?: { content?: string };
            }>;
        };
    }>;
    has_more?: boolean;
    next_cursor?: string;
}

interface NotionDatabaseQueryResponse {
    results?: Array<{
        id: string;
        properties?: {
            Email?: { email?: string | null };
        };
    }>;
    has_more?: boolean;
    next_cursor?: string;
}

interface NotionDatabaseResponse {
    properties?: Record<string, unknown>;
}

interface NotionPageResponse {
    id: string;
    parent?: {
        database_id?: string;
    };
    properties?: {
        Name?: {
            title?: Array<{ plain_text?: string; text?: { content?: string } }>;
        };
        "Architonic URL"?: { url?: string };
        "Architonic ID"?: {
            rich_text?: Array<{ plain_text?: string; text?: { content?: string } }>;
        };
    };
}

interface HunterContactsWriteResult {
    databaseId: string;
    created: number;
    failed: number;
    skippedMissingEmail: number;
    skippedExisting: number;
    archivedExisting: number;
    failedArchive: number;
    skippedArchiveConflict: number;
}

function richTextToPlainText(
    richText:
        | Array<{ plain_text?: string; text?: { content?: string } }>
        | undefined,
): string {
    if (!Array.isArray(richText)) return "";
    return richText
        .map((item) => item.plain_text || item.text?.content || "")
        .join("")
        .trim();
}

async function listPageBlocks(
    pageId: string,
): Promise<NonNullable<NotionBlockListResponse["results"]>> {
    const allBlocks: NonNullable<NotionBlockListResponse["results"]> = [];
    let cursor: string | undefined;

    do {
        const query = cursor
            ? `?page_size=100&start_cursor=${encodeURIComponent(cursor)}`
            : "?page_size=100";
        const response = (await notionApiRequest(
            "GET",
            `/blocks/${pageId}/children${query}`,
        )) as NotionBlockListResponse;
        if (response.results?.length) {
            allBlocks.push(...response.results);
        }
        cursor = response.has_more ? response.next_cursor : undefined;
    } while (cursor);

    return allBlocks;
}

function normalizeDatabaseId(value: string | undefined): string {
    return (value || "").replace(/-/g, "");
}

function extractWebsiteFromBlocks(
    blocks: NotionBlockListResponse["results"],
): string | undefined {
    if (!blocks) return undefined;

    for (const block of blocks) {
        let text = "";
        if (block.type === "bulleted_list_item") {
            text = richTextToPlainText(block.bulleted_list_item?.rich_text);
        } else if (block.type === "paragraph") {
            text = richTextToPlainText(block.paragraph?.rich_text);
        }

        if (!text) continue;
        const websiteMatch = text.match(/^Website:\s*(.+)$/i);
        if (!websiteMatch) continue;

        const website = toNonEmptyString(websiteMatch[1]);
        if (website) return website;
    }

    return undefined;
}

async function findHunterContactsDatabaseId(
    parentPageId: string,
): Promise<string | undefined> {
    const blocks = await listPageBlocks(parentPageId);
    const match = blocks.find(
        (block) =>
            block.type === "child_database" &&
            block.child_database?.title === "Hunter.io Contacts",
    );
    return match?.id;
}

async function createHunterContactsDatabase(
    parentPageId: string,
): Promise<string> {
    const db = (await notionApiRequest("POST", "/databases", {
        parent: { type: "page_id", page_id: parentPageId },
        is_inline: true,
        title: [{ type: "text", text: { content: "Hunter.io Contacts" } }],
        properties: {
            Name: { title: {} },
            Email: { email: {} },
            Position: { rich_text: {} },
            Confidence: { number: {} },
            Type: {
                select: {
                    options: [{ name: "Personal" }, { name: "Generic" }],
                },
            },
            LinkedIn: { url: {} },
            Phone: { rich_text: {} },
            Verified: { checkbox: {} },
            "Verification Status": { rich_text: {} },
        },
    })) as { id: string };

    return db.id;
}

async function ensureHunterContactsDatabase(
    parentPageId: string,
): Promise<string> {
    const existingDbId = await findHunterContactsDatabaseId(parentPageId);
    if (existingDbId) return existingDbId;
    return createHunterContactsDatabase(parentPageId);
}

async function listDatabasePropertyNames(
    databaseId: string,
): Promise<Set<string>> {
    const db = (await notionApiRequest(
        "GET",
        `/databases/${databaseId}`,
    )) as NotionDatabaseResponse;
    return new Set(Object.keys(db.properties || {}));
}

async function ensureHunterContactsDatabaseSchema(
    databaseId: string,
): Promise<Set<string>> {
    const propertyNames = await listDatabasePropertyNames(databaseId);
    const missingProperties: Record<string, unknown> = {};

    if (!propertyNames.has("Verified")) {
        missingProperties.Verified = { checkbox: {} };
    }
    if (!propertyNames.has("Verification Status")) {
        missingProperties["Verification Status"] = { rich_text: {} };
    }

    if (Object.keys(missingProperties).length === 0) {
        return propertyNames;
    }

    try {
        await notionApiRequest("PATCH", `/databases/${databaseId}`, {
            properties: missingProperties,
        });
    } catch (error) {
        console.warn(
            `[notion] Failed to update Hunter contacts database schema ${databaseId}: ${toErrorMessage(error)}`,
        );
    }

    return listDatabasePropertyNames(databaseId);
}

interface ExistingHunterContactRow {
    pageId: string;
    email?: string;
}

async function listExistingHunterRows(
    databaseId: string,
): Promise<ExistingHunterContactRow[]> {
    const rows: ExistingHunterContactRow[] = [];
    let cursor: string | undefined;

    do {
        const body: Record<string, unknown> = { page_size: 100 };
        if (cursor) {
            body.start_cursor = cursor;
        }

        const response = (await notionApiRequest(
            "POST",
            `/databases/${databaseId}/query`,
            body,
        )) as NotionDatabaseQueryResponse;

        for (const row of response.results || []) {
            rows.push({
                pageId: row.id,
                email: toNonEmptyString(row.properties?.Email?.email)?.toLowerCase(),
            });
        }

        cursor = response.has_more ? response.next_cursor : undefined;
    } while (cursor);

    return rows;
}

async function writeHunterContactsToPage(
    parentPageId: string,
    contacts: HunterContact[],
): Promise<HunterContactsWriteResult> {
    const normalizedContacts = normalizeHunterContacts(contacts);
    const skippedMissingEmail = contacts.length - normalizedContacts.length;

    const databaseId = await ensureHunterContactsDatabase(parentPageId);
    const databasePropertyNames =
        await ensureHunterContactsDatabaseSchema(databaseId);
    const existingRows = await listExistingHunterRows(databaseId);

    const existingRowsByPageId = new Map(
        existingRows.map((row) => [row.pageId, row]),
    );

    const ARCHIVE_BATCH_SIZE = 10;
    let archivedExisting = 0;
    let failedArchive = 0;
    const failedArchiveEmails = new Set<string>();

    for (let i = 0; i < existingRows.length; i += ARCHIVE_BATCH_SIZE) {
        const batch = existingRows.slice(i, i + ARCHIVE_BATCH_SIZE);
        const results = await Promise.allSettled(
            batch.map((row) =>
                notionApiRequest("PATCH", `/pages/${row.pageId}`, {
                    archived: true,
                }),
            ),
        );

        for (let idx = 0; idx < results.length; idx++) {
            const result = results[idx];
            const row = batch[idx];
            if (result.status === "fulfilled") {
                archivedExisting++;
            } else {
                failedArchive++;
                const failedRow = existingRowsByPageId.get(row.pageId);
                if (failedRow?.email) {
                    failedArchiveEmails.add(failedRow.email);
                }
                console.error(
                    `[notion] Failed to archive contact row ${row.pageId}:`,
                    result.reason,
                );
            }
        }
    }

    const toCreate = normalizedContacts.filter(
        (contact) => !failedArchiveEmails.has(contact.email),
    );
    const skippedArchiveConflict = normalizedContacts.length - toCreate.length;
    const skippedExisting = 0;

    const CREATE_BATCH_SIZE = 3;
    let created = 0;
    let failed = 0;

    for (let i = 0; i < toCreate.length; i += CREATE_BATCH_SIZE) {
        const batch = toCreate.slice(i, i + CREATE_BATCH_SIZE);
        const results = await Promise.allSettled(
            batch.map((contact) =>
                notionApiRequest("POST", "/pages", {
                    parent: { database_id: databaseId },
                    properties: buildContactProps(contact, databasePropertyNames),
                }),
            ),
        );

        for (const result of results) {
            if (result.status === "fulfilled") created++;
            else {
                failed++;
                console.error("[notion] Failed to create contact row:", result.reason);
            }
        }
    }

    return {
        databaseId,
        created,
        failed,
        skippedMissingEmail,
        skippedExisting,
        archivedExisting,
        failedArchive,
        skippedArchiveConflict,
    };
}

function toNonEmptyString(value: unknown): string | undefined {
    if (typeof value !== "string") return undefined;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
}

function toOptionalNumber(value: unknown): number | undefined {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string") {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) return parsed;
    }
    return undefined;
}

function resolveHeaderImageUrl(
    extractedHeaderImageUrl: string | null,
    metadata: { ogImage?: string;[key: string]: unknown } | undefined,
): string | undefined {
    const extracted = toNonEmptyString(extractedHeaderImageUrl);
    if (extracted) return extracted;

    const fallbackOgImage = toNonEmptyString(metadata?.ogImage);
    if (!fallbackOgImage) return undefined;

    const sanitizedOgImage = fallbackOgImage.split("?")[0];
    if (/\/logo\//i.test(sanitizedOgImage)) return undefined;
    return sanitizedOgImage;
}

function firstNonEmptyString(...values: unknown[]): string | undefined {
    for (const value of values) {
        const normalized = toNonEmptyString(value);
        if (normalized) return normalized;
    }
    return undefined;
}

function normalizeProductTypes(
    input: SaveBrandArgs["productType"],
): MatterbaseBrandProductType[] {
    if (!Array.isArray(input)) return [];

    const valid = new Set<MatterbaseBrandProductType>([
        "material",
        "furniture",
        "lighting",
        "hardware",
    ]);
    const seen = new Set<MatterbaseBrandProductType>();
    const out: MatterbaseBrandProductType[] = [];

    for (const item of input) {
        if (!valid.has(item)) continue;
        if (seen.has(item)) continue;
        seen.add(item);
        out.push(item);
    }

    return out;
}

function normalizeExcludedCountries(
    input: SaveBrandArgs["excludedCountries"],
): MatterbaseExcludedCountry[] {
    if (!Array.isArray(input)) return [];

    const seen = new Set<string>();
    const out: MatterbaseExcludedCountry[] = [];

    for (const item of input) {
        const code = toNonEmptyString(item?.code);
        const name = toNonEmptyString(item?.name);
        if (!code || !name) continue;
        const key = `${code.toUpperCase()}::${name.toLowerCase()}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ code: code.toUpperCase(), name });
    }

    return out;
}

function buildSavedMatterbaseCreatePayload(
    notionPageId: string,
    args: SaveBrandArgs,
    resolvedData: ResolvedBrandData,
): SavedMatterbaseCreatePayload {
    const productType = normalizeProductTypes(args.productType);
    const excludedCountries = normalizeExcludedCountries(args.excludedCountries);
    const companyName = toNonEmptyString(args.companyName) || resolvedData.name;

    return {
        notionPageId,
        scrapeSessionId: args.scrapeSessionId,
        name: resolvedData.name,
        companyName,
        productType,
        countryCode: toNonEmptyString(args.countryCode),
        countryName: toNonEmptyString(args.countryName),
        website: resolvedData.website,
        contactName: resolvedData.contactName || "",
        contactJobTitle: resolvedData.contactJobTitle || "-",
        contactEmail: resolvedData.contactEmail,
        excludedCountries,
        isDisabled: args.isDisabled ?? true,
        logoUrl: resolvedData.logoUrl,
        savedAt: new Date().toISOString(),
    };
}

function getMissingMatterbaseCreatePayloadFields(
    payload: SavedMatterbaseCreatePayload,
): string[] {
    const missing: string[] = [];
    if (!payload.name) missing.push("name");
    if (!payload.companyName) missing.push("companyName");
    if (!payload.productType.length) missing.push("productType");
    if (!payload.countryCode) missing.push("countryCode");
    if (!payload.countryName) missing.push("countryName");
    if (!payload.website) missing.push("website");
    if (!payload.contactEmail) missing.push("contactEmail");
    return missing;
}

function splitMissingMatterbaseCreateFields(missingFields: string[]): {
    retryableMissingFields: string[];
    nonRetryableMissingFields: string[];
} {
    const retryableMissingFields: string[] = [];
    const nonRetryableMissingFields: string[] = [];

    for (const field of missingFields) {
        if (RETRYABLE_MATTERBASE_CREATE_FIELDS.has(field)) {
            retryableMissingFields.push(field);
        } else {
            nonRetryableMissingFields.push(field);
        }
    }

    return { retryableMissingFields, nonRetryableMissingFields };
}

function toErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function extractDomainFromWebsite(
    website: string | undefined,
): string | undefined {
    if (!website) return undefined;

    try {
        const normalizedWebsite = website.startsWith("http")
            ? website
            : `https://${website}`;
        const hostname = new URL(normalizedWebsite).hostname
            .toLowerCase()
            .replace(/^www\./, "");
        return hostname || undefined;
    } catch {
        const fallback = website
            .replace(/^https?:\/\//i, "")
            .replace(/^www\./i, "")
            .split("/")[0]
            .trim()
            .toLowerCase();
        return fallback || undefined;
    }
}

function normalizeHunterContacts(
    contacts: HunterContact[] | undefined,
): HunterContact[] {
    if (!Array.isArray(contacts) || contacts.length === 0) return [];

    const seenEmails = new Set<string>();
    const normalized: HunterContact[] = [];

    for (const contact of contacts) {
        const email = toNonEmptyString(contact?.email)?.toLowerCase();
        if (!email || seenEmails.has(email)) continue;
        seenEmails.add(email);

        normalized.push({
            email,
            firstName: toNonEmptyString(contact.firstName),
            lastName: toNonEmptyString(contact.lastName),
            position: toNonEmptyString(contact.position),
            confidence:
                typeof contact.confidence === "number" ? contact.confidence : undefined,
            type: contact.type,
            linkedin: toNonEmptyString(contact.linkedin),
            phone: toNonEmptyString(contact.phone),
            verified:
                typeof contact.verified === "boolean" ? contact.verified : undefined,
            verificationStatus: toNonEmptyString(contact.verificationStatus),
        });
    }

    return normalized;
}

interface HunterEnrichmentResult {
    contacts: HunterContact[];
    source: "provided" | "auto_lookup" | "none";
    domain?: string;
    reason?: string;
}

async function resolveHunterContacts(
    providedContacts: HunterContact[] | undefined,
    website: string | undefined,
    limit: number = DEFAULT_HUNTER_CONTACT_LIMIT,
): Promise<HunterEnrichmentResult> {
    const normalizedProvided = normalizeHunterContacts(providedContacts);
    if (normalizedProvided.length > 0) {
        return {
            contacts: normalizedProvided,
            source: "provided",
        };
    }

    const domain = extractDomainFromWebsite(website);
    if (!domain) {
        return {
            contacts: [],
            source: "none",
            reason: "No website domain available for Hunter lookup.",
        };
    }

    const hunterClient = getHunterClient();
    if (!hunterClient.isConfigured()) {
        return {
            contacts: [],
            source: "none",
            domain,
            reason: "Hunter client not configured (missing HUNTER_API_KEY).",
        };
    }

    try {
        const result = await hunterClient.domainSearch(domain, {
            limit,
        });

        if (
            !result ||
            !Array.isArray(result.emails) ||
            result.emails.length === 0
        ) {
            return {
                contacts: [],
                source: "none",
                domain,
                reason: "Hunter lookup returned no contacts.",
            };
        }

        const autoContacts = normalizeHunterContacts(
            result.emails.map((email) => ({
                email: email.email,
                firstName: email.firstName ?? undefined,
                lastName: email.lastName ?? undefined,
                position: email.position ?? undefined,
                confidence: email.confidence,
                type: email.type,
                linkedin: email.linkedin ?? undefined,
                phone: email.phone_number ?? undefined,
                verified: email.verified,
                verificationStatus: email.verification_status ?? undefined,
            })),
        );

        if (autoContacts.length === 0) {
            return {
                contacts: [],
                source: "none",
                domain,
                reason: "Hunter lookup returned contacts but none had valid emails.",
            };
        }

        return {
            contacts: autoContacts,
            source: "auto_lookup",
            domain,
        };
    } catch (error) {
        return {
            contacts: [],
            source: "none",
            domain,
            reason: `Hunter lookup error: ${toErrorMessage(error)}`,
        };
    }
}

async function archiveNotionPage(
    pageId: string,
): Promise<{ archived: boolean; error?: string }> {
    try {
        await notionApiRequest("PATCH", `/pages/${pageId}`, { archived: true });
        return { archived: true };
    } catch (error) {
        return {
            archived: false,
            error: toErrorMessage(error),
        };
    }
}

function buildFailedIndexNote(message: string): string {
    const normalized = message.replace(/\s+/g, " ").trim();
    if (normalized.length <= 1800) return normalized;
    return `${normalized.slice(0, 1797)}...`;
}

async function markBrandIndexAsFailed(
    architonicId: string | undefined,
    notes: string,
): Promise<{ success: boolean; pageId?: string; error?: string }> {
    if (!architonicId) {
        return {
            success: false,
            error: "Missing architonicId; cannot update brand index status.",
        };
    }

    try {
        const queryResult = (await notionApiRequest(
            "POST",
            `/databases/${BRAND_INDEX_DATABASE_ID}/query`,
            {
                filter: {
                    property: "Architonic ID",
                    rich_text: { equals: architonicId },
                },
                page_size: 1,
            },
        )) as { results?: Array<{ id: string }> };

        const pageId = queryResult.results?.[0]?.id;
        if (!pageId) {
            return {
                success: false,
                error: `Brand with Architonic ID "${architonicId}" not found in brand index.`,
            };
        }

        await notionApiRequest("PATCH", `/pages/${pageId}`, {
            properties: {
                Status: { select: { name: "failed" } },
                "Last Synced": { date: { start: new Date().toISOString() } },
                Notes: {
                    rich_text: [{ text: { content: buildFailedIndexNote(notes) } }],
                },
            },
        });

        return { success: true, pageId };
    } catch (error) {
        return {
            success: false,
            error: toErrorMessage(error),
        };
    }
}

function resolveScrapedPrimaryContact(
    contactDetails: Record<string, string | number | null>,
): Pick<ResolvedBrandData, "contactName" | "contactJobTitle" | "contactEmail"> {
    const rawName = firstNonEmptyString(
        contactDetails["contactName"],
        contactDetails["contactPerson"],
        contactDetails["contactFullName"],
    );
    const rawJobTitle = firstNonEmptyString(
        contactDetails["contactJobTitle"],
        contactDetails["contactTitle"],
        contactDetails["contactRole"],
        contactDetails["jobTitle"],
        contactDetails["position"],
        contactDetails["role"],
    );
    const rawEmail = firstNonEmptyString(
        contactDetails["email"],
        contactDetails["contactEmail"],
    );

    return {
        contactName:
            rawName && isPlausibleContactString(rawName) ? rawName : undefined,
        contactJobTitle:
            rawJobTitle && isPlausibleContactString(rawJobTitle)
                ? rawJobTitle
                : undefined,
        contactEmail: rawEmail && isPlausibleEmail(rawEmail) ? rawEmail : undefined,
    };
}

function parseArchitonicId(url: string): string | undefined {
    const match = url.match(/\/(\d+)(?:\/?(?:\?.*)?)?$/);
    return match ? match[1] : undefined;
}

function safeDecode(value: string): string {
    try {
        return decodeURIComponent(value);
    } catch {
        return value;
    }
}

function inferCatalogTitle(link: ParsedCatalogLink): string {
    const raw = link.filename || link.url.split("/").pop() || "Catalog";
    const withoutExt = raw.replace(/\.[a-z0-9]{2,5}$/i, "");
    const normalized = safeDecode(withoutExt)
        .replace(/[\-_]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();

    return normalized || "Catalog";
}

function deriveCatalogs(
    catalogLinks: ParsedCatalogLink[],
): Catalog[] | undefined {
    if (catalogLinks.length === 0) return undefined;

    const seenUrls = new Set<string>();
    const catalogs: Catalog[] = [];

    for (const link of catalogLinks) {
        if (!link.url || seenUrls.has(link.url)) continue;
        seenUrls.add(link.url);
        catalogs.push({
            title: inferCatalogTitle(link),
            downloadUrl: link.url,
        });
    }

    return catalogs.length > 0 ? catalogs : undefined;
}

function normalizeDescriptionText(raw: string): string | undefined {
    const withoutImages = raw.replace(/!\[[^\]]*]\([^)]+\)/g, " ");
    const withoutLinks = withoutImages.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
    const withoutInlineCode = withoutLinks.replace(/`([^`]*)`/g, "$1");
    const withoutFormatting = withoutInlineCode
        .replace(/[*_~]/g, "")
        .replace(/^>\s?/gm, "")
        .replace(/^\s*[-*+]\s+/gm, "")
        .replace(/^\s*\d+\.\s+/gm, "");
    const collapsed = withoutFormatting.replace(/\s+/g, " ").trim();
    if (!collapsed) return undefined;
    return collapsed.length > 1800 ? `${collapsed.slice(0, 1797)}...` : collapsed;
}

function extractDescriptionFromMarkdown(
    markdown: string | undefined,
): string | undefined {
    if (!markdown) return undefined;

    const normalizedMarkdown = markdown.replace(/\r\n/g, "\n").trim();
    if (!normalizedMarkdown) return undefined;

    const headingPattern =
        /^#{1,3}\s*(about|philosophy|company|who we are|our story)\b/i;
    const anyHeadingPattern = /^#{1,6}\s+/;
    const lines = normalizedMarkdown.split("\n");

    for (let i = 0; i < lines.length; i++) {
        if (!headingPattern.test(lines[i].trim())) continue;

        const sectionLines: string[] = [];
        for (let j = i + 1; j < lines.length; j++) {
            if (anyHeadingPattern.test(lines[j].trim())) break;
            sectionLines.push(lines[j]);
        }

        const sectionText = normalizeDescriptionText(sectionLines.join("\n"));
        if (sectionText) return sectionText;
    }

    // No generic paragraph fallback: avoid storing breadcrumb/meta fragments
    // when brands do not provide an explicit About/Philosophy section.
    return undefined;
}

function findDisallowedInputFields(rawArgs: Record<string, unknown>): string[] {
    return DISALLOWED_SCRAPED_FIELDS.filter((field) =>
        Object.prototype.hasOwnProperty.call(rawArgs, field),
    );
}

function parseValidationResult(raw: string): ValidationResult | null {
    try {
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object") return null;

        const candidate = parsed as Partial<ValidationResult>;
        if (typeof candidate.errorCount !== "number") return null;
        if (typeof candidate.warningCount !== "number") return null;
        if (!Array.isArray(candidate.issues)) return null;
        if (typeof candidate.valid !== "boolean") return null;
        if (typeof candidate.summary !== "string") return null;

        return candidate as ValidationResult;
    } catch {
        return null;
    }
}

function buildResolvedBrandData(
    args: SaveBrandArgs,
    snapshot: BrandScrapeSessionSnapshot,
): ResolvedBrandData {
    const contactDetails = snapshot.contactDetails || {};
    const scrapedPrimaryContact = resolveScrapedPrimaryContact(contactDetails);

    const cachedDistributors = getCachedDistributors(args.architonicUrl) || [];
    const resolvedDistributors =
        cachedDistributors.length > snapshot.parsedDistributors.length
            ? cachedDistributors
            : snapshot.parsedDistributors;

    const cachedCatalogLinks = getCachedCatalogLinks(args.architonicUrl) || [];
    const resolvedCatalogLinks =
        cachedCatalogLinks.length > snapshot.parsedCatalogLinks.length
            ? cachedCatalogLinks
            : snapshot.parsedCatalogLinks;

    const cachedImages = getCachedImageUrls(args.architonicUrl);
    const imageUrls = {
        logoUrl:
            snapshot.extractedImageUrls.logoUrl || cachedImages?.logoUrl || null,
        headerImageUrl:
            snapshot.extractedImageUrls.headerImageUrl ||
            cachedImages?.headerImageUrl ||
            null,
        aboutImageUrl:
            snapshot.extractedImageUrls.aboutImageUrl ||
            cachedImages?.aboutImageUrl ||
            null,
    };

    const companyEmail = toNonEmptyString(contactDetails.email);

    return {
        name: args.name,
        architonicUrl: args.architonicUrl,
        scrapeSessionId: args.scrapeSessionId,
        architonicId: parseArchitonicId(args.architonicUrl),
        countryCode: toNonEmptyString(args.countryCode),
        description: extractDescriptionFromMarkdown(snapshot.markdown),
        contactName:
            scrapedPrimaryContact.contactName || toNonEmptyString(args.contactName),
        contactJobTitle:
            scrapedPrimaryContact.contactJobTitle ||
            toNonEmptyString(args.contactJobTitle),
        contactEmail:
            scrapedPrimaryContact.contactEmail || toNonEmptyString(args.contactEmail),
        hunterContacts: args.hunterContacts,
        street: toNonEmptyString(contactDetails.street),
        city: toNonEmptyString(contactDetails.city),
        postalCode: toNonEmptyString(contactDetails.zip),
        phone: toNonEmptyString(contactDetails.phone),
        email:
            companyEmail && isPlausibleEmail(companyEmail) ? companyEmail : undefined,
        latitude: toOptionalNumber(contactDetails.lat),
        longitude: toOptionalNumber(contactDetails.lng),
        website: toNonEmptyString(contactDetails.website),
        facebook: toNonEmptyString(contactDetails.facebook),
        instagram: toNonEmptyString(contactDetails.instagram),
        pinterest: toNonEmptyString(contactDetails.pinterest),
        logoUrl: toNonEmptyString(imageUrls.logoUrl),
        headerImageUrl: resolveHeaderImageUrl(
            imageUrls.headerImageUrl,
            snapshot.metadata,
        ),
        aboutImageUrl: toNonEmptyString(imageUrls.aboutImageUrl),
        distributors:
            resolvedDistributors.length > 0 ? resolvedDistributors : undefined,
        catalogs: deriveCatalogs(resolvedCatalogLinks),
        scrapedAtIso: new Date(snapshot.createdAt).toISOString(),
    };
}

function toValidationBrandData(
    resolvedData: ResolvedBrandData,
): Record<string, unknown> {
    return {
        architonicUrl: resolvedData.architonicUrl,
        phone: resolvedData.phone,
        email: resolvedData.email,
        street: resolvedData.street,
        city: resolvedData.city,
        postalCode: resolvedData.postalCode,
        latitude: resolvedData.latitude,
        longitude: resolvedData.longitude,
        website: resolvedData.website,
        facebook: resolvedData.facebook,
        instagram: resolvedData.instagram,
        pinterest: resolvedData.pinterest,
        description: resolvedData.description,
        logoUrl: resolvedData.logoUrl,
        headerImageUrl: resolvedData.headerImageUrl,
        aboutImageUrl: resolvedData.aboutImageUrl,
        distributors: resolvedData.distributors,
        catalogs: resolvedData.catalogs,
        contactEmail: resolvedData.contactEmail,
    };
}

export async function executeSaveBrandToNotion(
    args: SaveBrandArgs,
): Promise<string> {
    const rawArgs = args as unknown as Record<string, unknown>;
    const disallowedFields = findDisallowedInputFields(rawArgs);
    if (disallowedFields.length > 0) {
        return JSON.stringify({
            success: false,
            code: "DISALLOWED_SCRAPED_FIELDS",
            error:
                "save_brand_to_notion received fields that must come from scrape data. Pass only scrapeSessionId and allowed enrichment fields.",
            rejectedFields: disallowedFields,
            allowedFields: ALLOWED_SAVE_FIELDS,
        });
    }

    const snapshot = getBrandScrapeSession(args.scrapeSessionId);
    if (!snapshot) {
        return JSON.stringify({
            success: false,
            code: "PROVENANCE_SESSION_NOT_FOUND",
            error:
                "No active scrape session found. Re-run scrape_brand and use the returned scrapeSessionId within 60 minutes.",
            scrapeSessionId: args.scrapeSessionId,
        });
    }

    if (snapshot.architonicUrl !== args.architonicUrl) {
        return JSON.stringify({
            success: false,
            code: "PROVENANCE_URL_MISMATCH",
            error: "architonicUrl does not match the scrape session source URL.",
            scrapeSessionId: args.scrapeSessionId,
            expectedArchitonicUrl: snapshot.architonicUrl,
            receivedArchitonicUrl: args.architonicUrl,
        });
    }

    const resolvedData = buildResolvedBrandData(args, snapshot);
    const hunterEnrichment = await resolveHunterContacts(
        args.hunterContacts,
        resolvedData.website,
    );
    resolvedData.hunterContacts =
        hunterEnrichment.contacts.length > 0
            ? hunterEnrichment.contacts
            : undefined;

    const scrapeResultForValidation: ScrapeResultInput = {
        contactDetails: snapshot.contactDetails,
        parsedDistributors: snapshot.parsedDistributors,
        distributorCount: snapshot.parsedDistributors.length,
        markdown: snapshot.markdown,
        links: snapshot.links,
        metadata: snapshot.metadata,
        extractedImageUrls: snapshot.extractedImageUrls,
    };

    const validationRaw = executeValidateBrandData({
        scrapeResult: scrapeResultForValidation,
        brandData: toValidationBrandData(resolvedData),
    });
    const validation = parseValidationResult(validationRaw);

    if (!validation) {
        return JSON.stringify({
            success: false,
            code: "PROVENANCE_VALIDATION_PARSE_ERROR",
            error: "Internal validation returned an unreadable result.",
            scrapeSessionId: args.scrapeSessionId,
        });
    }

    if (validation.errorCount > 0 || !validation.valid) {
        return JSON.stringify({
            success: false,
            code: "PROVENANCE_VALIDATION_FAILED",
            error:
                "Resolved brand payload failed provenance validation against scraped output.",
            scrapeSessionId: args.scrapeSessionId,
            validation,
        });
    }

    const properties: Record<string, unknown> = {
        Name: { title: [{ text: { content: resolvedData.name } }] },
        "Architonic URL": { url: resolvedData.architonicUrl },
    };

    if (resolvedData.architonicId) {
        properties["Architonic ID"] = {
            rich_text: [{ text: { content: resolvedData.architonicId } }],
        };
    }

    const children = buildPageBody(resolvedData);

    const postArgs: Record<string, unknown> = {
        parent: { database_id: BRANDS_DATABASE_ID },
        properties,
    };

    if (children.length > 0) {
        postArgs.children = children;
    }

    const result = (await notionApiRequest("POST", "/pages", postArgs)) as {
        id: string;
        [key: string]: unknown;
    };
    const pageId = result.id;

    const matterbaseCreatePayload = buildSavedMatterbaseCreatePayload(
        pageId,
        args,
        resolvedData,
    );
    const missingMatterbaseCreateFields = getMissingMatterbaseCreatePayloadFields(
        matterbaseCreatePayload,
    );
    const { retryableMissingFields, nonRetryableMissingFields } =
        splitMissingMatterbaseCreateFields(missingMatterbaseCreateFields);

    if (nonRetryableMissingFields.length > 0) {
        matterbaseCreatePayloadCache.delete(pageId);
        const archiveResult = await archiveNotionPage(pageId);
        const failedReason =
            `Auto-marked as failed: missing non-retryable fields (${nonRetryableMissingFields.join(", ")}) ` +
            `after save_brand_to_notion.`;
        const indexUpdate = await markBrandIndexAsFailed(
            resolvedData.architonicId,
            failedReason,
        );

        return JSON.stringify(
            {
                success: false,
                code: "MATTERBASE_CREATE_NON_RETRYABLE_MISSING_FIELDS",
                error:
                    "Required fields missing for Matterbase creation and they are not enrichable in save_brand_to_notion. Saved Notion attempt was archived.",
                notionPageId: pageId,
                scrapeSessionId: args.scrapeSessionId,
                missingFields: missingMatterbaseCreateFields,
                retryableMissingFields,
                nonRetryableMissingFields,
                archivedSavedPage: archiveResult.archived,
                archiveError: archiveResult.error,
                brandIndexUpdate: indexUpdate,
                hunterEnrichment: {
                    source: hunterEnrichment.source,
                    domain: hunterEnrichment.domain,
                    contactCount: hunterEnrichment.contacts.length,
                    reason: hunterEnrichment.reason,
                },
                matterbaseCreatePayload,
                instruction:
                    "Do not retry save_brand_to_notion for this brand in the same run. Continue with remaining brands.",
            },
            null,
            2,
        );
    }

    pruneMatterbaseCreatePayloadCache();
    matterbaseCreatePayloadCache.set(pageId, matterbaseCreatePayload);

    if (resolvedData.distributors?.length && pageId) {
        try {
            await createDistributorChildDatabase(pageId, resolvedData.distributors);
            console.log(
                `[notion] Created distributor sub-table for "${resolvedData.name}" (${resolvedData.distributors.length} distributors)`,
            );
        } catch (err) {
            console.error(
                `[notion] Failed to create distributor sub-table for "${resolvedData.name}":`,
                err,
            );
        }
    }

    if (resolvedData.hunterContacts?.length && pageId) {
        try {
            const hunterWriteResult = await writeHunterContactsToPage(
                pageId,
                resolvedData.hunterContacts,
            );
            console.log(
                `[notion] Hunter contacts for "${resolvedData.name}": ` +
                `${hunterWriteResult.archivedExisting} archived existing, ` +
                `${hunterWriteResult.created} created, ` +
                `${hunterWriteResult.skippedArchiveConflict} skipped due to archive conflicts, ` +
                `${hunterWriteResult.failedArchive} archive failed, ` +
                `${hunterWriteResult.failed} failed`,
            );
        } catch (err) {
            console.error(
                `[notion] Failed to create contacts sub-table for "${resolvedData.name}":`,
                err,
            );
        }
    }

    return JSON.stringify(
        {
            success: true,
            ...result,
            scrapeSessionId: args.scrapeSessionId,
            provenance: {
                sourceUrl: resolvedData.architonicUrl,
                scrapedAt: resolvedData.scrapedAtIso,
            },
            provenanceValidation: {
                valid: validation.valid,
                errorCount: validation.errorCount,
                warningCount: validation.warningCount,
                summary: validation.summary,
            },
            correctedImageUrls: {
                logoUrl: resolvedData.logoUrl,
                headerImageUrl: resolvedData.headerImageUrl,
                aboutImageUrl: resolvedData.aboutImageUrl,
            },
            hunterEnrichment: {
                source: hunterEnrichment.source,
                domain: hunterEnrichment.domain,
                contactCount: hunterEnrichment.contacts.length,
                reason: hunterEnrichment.reason,
            },
            matterbaseCreateHints: {
                ready: missingMatterbaseCreateFields.length === 0,
                missingFields: missingMatterbaseCreateFields,
                retryableMissingFields,
                nonRetryableMissingFields,
                instruction:
                    missingMatterbaseCreateFields.length === 0
                        ? "Call matterbase_create_brand with notionPageId only. It will use this saved payload, including logoUrl when available."
                        : "Missing required enrichable fields for Matterbase creation. Re-run save_brand_to_notion with the missing enrichment fields before calling matterbase_create_brand.",
            },
            matterbaseCreatePayload,
            matterbaseCreateReady: missingMatterbaseCreateFields.length === 0,
            matterbaseCreateMissingFields: missingMatterbaseCreateFields,
            matterbaseCreateRetryableMissingFields: retryableMissingFields,
            matterbaseCreateNonRetryableMissingFields: nonRetryableMissingFields,
            matterbaseCreateInput: {
                notionPageId: pageId,
            },
        },
        null,
        2,
    );
}

export interface EnrichExistingBrandHunterContactsArgs {
    notionPageId: string;
    domain?: string;
    limit?: number;
}

export async function executeEnrichExistingBrandHunterContacts(
    args: EnrichExistingBrandHunterContactsArgs,
): Promise<string> {
    const requestedLimit =
        typeof args.limit === "number" &&
            Number.isFinite(args.limit) &&
            args.limit > 0
            ? Math.min(Math.floor(args.limit), 50)
            : DEFAULT_HUNTER_CONTACT_LIMIT;

    const page = (await notionApiRequest(
        "GET",
        `/pages/${args.notionPageId}`,
    )) as NotionPageResponse;
    const parentDatabaseId = normalizeDatabaseId(page.parent?.database_id);
    if (parentDatabaseId !== normalizeDatabaseId(BRANDS_DATABASE_ID)) {
        return JSON.stringify({
            success: false,
            code: "INVALID_TARGET_PAGE",
            error: "notionPageId must belong to the Brands database.",
            notionPageId: args.notionPageId,
        });
    }

    const brandName =
        richTextToPlainText(page.properties?.Name?.title) || undefined;
    const architonicUrl = toNonEmptyString(
        page.properties?.["Architonic URL"]?.url,
    );
    const architonicId =
        richTextToPlainText(page.properties?.["Architonic ID"]?.rich_text) ||
        undefined;

    const pageBlocks = await listPageBlocks(args.notionPageId);
    const websiteFromPage = extractWebsiteFromBlocks(pageBlocks);
    const websiteOrDomain = toNonEmptyString(args.domain) || websiteFromPage;

    const hunterEnrichment = await resolveHunterContacts(
        undefined,
        websiteOrDomain,
        requestedLimit,
    );

    if (hunterEnrichment.contacts.length === 0) {
        return JSON.stringify(
            {
                success: true,
                updated: false,
                code: "HUNTER_ENRICHMENT_SKIPPED",
                notionPageId: args.notionPageId,
                brandName,
                architonicId,
                architonicUrl,
                website: websiteOrDomain,
                hunterEnrichment: {
                    source: hunterEnrichment.source,
                    domain: hunterEnrichment.domain,
                    contactCount: 0,
                    reason: hunterEnrichment.reason,
                },
            },
            null,
            2,
        );
    }

    const writeResult = await writeHunterContactsToPage(
        args.notionPageId,
        hunterEnrichment.contacts,
    );

    return JSON.stringify(
        {
            success: true,
            updated: writeResult.created > 0 || writeResult.archivedExisting > 0,
            replacementMode: "replace_all",
            notionPageId: args.notionPageId,
            brandName,
            architonicId,
            architonicUrl,
            website: websiteOrDomain,
            hunterEnrichment: {
                source: hunterEnrichment.source,
                domain: hunterEnrichment.domain,
                contactCount: hunterEnrichment.contacts.length,
                reason: hunterEnrichment.reason,
            },
            hunterContactsDatabaseId: writeResult.databaseId,
            archivedExistingContacts: writeResult.archivedExisting,
            failedArchiveContacts: writeResult.failedArchive,
            skippedArchiveConflictContacts: writeResult.skippedArchiveConflict,
            createdContacts: writeResult.created,
            skippedExistingContacts: writeResult.skippedExisting,
            skippedMissingEmail: writeResult.skippedMissingEmail,
            failedContacts: writeResult.failed,
        },
        null,
        2,
    );
}

export interface EnrichBrandHunterContactsByNameArgs {
    brandName: string;
    domain?: string;
    limit?: number;
}

interface NotionSearchResponse {
    has_more?: boolean;
    next_cursor?: string | null;
    results?: Array<{
        id: string;
        parent?: { database_id?: string };
        properties?: {
            Name?: {
                title?: Array<{ text?: { content?: string }; plain_text?: string }>;
            };
        };
    }>;
}

function normalizeBrandNameForMatch(value: string): string {
    return value.trim().replace(/\s+/g, " ").toLowerCase();
}

async function findUniqueBrandPageIdByName(
    brandName: string,
): Promise<
    | { ok: true; pageId: string; matchedName: string }
    | {
        ok: false;
        code: string;
        error: string;
        candidates?: Array<{ pageId: string; name: string }>;
    }
> {
    const query = toNonEmptyString(brandName);
    const normalizedQuery = query ? normalizeBrandNameForMatch(query) : "";
    if (!normalizedQuery) {
        return {
            ok: false,
            code: "INVALID_BRAND_NAME",
            error: "brandName must be a non-empty string.",
        };
    }

    const mcpClient = getMCPClient();
    if (!mcpClient.isConnected()) {
        await mcpClient.connect();
    }

    const searchResults: NonNullable<NotionSearchResponse["results"]> = [];
    let cursor: string | undefined;

    do {
        const payload: Record<string, unknown> = {
            query,
            filter: {
                property: "object",
                value: "page",
            },
            page_size: 100,
        };

        if (cursor) {
            payload.start_cursor = cursor;
        }

        const searchResult = (await mcpClient.executeTool(
            "API-post-search",
            payload,
        )) as NotionSearchResponse;

        if (
            Array.isArray(searchResult.results) &&
            searchResult.results.length > 0
        ) {
            searchResults.push(...searchResult.results);
        }

        cursor = searchResult.has_more
            ? toNonEmptyString(searchResult.next_cursor ?? undefined)
            : undefined;
    } while (cursor);

    const candidates =
        searchResults
            ?.filter(
                (page) =>
                    normalizeDatabaseId(page.parent?.database_id) ===
                    normalizeDatabaseId(BRANDS_DATABASE_ID),
            )
            .map((page) => {
                const pageName =
                    richTextToPlainText(page.properties?.Name?.title) || "Unknown";
                return {
                    pageId: page.id,
                    name: pageName,
                    normalizedName: normalizeBrandNameForMatch(pageName),
                };
            })
            .filter((candidate) => candidate.normalizedName === normalizedQuery) ||
        [];

    if (candidates.length === 0) {
        return {
            ok: false,
            code: "BRAND_NOT_FOUND",
            error: `Brand "${brandName}" was not found in the Brands database.`,
        };
    }

    if (candidates.length > 1) {
        return {
            ok: false,
            code: "AMBIGUOUS_BRAND_MATCH",
            error: `Brand name "${brandName}" matched multiple pages. Use notionPageId to disambiguate.`,
            candidates: candidates.map((candidate) => ({
                pageId: candidate.pageId,
                name: candidate.name,
            })),
        };
    }

    return {
        ok: true,
        pageId: candidates[0].pageId,
        matchedName: candidates[0].name,
    };
}

export async function executeEnrichBrandHunterContactsByName(
    args: EnrichBrandHunterContactsByNameArgs,
): Promise<string> {
    const resolved = await findUniqueBrandPageIdByName(args.brandName);
    if (!resolved.ok) {
        return JSON.stringify(
            {
                success: false,
                code: resolved.code,
                error: resolved.error,
                brandName: args.brandName,
                candidates: resolved.candidates,
            },
            null,
            2,
        );
    }

    const enrichResultRaw = await executeEnrichExistingBrandHunterContacts({
        notionPageId: resolved.pageId,
        domain: args.domain,
        limit: args.limit,
    });

    let enrichResult: Record<string, unknown>;
    try {
        enrichResult = JSON.parse(enrichResultRaw) as Record<string, unknown>;
    } catch {
        return enrichResultRaw;
    }

    return JSON.stringify(
        {
            ...enrichResult,
            requestedBrandName: args.brandName,
            resolvedBrandName: resolved.matchedName,
            resolvedNotionPageId: resolved.pageId,
        },
        null,
        2,
    );
}

export interface UpdateBrandNotionMatterbaseIdArgs {
    notionPageId: string;
    matterbaseId: string;
}

export async function executeUpdateBrandNotionMatterbaseId(
    args: UpdateBrandNotionMatterbaseIdArgs,
): Promise<string> {
    const pagePatchBody = {
        properties: {
            "Matterbase ID": {
                rich_text: [{ text: { content: args.matterbaseId } }],
            },
        },
    };

    // Fast path: page property already exists, so no schema mutation needed.
    try {
        await notionApiRequest(
            "PATCH",
            `/pages/${args.notionPageId}`,
            pagePatchBody,
        );
        return JSON.stringify({
            success: true,
            pageId: args.notionPageId,
            matterbaseId: args.matterbaseId,
            schemaPatched: false,
        });
    } catch (firstPagePatchError) {
        const firstErrorMessage = toErrorMessage(firstPagePatchError);
        let schemaErrorMessage: string | null = null;

        // Fallback: ensure the property exists, then retry the page update once.
        try {
            await notionApiRequest("PATCH", `/databases/${BRANDS_DATABASE_ID}`, {
                properties: {
                    "Matterbase ID": { rich_text: {} },
                },
            });
        } catch (schemaPatchError) {
            schemaErrorMessage = toErrorMessage(schemaPatchError);
        }

        try {
            await notionApiRequest(
                "PATCH",
                `/pages/${args.notionPageId}`,
                pagePatchBody,
            );
            return JSON.stringify({
                success: true,
                pageId: args.notionPageId,
                matterbaseId: args.matterbaseId,
                schemaPatched: true,
                schemaPatchError: schemaErrorMessage,
            });
        } catch (secondPagePatchError) {
            return JSON.stringify({
                success: false,
                code: "NOTION_MATTERBASE_ID_UPDATE_FAILED",
                error: toErrorMessage(secondPagePatchError),
                firstPagePatchError: firstErrorMessage,
                schemaPatchError: schemaErrorMessage,
                pageId: args.notionPageId,
                matterbaseId: args.matterbaseId,
            });
        }
    }
}

export async function executeCheckBrandExistsInNotion(
    args: CheckBrandExistsArgs,
): Promise<string> {
    const mcpClient = getMCPClient();
    if (!mcpClient.isConnected()) {
        await mcpClient.connect();
    }

    const result = await mcpClient.executeTool("API-post-search", {
        query: args.brandName,
        filter: {
            property: "object",
            value: "page",
        },
    });

    const response = result as {
        results?: Array<{
            id: string;
            parent?: { database_id?: string };
            properties?: {
                Name?: { title?: Array<{ text?: { content?: string } }> };
            };
        }>;
    };

    const matchingBrands =
        response.results?.filter((page) => {
            if (
                page.parent?.database_id?.replace(/-/g, "") !==
                BRANDS_DATABASE_ID.replace(/-/g, "")
            ) {
                return false;
            }
            const pageName =
                page.properties?.Name?.title?.[0]?.text?.content?.toLowerCase();
            return pageName === args.brandName.toLowerCase();
        }) || [];

    if (matchingBrands.length > 0) {
        return JSON.stringify({
            exists: true,
            message: `Brand "${args.brandName}" already exists in Notion`,
            pageId: matchingBrands[0].id,
        });
    }

    return JSON.stringify({
        exists: false,
        message: `Brand "${args.brandName}" not found in Notion`,
    });
}