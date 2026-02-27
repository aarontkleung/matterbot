import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

export interface MCPTool {
  name: string;
  description?: string;
  inputSchema: {
    type: "object";
    properties?: Record<string, unknown>;
    required?: string[];
  };
}

export class MCPClientManager {
  private client: Client | null = null;
  private transport: StdioClientTransport | null = null;
  private tools: MCPTool[] = [];
  private connected = false;

  async connect(): Promise<void> {
    if (this.connected) {
      return;
    }

    const notionApiKey = process.env.NOTION_API_KEY;
    if (!notionApiKey) {
      throw new Error("NOTION_API_KEY environment variable not set");
    }

    this.transport = new StdioClientTransport({
      command: "notion-mcp-server",
      args: [],
      env: {
        ...process.env,
        NOTION_TOKEN: notionApiKey,
      },
    });

    this.transport.onclose = () => {
      console.log("MCP transport closed");
      this.connected = false;
      this.client = null;
      this.transport = null;
      this.tools = [];
    };

    this.transport.onerror = (error) => {
      console.error("MCP transport error:", error);
      this.connected = false;
    };

    this.client = new Client({
      name: "scraping-agent",
      version: "1.0.0",
    });

    await this.client.connect(this.transport);
    this.connected = true;

    await this.discoverTools();
  }

  async reconnect(): Promise<void> {
    console.log("Reconnecting to Notion MCP server...");
    await this.disconnect();
    await this.connect();
    console.log("Reconnected to Notion MCP server");
  }

  private async discoverTools(): Promise<void> {
    if (!this.client) {
      throw new Error("MCP client not connected");
    }

    const result = await this.client.listTools();
    this.tools = result.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema as MCPTool["inputSchema"],
    }));

    console.log(`Discovered ${this.tools.length} MCP tools from Notion server`);
  }

  async executeTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    if (!this.connected || !this.client) {
      await this.connect();
    }

    try {
      const result = await this.client!.callTool({ name, arguments: args });
      return this.parseToolResult(result.content);
    } catch (error) {
      console.error("MCP tool execution failed, attempting reconnect:", error);
      await this.reconnect();

      const result = await this.client!.callTool({ name, arguments: args });
      return this.parseToolResult(result.content);
    }
  }

  private parseToolResult(content: unknown): unknown {
    if (!Array.isArray(content)) {
      return content;
    }

    const textContent = content
      .filter((block): block is { type: "text"; text: string } => block.type === "text")
      .map((block) => block.text)
      .join("\n");

    try {
      return JSON.parse(textContent);
    } catch {
      return textContent;
    }
  }

  async disconnect(): Promise<void> {
    if (this.transport) {
      await this.transport.close();
      this.transport = null;
    }
    this.client = null;
    this.connected = false;
    this.tools = [];
  }

  isConnected(): boolean {
    return this.connected;
  }

  getTools(): MCPTool[] {
    return this.tools;
  }
}

let mcpClient: MCPClientManager | null = null;

export function getMCPClient(): MCPClientManager {
  if (!mcpClient) {
    mcpClient = new MCPClientManager();
  }
  return mcpClient;
}
