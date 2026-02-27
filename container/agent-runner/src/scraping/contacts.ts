import { getHunterClient } from "./integrations/hunter.js";

export interface SearchDomainContactsArgs {
  domain: string;
  brandName?: string;
  limit?: number;
}

const DEFAULT_HUNTER_CONTACT_LIMIT = 50;

function extractDomain(input: string): string {
  try {
    const url = input.startsWith("http") ? input : `https://${input}`;
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return input.replace(/^www\./, "");
  }
}

export async function executeSearchDomainContacts(
  args: SearchDomainContactsArgs
): Promise<string> {
  const client = getHunterClient();

  if (!client.isConfigured()) {
    return JSON.stringify({
      success: false,
      error:
        "Hunter.io is not configured. Set the HUNTER_API_KEY environment variable to enable contact discovery.",
    });
  }

  const domain = extractDomain(args.domain);
  const label = args.brandName ? `${args.brandName} (${domain})` : domain;

  console.log(`[contacts] Searching contacts for ${label}`);

  try {
    const result = await client.domainSearch(domain, {
      limit: args.limit || DEFAULT_HUNTER_CONTACT_LIMIT,
    });

    if (!result) {
      return JSON.stringify({
        success: false,
        error: `No results returned for domain "${domain}"`,
      });
    }

    const contacts = result.emails.map((e) => ({
      email: e.email,
      firstName: e.firstName,
      lastName: e.lastName,
      position: e.position,
      confidence: e.confidence,
      type: e.type,
      linkedin: e.linkedin || null,
      phone: e.phone_number || null,
      verified: e.verified ?? null,
      verificationStatus: e.verification_status || null,
    }));

    return JSON.stringify({
      success: true,
      domain: result.domain,
      organization: result.organization,
      webmailProvider: result.webmailProvider,
      pattern: result.pattern || null,
      contactCount: contacts.length,
      contacts,
    });
  } catch (error) {
    return JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
