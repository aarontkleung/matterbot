# Matterbase MCP Server

MCP (Model Context Protocol) server that wraps the Matterbase backend API, enabling AI agents to interact with Matterbase data (brands, products).

## Purpose

Provides a standardized MCP interface for:
- Brand management (list, search, create, update)
- Product management (list, search, get, create, update)

## Architecture

```
AI Agent → MCP Client → Matterbase MCP Server (stdio) → Matterbase Backend API → AWS RDS
```

## Available Tools

### Brand Tools
| Tool | Description |
|------|-------------|
| `matterbase_list_brands` | List all active brands |
| `matterbase_search_brands` | Search brands by name |
| `matterbase_create_brand` | Create a new brand |
| `matterbase_update_brand` | Update existing brand |

### Product Tools
| Tool | Description |
|------|-------------|
| `matterbase_list_products` | List products with pagination |
| `matterbase_search_products` | Search products |
| `matterbase_get_product` | Get product details by ID |
| `matterbase_create_product` | Create a new product |
| `matterbase_update_product` | Update existing product |

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `MATTERBASE_API_URL` | Backend API base URL | Yes |
| `MATTERBASE_API_KEY` | API key for authentication | Yes |

## Development

```bash
# Install dependencies
pnpm install

# Run in development mode
pnpm dev

# Build for production
pnpm build

# Type check
pnpm typecheck
```

## Usage with Scraping Agent

The scraping-agent spawns this MCP server as a subprocess via `StdioClientTransport`. The server communicates over stdin/stdout using the MCP protocol.

## API Endpoints Wrapped

### Brands
- `GET /api/v1/brand/list` → `matterbase_list_brands`
- `GET /api/v1/admin/product/brand` → `matterbase_search_brands`
- `POST /api/v1/admin/product/brand/create` → `matterbase_create_brand`
- `PUT /api/v1/admin/product/brand/update` → `matterbase_update_brand`

### Products
- `GET /api/v1/product/list` → `matterbase_list_products`
- `GET /api/v1/product/search` → `matterbase_search_products`
- `GET /api/v1/product/single/:id` → `matterbase_get_product`
- `POST /api/v1/admin/product/product-parent/create` → `matterbase_create_product`
- `PUT /api/v1/admin/product/product-parent/update` → `matterbase_update_product`
