/**
 * Lightweight Notion REST API client for operations the MCP doesn't support
 * (e.g. POST /databases for creating inline child databases).
 */

const NOTION_VERSION = "2022-06-28";

export async function notionApiRequest(
  method: string,
  path: string,
  body?: unknown
): Promise<unknown> {
  const apiKey = process.env.NOTION_API_KEY;
  if (!apiKey) {
    throw new Error("NOTION_API_KEY environment variable is not set");
  }

  const res = await fetch(`https://api.notion.com/v1${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await res.json();
  if (!res.ok) {
    const msg = (data as { message?: string }).message || res.statusText;
    throw new Error(`Notion API ${method} ${path}: ${msg}`);
  }

  return data;
}
