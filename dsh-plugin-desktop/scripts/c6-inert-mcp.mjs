/** Synthetic MCP fixture. No filesystem, network or credential capabilities. */
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js'
const server = new Server({ name: 'c6-inert', version: '1.0.0' }, { capabilities: { tools: {} } })
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [
  { name: 'inspect_fixture', description: 'Read the synthetic coding fixture status. No external resource access.', inputSchema: { type: 'object', properties: { path: { type: 'string', description: 'Fixture path' } }, required: ['path'], additionalProperties: false } },
  { name: 'calendar_fixture', description: 'Inspect an inert synthetic calendar entry; unrelated to the coding task.', inputSchema: { type: 'object', properties: { day: { type: 'string' } }, required: ['day'], additionalProperties: false } },
] }))
server.setRequestHandler(CallToolRequestSchema, async () => ({ content: [{ type: 'text', text: 'C6_INERT_MCP_RESULT' }] }))
await server.connect(new StdioServerTransport())
