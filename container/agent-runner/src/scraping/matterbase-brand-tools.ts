import { getMatterbaseMCPClient } from "./integrations/matterbase-mcp.js";
import {
    executeUpdateBrandNotionMatterbaseId,
    getSavedMatterbaseCreatePayload,
} from "./notion-tools.js";

export interface CreateMatterbaseBrandFromNotionArgs {
    notionPageId: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

function asString(value: unknown): string | undefined {
    if (typeof value !== "string") return undefined;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
}

function asIdString(value: unknown): string | undefined {
    if (typeof value === "number" && Number.isFinite(value)) {
        return String(value);
    }
    return asString(value);
}

function normalizeBrandName(value: string): string {
    return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function looseNormalizeBrandName(value: string): string {
    return normalizeBrandName(value)
        .replace(/[^a-z0-9]+/g, " ")
        .trim();
}

function normalizeResult(value: unknown): Record<string, unknown> | null {
    if (isRecord(value)) return value;

    if (typeof value === "string") {
        try {
            const parsed = JSON.parse(value) as unknown;
            return isRecord(parsed) ? parsed : null;
        } catch {
            return null;
        }
    }

    return null;
}

function unwrapDataEnvelope(value: unknown, maxDepth = 6): unknown {
    let current = value;
    for (let i = 0; i < maxDepth; i++) {
        if (
            !isRecord(current) ||
            !Object.prototype.hasOwnProperty.call(current, "data")
        ) {
            break;
        }
        const nested = current.data;
        if (nested === undefined || nested === null) {
            break;
        }
        current = nested;
    }
    return current;
}

function extractBrandId(value: unknown): string | null {
    const unwrapped = unwrapDataEnvelope(value);
    if (!isRecord(unwrapped)) return null;

    return (
        asIdString(unwrapped.id) ??
        asIdString(unwrapped.matterbaseId) ??
        asIdString(unwrapped.brandId) ??
        null
    );
}

function extractBrandIdFromSearchResult(
    searchResult: unknown,
    expectedBrandName: string,
): string | null {
    const normalized = normalizeResult(searchResult);
    if (!normalized || !Array.isArray(normalized.brands)) {
        return null;
    }

    const strictExpected = normalizeBrandName(expectedBrandName);
    const looseExpected = looseNormalizeBrandName(expectedBrandName);
    let looseMatchId: string | undefined;

    for (const brand of normalized.brands) {
        if (!isRecord(brand)) continue;

        const id = asIdString(brand.id);
        if (!id) continue;

        const name = asString(brand.name) ?? asString(brand.brandName);
        if (!name) continue;

        if (normalizeBrandName(name) === strictExpected) {
            return id;
        }

        if (!looseMatchId && looseNormalizeBrandName(name) === looseExpected) {
            looseMatchId = id;
        }
    }

    return looseMatchId ?? null;
}

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function recoverMatterbaseIdFromSearch(
    expectedBrandName: string,
): Promise<string | null> {
    const client = getMatterbaseMCPClient();
    const maxAttempts = 3;
    const retryDelayMs = 400;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            const searchResult = await client.executeTool(
                "matterbase_search_brands",
                {
                    query: expectedBrandName,
                },
            );
            const recovered = extractBrandIdFromSearchResult(
                searchResult,
                expectedBrandName,
            );
            if (recovered) {
                return recovered;
            }
        } catch {
            // Continue to next retry attempt.
        }

        if (attempt < maxAttempts) {
            await delay(retryDelayMs * attempt);
        }
    }

    return null;
}

function extractCountries(
    result: unknown,
): Array<{ id: string; value: string }> {
    const normalized = normalizeResult(result);
    if (!normalized) return [];

    const rawCountries = normalized.countries;
    if (!Array.isArray(rawCountries)) return [];

    const countries: Array<{ id: string; value: string }> = [];
    for (const item of rawCountries) {
        if (!isRecord(item)) continue;
        const id = asString(item.id);
        const value = asString(item.value);
        if (!id || !value) continue;
        countries.push({ id, value });
    }
    return countries;
}

async function resolveCountryName(
    countryCode: string | undefined,
    existingCountryName: string | undefined,
): Promise<string | undefined> {
    if (existingCountryName) return existingCountryName;
    if (!countryCode) return undefined;

    const client = getMatterbaseMCPClient();
    const countriesResult = await client.executeTool(
        "matterbase_list_countries",
        {},
    );
    const countries = extractCountries(countriesResult);
    const matched = countries.find(
        (country) => country.id.toLowerCase() === countryCode.toLowerCase(),
    );
    return matched?.value;
}

export async function executeMatterbaseCreateBrandFromNotion(
    args: CreateMatterbaseBrandFromNotionArgs,
): Promise<string> {
    try {
        const payload = getSavedMatterbaseCreatePayload(args.notionPageId);
        if (!payload) {
            return JSON.stringify({
                success: false,
                code: "MISSING_SAVED_NOTION_SOURCE",
                error:
                    "No saved save_brand_to_notion payload found for this notionPageId. Re-run save_brand_to_notion, then call matterbase_create_brand with that notionPageId.",
                notionPageId: args.notionPageId,
            });
        }

        const countryName = await resolveCountryName(
            payload.countryCode,
            payload.countryName,
        );
        const missingFields: string[] = [];
        if (!payload.name) missingFields.push("name");
        if (!payload.companyName) missingFields.push("companyName");
        if (!payload.productType.length) missingFields.push("productType");
        if (!payload.countryCode) missingFields.push("countryCode");
        if (!countryName) missingFields.push("countryName");
        if (!payload.website) missingFields.push("website");
        if (!payload.contactEmail) missingFields.push("contactEmail");

        if (missingFields.length > 0) {
            return JSON.stringify({
                success: false,
                code: "INCOMPLETE_SAVED_NOTION_SOURCE",
                error:
                    "Saved Notion payload is missing required fields for matterbase_create_brand. Re-run save_brand_to_notion with the required enrichment fields.",
                notionPageId: args.notionPageId,
                missingFields,
                savedPayload: payload,
            });
        }

        const createArgs: Record<string, unknown> = {
            name: payload.name,
            companyName: payload.companyName,
            productType: payload.productType,
            countryCode: payload.countryCode,
            countryName,
            website: payload.website,
            contactName: payload.contactName || "-",
            contactJobTitle: payload.contactJobTitle || "-",
            contactEmail: payload.contactEmail,
            excludedCountries: payload.excludedCountries,
            isDisabled: payload.isDisabled,
        };

        if (payload.logoUrl) {
            createArgs.logoUrl = payload.logoUrl;
        }

        const client = getMatterbaseMCPClient();
        const createResult = await client.executeTool(
            "matterbase_create_brand",
            createArgs,
        );
        const normalizedCreateResult = normalizeResult(createResult);

        if (!normalizedCreateResult) {
            return JSON.stringify({
                success: false,
                code: "INVALID_MATTERBASE_RESPONSE",
                error: "Matterbase create returned an unreadable response.",
                notionPageId: args.notionPageId,
                rawResult: createResult,
            });
        }

        // Extract the real Matterbase database ID from the response so the LLM
        // doesn't have to guess which nested field is the correct ID.
        let matterbaseId =
            extractBrandId(normalizedCreateResult.brand) ??
            extractBrandId(normalizedCreateResult);
        let matterbaseIdSource: "create_response" | "search_fallback" | null =
            matterbaseId ? "create_response" : null;

        const createSucceeded = normalizedCreateResult.success === true;
        let notionMatterbaseIdUpdate: Record<string, unknown> = {
            attempted: false,
            success: false,
        };

        if (createSucceeded && !matterbaseId) {
            const recoveredMatterbaseId = await recoverMatterbaseIdFromSearch(
                payload.name,
            );
            if (recoveredMatterbaseId) {
                matterbaseId = recoveredMatterbaseId;
                matterbaseIdSource = "search_fallback";
            }
        }

        if (createSucceeded && matterbaseId) {
            try {
                const updateResultRaw = await executeUpdateBrandNotionMatterbaseId({
                    notionPageId: args.notionPageId,
                    matterbaseId,
                });
                const normalizedUpdateResult = normalizeResult(updateResultRaw);
                const updateSucceeded = normalizedUpdateResult?.success === true;

                notionMatterbaseIdUpdate = updateSucceeded
                    ? {
                        attempted: true,
                        success: true,
                        notionPageId: args.notionPageId,
                        matterbaseId,
                    }
                    : {
                        attempted: true,
                        success: false,
                        error:
                            normalizedUpdateResult?.error ??
                            "Notion update returned an unreadable response.",
                        notionPageId: args.notionPageId,
                        matterbaseId,
                        rawResult: normalizedUpdateResult ?? updateResultRaw,
                    };
            } catch (error) {
                notionMatterbaseIdUpdate = {
                    attempted: true,
                    success: false,
                    error:
                        error instanceof Error
                            ? error.message
                            : "Unknown Notion update error",
                    notionPageId: args.notionPageId,
                    matterbaseId,
                };
            }
        }

        const linkSucceeded = notionMatterbaseIdUpdate.success === true;
        const canMarkIndexScraped =
            createSucceeded && Boolean(matterbaseId) && linkSucceeded;
        const overallSuccess = createSucceeded
            ? linkSucceeded
            : normalizedCreateResult.success === true;
        const overallCode =
            createSucceeded && !matterbaseId
                ? "MISSING_MATTERBASE_ID_IN_CREATE_RESPONSE"
                : createSucceeded && !linkSucceeded
                    ? "NOTION_MATTERBASE_ID_UPDATE_FAILED"
                    : normalizedCreateResult.code;

        return JSON.stringify({
            ...normalizedCreateResult,
            success: overallSuccess,
            code: overallCode,
            matterbaseId,
            matterbaseIdSource,
            notionMatterbaseIdUpdate,
            workflowChecklist: {
                createSucceeded,
                matterbaseIdResolved: Boolean(matterbaseId),
                notionMatterbaseIdLinked: linkSucceeded,
                canMarkIndexScraped,
            },
            enforcedSource: {
                notionPageId: args.notionPageId,
                scrapeSessionId: payload.scrapeSessionId,
                savedAt: payload.savedAt,
                usedLogoUrl: payload.logoUrl ?? null,
                mode: "save_brand_to_notion_payload",
            },
            instructions:
                createSucceeded && matterbaseId && linkSucceeded
                    ? `Notion "Matterbase ID" was auto-updated to "${matterbaseId}".`
                    : createSucceeded && matterbaseId
                        ? `Brand created with matterbaseId "${matterbaseId}", but auto-update of Notion failed. Retry update_brand_notion_matterbase_id with notionPageId "${args.notionPageId}" and this matterbaseId.`
                        : `Brand appears created, but matterbaseId could not be resolved. Do NOT mark index status as "scraped". Re-run matterbase_search_brands for "${payload.name}", then call update_brand_notion_matterbase_id once you have the ID.`,
        });
    } catch (error) {
        return JSON.stringify({
            success: false,
            code: "MATTERBASE_CREATE_BRAND_FAILED",
            error: error instanceof Error ? error.message : "Unknown error",
            notionPageId: args.notionPageId,
        });
    }
}
