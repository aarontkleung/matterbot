import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

function getMatterbaseMcpPath(): string {
  return "/app/matterbase-mcp/dist/index.js";
}

export class MatterbaseMCPClientManager {
  private client: Client | null = null;
  private transport: StdioClientTransport | null = null;
  private connected = false;

  async connect(): Promise<void> {
    if (this.connected) {
      return;
    }

    const apiUrl = process.env.MATTERBASE_API_URL;
    const apiKey = process.env.MATTERBASE_API_KEY;
    if (!apiUrl || !apiKey) {
      throw new Error("MATTERBASE_API_URL and MATTERBASE_API_KEY are required");
    }

    this.transport = new StdioClientTransport({
      command: "node",
      args: [getMatterbaseMcpPath()],
      env: {
        ...process.env,
        MATTERBASE_API_URL: apiUrl,
        MATTERBASE_API_KEY: apiKey,
      },
    });

    this.transport.onclose = () => {
      this.connected = false;
      this.client = null;
      this.transport = null;
    };

    this.transport.onerror = () => {
      this.connected = false;
    };

    this.client = new Client({
      name: "scraping-agent",
      version: "1.0.0",
    });

    await this.client.connect(this.transport);
    this.connected = true;
  }

  async reconnect(): Promise<void> {
    await this.disconnect();
    await this.connect();
  }

  async executeTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    if (!this.connected || !this.client) {
      await this.connect();
    }

    try {
      const result = await this.client!.callTool({ name, arguments: args });
      return this.parseToolResult(result.content);
    } catch {
      await this.reconnect();
      const result = await this.client!.callTool({ name, arguments: args });
      return this.parseToolResult(result.content);
    }
  }

  private parseToolResult(content: unknown): unknown {
    if (!Array.isArray(content)) {
      return content;
    }

    const text = content
      .filter((block): block is { type: "text"; text: string } => block.type === "text")
      .map((block) => block.text)
      .join("\n");

    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }

  async disconnect(): Promise<void> {
    if (this.transport) {
      await this.transport.close();
      this.transport = null;
    }
    this.client = null;
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected;
  }
}

let matterbaseMcpClient: MatterbaseMCPClientManager | null = null;

export function getMatterbaseMCPClient(): MatterbaseMCPClientManager {
  if (!matterbaseMcpClient) {
    matterbaseMcpClient = new MatterbaseMCPClientManager();
  }
  return matterbaseMcpClient;
}
