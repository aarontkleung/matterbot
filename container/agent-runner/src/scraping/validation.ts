import { getCachedDistributors, getCachedCatalogLinks, getCachedImageUrls, type ParsedDistributor, type ExtractedImageUrls } from "./brands.js";

export interface ScrapeResultInput {
  contactDetails?: Record<string, string | number | null>;
  parsedDistributors?: ParsedDistributor[];
  distributorCount?: number;
  markdown?: string;
  links?: string[];
  metadata?: { ogImage?: string; [key: string]: unknown };
  extractedImageUrls?: { logoUrl?: string | null; headerImageUrl?: string | null; aboutImageUrl?: string | null };
}

export interface ValidationIssue {
  field: string;
  severity: "error" | "warning";
  message: string;
  expected?: string | number | null;
  received?: string | number | null;
}

export interface ValidateBrandDataArgs {
  scrapeResult: ScrapeResultInput;
  brandData: Record<string, unknown>;
}

interface ValidationResult {
  valid: boolean;
  errorCount: number;
  warningCount: number;
  issues: ValidationIssue[];
  summary: string;
}

function checkContactField(
  issues: ValidationIssue[],
  contactDetails: Record<string, string | number | null>,
  brandData: Record<string, unknown>,
  sourceKey: string,
  targetKey: string,
  label: string
): void {
  const expected = contactDetails[sourceKey];
  if (expected == null || expected === "") return;

  const received = brandData[targetKey];
  if (received == null || received === "") {
    issues.push({
      field: targetKey,
      severity: "error",
      message: `${label} present in contactDetails.${sourceKey} but missing from brandData.${targetKey}`,
      expected,
      received: received ?? null,
    });
  }
}

function checkEmailField(
  issues: ValidationIssue[],
  contactDetails: Record<string, string | number | null>,
  brandData: Record<string, unknown>
): void {
  const expected = contactDetails.email;
  if (expected == null || expected === "") return;

  const hasEmail = brandData.email != null && brandData.email !== "";
  const hasContactEmail = brandData.contactEmail != null && brandData.contactEmail !== "";

  if (!hasEmail && !hasContactEmail) {
    issues.push({
      field: "email",
      severity: "error",
      message:
        "Email present in contactDetails.email but missing from both brandData.email and brandData.contactEmail",
      expected,
      received: null,
    });
  }
}

interface ProposedDistributor {
  name?: string;
  street?: string;
  city?: string;
  zip?: string;
  phone?: string;
  email?: string;
  website?: string;
  [key: string]: unknown;
}

function checkDistributors(
  issues: ValidationIssue[],
  parsedDistributors: ParsedDistributor[] | undefined,
  brandData: Record<string, unknown>
): void {
  // Use cached distributors as source of truth if scrapeResult.parsedDistributors
  // is missing/empty (it may also be truncated by the LLM context)
  let distributors = parsedDistributors;
  if ((!distributors || distributors.length === 0) && brandData.architonicUrl) {
    const cached = getCachedDistributors(brandData.architonicUrl as string);
    if (cached && cached.length > 0) {
      distributors = cached;
    }
  }
  if (!distributors || distributors.length === 0) return;

  const proposed = brandData.distributors;
  const proposedArr: ProposedDistributor[] = Array.isArray(proposed) ? proposed : [];

  // Since distributors are auto-attached by save_brand_to_notion, the LLM
  // is not expected to pass them. Downgrade from error to warning.
  // Count check
  if (proposedArr.length === 0) {
    issues.push({
      field: "distributors",
      severity: "warning",
      message: `${distributors.length} distributors parsed/cached but brandData.distributors is empty (they will be auto-attached by save_brand_to_notion)`,
      expected: distributors.length,
      received: 0,
    });
    return;
  }

  if (proposedArr.length < distributors.length * 0.5) {
    issues.push({
      field: "distributors",
      severity: "warning",
      message: `Distributor count mismatch: ${distributors.length} parsed but only ${proposedArr.length} in brandData (<50%, will be auto-corrected)`,
      expected: distributors.length,
      received: proposedArr.length,
    });
  }

  // Build a lookup of proposed distributors by normalized name
  const proposedByName = new Map<string, ProposedDistributor>();
  for (const d of proposedArr) {
    if (d.name) proposedByName.set(d.name.toLowerCase().trim(), d);
  }

  // Per-distributor field checks
  const fieldKeys: { key: keyof ParsedDistributor; label: string }[] = [
    { key: "street", label: "street" },
    { key: "city", label: "city" },
    { key: "zip", label: "zip" },
    { key: "phone", label: "phone" },
    { key: "email", label: "email" },
    { key: "website", label: "website" },
  ];

  const missingNames: string[] = [];
  for (const parsed of distributors) {
    const key = parsed.name.toLowerCase().trim();
    const match = proposedByName.get(key);

    if (!match) {
      missingNames.push(parsed.name);
      continue;
    }

    for (const { key: fk, label } of fieldKeys) {
      const parsedVal = parsed[fk];
      if (parsedVal && (!match[fk] || match[fk] === "")) {
        issues.push({
          field: `distributors[${parsed.name}].${label}`,
          severity: "warning",
          message: `Distributor "${parsed.name}" has ${label} in parsed data but it is missing in brandData (will be auto-corrected)`,
          expected: parsedVal,
          received: null,
        });
      }
    }
  }

  // Report missing distributors (cap the list to avoid huge output)
  if (missingNames.length > 0) {
    const shown = missingNames.slice(0, 10);
    const extra = missingNames.length > 10 ? ` (and ${missingNames.length - 10} more)` : "";
    issues.push({
      field: "distributors",
      severity: "warning",
      message: `${missingNames.length} distributors from parsed data not found in brandData: ${shown.join(", ")}${extra} (will be auto-corrected)`,
      expected: distributors.length,
      received: proposedArr.length,
    });
  }
}

function checkHeaderImageFallback(
  issues: ValidationIssue[],
  metadata: { ogImage?: string; [key: string]: unknown } | undefined,
  brandData: Record<string, unknown>
): void {
  if (!metadata?.ogImage) return;
  if (brandData.headerImageUrl != null && brandData.headerImageUrl !== "") return;

  issues.push({
    field: "headerImageUrl",
    severity: "warning",
    message:
      "metadata.ogImage available as fallback for headerImageUrl but brandData.headerImageUrl is missing",
    expected: metadata.ogImage,
    received: null,
  });
}

function checkImageUrls(
  issues: ValidationIssue[],
  extractedImageUrls: ScrapeResultInput["extractedImageUrls"],
  brandData: Record<string, unknown>
): void {
  if (!extractedImageUrls) return;

  // Logo: error if extracted but missing/different in brandData
  if (extractedImageUrls.logoUrl) {
    const proposed = brandData.logoUrl as string | undefined;
    if (!proposed) {
      issues.push({
        field: "logoUrl",
        severity: "error",
        message: "extractedImageUrls.logoUrl available but brandData.logoUrl is missing",
        expected: extractedImageUrls.logoUrl,
        received: null,
      });
    } else if (proposed !== extractedImageUrls.logoUrl) {
      issues.push({
        field: "logoUrl",
        severity: "error",
        message: "brandData.logoUrl does not match extractedImageUrls.logoUrl — use the exact extractedImageUrls.logoUrl value",
        expected: extractedImageUrls.logoUrl,
        received: proposed,
      });
    }
  }

  // Header image: warning if extracted but missing/different
  if (extractedImageUrls.headerImageUrl) {
    const proposed = brandData.headerImageUrl as string | undefined;
    if (!proposed) {
      issues.push({
        field: "headerImageUrl",
        severity: "warning",
        message: "extractedImageUrls.headerImageUrl available but brandData.headerImageUrl is missing (will be auto-corrected)",
        expected: extractedImageUrls.headerImageUrl,
        received: null,
      });
    } else if (proposed !== extractedImageUrls.headerImageUrl) {
      issues.push({
        field: "headerImageUrl",
        severity: "warning",
        message: "brandData.headerImageUrl does not match extractedImageUrls.headerImageUrl",
        expected: extractedImageUrls.headerImageUrl,
        received: proposed,
      });
    }
  }

  // About image: warning if extracted but missing/different
  if (extractedImageUrls.aboutImageUrl) {
    const proposed = brandData.aboutImageUrl as string | undefined;
    if (!proposed) {
      issues.push({
        field: "aboutImageUrl",
        severity: "warning",
        message: "extractedImageUrls.aboutImageUrl available but brandData.aboutImageUrl is missing (will be auto-corrected)",
        expected: extractedImageUrls.aboutImageUrl,
        received: null,
      });
    } else if (proposed !== extractedImageUrls.aboutImageUrl) {
      issues.push({
        field: "aboutImageUrl",
        severity: "warning",
        message: "brandData.aboutImageUrl does not match extractedImageUrls.aboutImageUrl",
        expected: extractedImageUrls.aboutImageUrl,
        received: proposed,
      });
    }
  }
}

function checkDescriptionPresent(
  issues: ValidationIssue[],
  markdown: string | undefined,
  brandData: Record<string, unknown>
): void {
  if (!markdown) return;

  const hasAboutHeading = /#{1,3}\s*(about|philosophy|company|who we are)/i.test(markdown);
  if (!hasAboutHeading) return;

  if (!brandData.description || brandData.description === "") {
    issues.push({
      field: "description",
      severity: "warning",
      message:
        "Markdown contains about/philosophy heading but brandData.description is missing",
    });
  }
}

function checkCatalogsPresent(
  issues: ValidationIssue[],
  markdown: string | undefined,
  brandData: Record<string, unknown>
): void {
  if (!markdown) return;

  const catalogMentions = (markdown.match(/catalog/gi) || []).length;
  if (catalogMentions < 2) return;

  const catalogs = brandData.catalogs;
  const hasCatalogs = Array.isArray(catalogs) && catalogs.length > 0;
  if (!hasCatalogs) {
    issues.push({
      field: "catalogs",
      severity: "warning",
      message: `Markdown mentions "catalog" ${catalogMentions} times but brandData.catalogs is empty or missing`,
    });
    return;
  }

  // Check if catalogs exist but none have downloadUrl
  const catalogsWithDownload = (catalogs as Array<{ downloadUrl?: string }>).filter(c => c.downloadUrl);
  if (catalogsWithDownload.length === 0) {
    // Check if cached catalog links exist — if so, this is a stronger signal
    const cachedLinks = brandData.architonicUrl
      ? getCachedCatalogLinks(brandData.architonicUrl as string)
      : undefined;
    if (cachedLinks && cachedLinks.length > 0) {
      issues.push({
        field: "catalogs",
        severity: "warning",
        message: `${catalogs.length} catalog(s) present but none have downloadUrl. ${cachedLinks.length} catalog download link(s) were extracted from the page — they will be auto-attached by save_brand_to_notion`,
        expected: cachedLinks.length,
        received: 0,
      });
    } else {
      issues.push({
        field: "catalogs",
        severity: "warning",
        message: `${catalogs.length} catalog(s) present but none have downloadUrl — download links may have been dropped`,
      });
    }
  }
}

export function executeValidateBrandData(args: ValidateBrandDataArgs): string {
  const { scrapeResult, brandData } = args;
  const issues: ValidationIssue[] = [];

  const contactDetails = scrapeResult.contactDetails || {};

  // Contact detail checks (errors — deterministic extraction)
  checkContactField(issues, contactDetails, brandData, "phone", "phone", "Phone");
  checkEmailField(issues, contactDetails, brandData);
  checkContactField(issues, contactDetails, brandData, "street", "street", "Street");
  checkContactField(issues, contactDetails, brandData, "city", "city", "City");
  checkContactField(issues, contactDetails, brandData, "zip", "postalCode", "Postal code");
  checkContactField(issues, contactDetails, brandData, "lat", "latitude", "Latitude");
  checkContactField(issues, contactDetails, brandData, "lng", "longitude", "Longitude");
  checkContactField(issues, contactDetails, brandData, "website", "website", "Website");
  checkContactField(issues, contactDetails, brandData, "facebook", "facebook", "Facebook");
  checkContactField(issues, contactDetails, brandData, "instagram", "instagram", "Instagram");
  checkContactField(issues, contactDetails, brandData, "pinterest", "pinterest", "Pinterest");

  // Header image fallback (warning)
  checkHeaderImageFallback(issues, scrapeResult.metadata, brandData);

  // Image URL validation (deterministic extraction vs proposed)
  checkImageUrls(issues, scrapeResult.extractedImageUrls, brandData);

  // Per-distributor validation (count, names, fields)
  checkDistributors(issues, scrapeResult.parsedDistributors, brandData);

  // Markdown-derived content (warnings)
  checkDescriptionPresent(issues, scrapeResult.markdown, brandData);
  checkCatalogsPresent(issues, scrapeResult.markdown, brandData);

  const errorCount = issues.filter((i) => i.severity === "error").length;
  const warningCount = issues.filter((i) => i.severity === "warning").length;
  const valid = errorCount === 0;

  let summary: string;
  if (issues.length === 0) {
    summary = "All checks passed. No dropped fields detected.";
  } else {
    const parts: string[] = [];
    if (errorCount > 0) parts.push(`${errorCount} error(s) — fields that MUST be fixed`);
    if (warningCount > 0) parts.push(`${warningCount} warning(s) — review recommended`);
    summary = parts.join("; ");
  }

  const result: ValidationResult = {
    valid,
    errorCount,
    warningCount,
    issues,
    summary,
  };

  return JSON.stringify(result);
}
