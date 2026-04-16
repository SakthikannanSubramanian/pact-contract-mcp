#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
  isInitializeRequest,
} from "@modelcontextprotocol/sdk/types.js";
import express from "express";

import { analyzeRepository } from "./tools/analyzeRepository.js";
import { generateContractStructure } from "./tools/generateContractStructure.js";
import { scaffoldPactTests } from "./tools/scaffoldPactTests.js";
import { setupLocalBroker } from "./tools/setupLocalBroker.js";
import { configRemoteBroker } from "./tools/configRemoteBroker.js";
import { AnalysisResult, ContractStructure } from "./types.js";

// Define all available tools
const TOOLS: Tool[] = [
  {
    name: "analyze_repository",
    description:
      "Scan the current repository to identify the implementation language (Java/Kotlin), the framework (Spring Boot/Lambda/Cloud Functions), and all external service dependencies (via RestTemplate, WebClient, Feign, or Cloud SDKs).",
    inputSchema: {
      type: "object",
      properties: {
        repositoryPath: {
          type: "string",
          description: "The absolute path to the repository to analyze",
        },
      },
      required: ["repositoryPath"],
    },
  },
  {
    name: "generate_contract_structure",
    description:
      "Create a classification list of 'Internal' and 'External' services. Group them into 'Consumer Contracts' and 'Provider Contracts' based on the analyzed dependencies.",
    inputSchema: {
      type: "object",
      properties: {
        repositoryPath: {
          type: "string",
          description: "The absolute path to the repository",
        },
        analysisResult: {
          type: "object",
          description:
            "The result from analyze_repository tool (optional, will re-analyze if not provided)",
        },
      },
      required: ["repositoryPath"],
    },
  },
  {
    name: "scaffold_pact_tests",
    description:
      "Generate Pact test scaffolding including test folders, consumer test classes, mock wrappers for Lambda/Cloud Functions, build file updates with Pact dependencies, and a custom Gradle task 'runContractTests'.",
    inputSchema: {
      type: "object",
      properties: {
        repositoryPath: {
          type: "string",
          description: "The absolute path to the repository",
        },
        contractStructure: {
          type: "object",
          description:
            "The contract structure from generate_contract_structure tool (optional)",
        },
      },
      required: ["repositoryPath"],
    },
  },
  {
    name: "setup_local_broker",
    description:
      "Generate a docker-compose.yml file to spin up a local Pact Broker with a PostgreSQL database.",
    inputSchema: {
      type: "object",
      properties: {
        repositoryPath: {
          type: "string",
          description: "The absolute path where docker-compose.yml should be created",
        },
        brokerPort: {
          type: "number",
          description: "The port for the Pact Broker (default: 9292)",
          default: 9292,
        },
        postgresPort: {
          type: "number",
          description: "The port for PostgreSQL (default: 5432)",
          default: 5432,
        },
      },
      required: ["repositoryPath"],
    },
  },
  {
    name: "config_remote_broker",
    description:
      "Create a pact.properties file or update build.gradle with placeholders for pact.broker.url and pact.broker.token for remote environments.",
    inputSchema: {
      type: "object",
      properties: {
        repositoryPath: {
          type: "string",
          description: "The absolute path to the repository",
        },
        configType: {
          type: "string",
          enum: ["properties", "gradle", "both"],
          description: "Type of configuration to create (default: both)",
          default: "both",
        },
        brokerUrl: {
          type: "string",
          description: "Placeholder URL for the remote Pact Broker",
          default: "https://your-pact-broker.example.com",
        },
      },
      required: ["repositoryPath"],
    },
  },
];

// Create the MCP server (used for stdio mode)
const server = new Server(
  {
    name: "pact-contract-mcp",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Store analysis results for cross-tool usage
let cachedAnalysis: AnalysisResult | null = null;

// Register tool handlers on any Server instance
function registerHandlers(srv: Server) {
  // Handle tool listing
  srv.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools: TOOLS };
  });

  // Handle tool execution
  srv.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case "analyze_repository": {
        const repositoryPath = args?.repositoryPath as string;
        if (!repositoryPath) {
          throw new Error("repositoryPath is required");
        }
        const result = await analyzeRepository(repositoryPath);
        cachedAnalysis = result;
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case "generate_contract_structure": {
        const repositoryPath = args?.repositoryPath as string;
        if (!repositoryPath) {
          throw new Error("repositoryPath is required");
        }
        let analysis = args?.analysisResult as AnalysisResult | undefined;
        if (!analysis) {
          analysis = cachedAnalysis || (await analyzeRepository(repositoryPath));
          cachedAnalysis = analysis;
        }
        const result = await generateContractStructure(repositoryPath, analysis);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case "scaffold_pact_tests": {
        const repositoryPath = args?.repositoryPath as string;
        if (!repositoryPath) {
          throw new Error("repositoryPath is required");
        }
        let analysis = cachedAnalysis;
        if (!analysis) {
          analysis = await analyzeRepository(repositoryPath);
          cachedAnalysis = analysis;
        }
        const contractStructure =
          (args?.contractStructure as ContractStructure | undefined) ||
          (await generateContractStructure(repositoryPath, analysis));
        const result = await scaffoldPactTests(
          repositoryPath,
          analysis,
          contractStructure
        );
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case "setup_local_broker": {
        const repositoryPath = args?.repositoryPath as string;
        if (!repositoryPath) {
          throw new Error("repositoryPath is required");
        }
        const brokerPort = (args?.brokerPort as number) || 9292;
        const postgresPort = (args?.postgresPort as number) || 5432;
        const result = await setupLocalBroker(
          repositoryPath,
          brokerPort,
          postgresPort
        );
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case "config_remote_broker": {
        const repositoryPath = args?.repositoryPath as string;
        if (!repositoryPath) {
          throw new Error("repositoryPath is required");
        }
        const configType = (args?.configType as string) || "both";
        const brokerUrl =
          (args?.brokerUrl as string) || "https://your-pact-broker.example.com";
        
        let analysis = cachedAnalysis;
        if (!analysis) {
          analysis = await analyzeRepository(repositoryPath);
          cachedAnalysis = analysis;
        }
        
        const result = await configRemoteBroker(
          repositoryPath,
          configType,
          brokerUrl,
          analysis
        );
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      content: [
        {
          type: "text",
          text: `Error executing ${name}: ${errorMessage}`,
        },
      ],
      isError: true,
    };
  }
  });
}

// Determine transport mode from CLI args or environment variable
// Usage: node index.js --sse [--port 3001]       (legacy SSE transport)
//        node index.js --http [--port 3001]      (Streamable HTTP transport)
//   or:  TRANSPORT=sse|http PORT=3001 node index.js
const args = process.argv.slice(2);
const transportEnv = process.env.TRANSPORT?.toLowerCase();
const isSSE = args.includes("--sse") || transportEnv === "sse";
const isHTTP = args.includes("--http") || transportEnv === "http";

function getPort(): number {
  const portArgIndex = args.indexOf("--port");
  if (portArgIndex !== -1 && args[portArgIndex + 1]) {
    return parseInt(args[portArgIndex + 1], 10);
  }
  return parseInt(process.env.PORT || "3001", 10);
}

// Start the server
async function main() {
  if (isHTTP) {
    // ── Streamable HTTP transport ──────────────────────────────────
    const port = getPort();
    const app = express();
    app.use(express.json());

    // Map of session ID → StreamableHTTPServerTransport
    const transports = new Map<string, StreamableHTTPServerTransport>();

    // POST /mcp — handles JSON-RPC requests (including initialization)
    app.post("/mcp", async (req, res) => {
      const sessionId = req.headers["mcp-session-id"] as string | undefined;

      try {
        // Reuse existing transport for known sessions
        if (sessionId && transports.has(sessionId)) {
          const transport = transports.get(sessionId)!;
          await transport.handleRequest(req, res, req.body);
          return;
        }

        // New initialization request — no session ID yet
        if (!sessionId && isInitializeRequest(req.body)) {
          const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID(),
            onsessioninitialized: (sid) => {
              transports.set(sid, transport);
              console.error(`Streamable HTTP session initialized: ${sid}`);
            },
          });

          transport.onclose = () => {
            const sid = transport.sessionId;
            if (sid) {
              transports.delete(sid);
              console.error(`Streamable HTTP session closed: ${sid}`);
            }
          };

          const httpServer = new Server(
            { name: "pact-contract-mcp", version: "1.0.0" },
            { capabilities: { tools: {} } }
          );
          registerHandlers(httpServer);
          await httpServer.connect(transport);
          await transport.handleRequest(req, res, req.body);
          return;
        }

        // Bad request
        res.status(400).json({
          jsonrpc: "2.0",
          error: { code: -32000, message: "Bad Request: No valid session ID provided" },
          id: null,
        });
      } catch (error) {
        console.error("Error handling MCP request:", error);
        if (!res.headersSent) {
          res.status(500).json({
            jsonrpc: "2.0",
            error: { code: -32603, message: "Internal server error" },
            id: null,
          });
        }
      }
    });

    // GET /mcp — SSE stream for server-initiated notifications
    app.get("/mcp", async (req, res) => {
      const sessionId = req.headers["mcp-session-id"] as string | undefined;
      if (!sessionId || !transports.has(sessionId)) {
        res.status(400).send("Invalid or missing session ID");
        return;
      }
      await transports.get(sessionId)!.handleRequest(req, res);
    });

    // DELETE /mcp — session termination
    app.delete("/mcp", async (req, res) => {
      const sessionId = req.headers["mcp-session-id"] as string | undefined;
      if (!sessionId || !transports.has(sessionId)) {
        res.status(400).send("Invalid or missing session ID");
        return;
      }
      await transports.get(sessionId)!.handleRequest(req, res);
    });

    // Health check
    app.get("/health", (_req, res) => {
      res.json({ status: "ok", transport: "streamable-http", sessions: transports.size });
    });

    app.listen(port, "0.0.0.0", () => {
      console.error(`Pact Contract MCP Server (Streamable HTTP) on http://0.0.0.0:${port}`);
      console.error(`  MCP endpoint:  POST/GET/DELETE http://localhost:${port}/mcp`);
      console.error(`  Health check:  GET             http://localhost:${port}/health`);
    });

    // Graceful shutdown
    process.on("SIGINT", async () => {
      console.error("Shutting down...");
      for (const [sid, t] of transports) {
        try { await t.close(); } catch { /* ignore */ }
        transports.delete(sid);
      }
      process.exit(0);
    });

  } else if (isSSE) {
    // ── Legacy SSE transport ──────────────────────────────────────
    const port = getPort();
    const app = express();
    app.use(express.json());

    // Map of session ID → SSEServerTransport
    const transports = new Map<string, SSEServerTransport>();

    // SSE endpoint — clients connect here with GET to receive events
    app.get("/sse", async (req, res) => {
      console.error(`New SSE connection from ${req.ip}`);

      const transport = new SSEServerTransport("/messages", res);
      transports.set(transport.sessionId, transport);

      transport.onclose = () => {
        console.error(`SSE session ${transport.sessionId} closed`);
        transports.delete(transport.sessionId);
      };

      // Each SSE connection gets its own Server instance
      const sseServer = new Server(
        { name: "pact-contract-mcp", version: "1.0.0" },
        { capabilities: { tools: {} } }
      );
      registerHandlers(sseServer);
      await sseServer.connect(transport);
    });

    // Message endpoint — clients POST JSON-RPC messages here
    app.post("/messages", async (req, res) => {
      const sessionId = req.query.sessionId as string;
      const transport = transports.get(sessionId);

      if (!transport) {
        res.status(400).json({ error: "Invalid or missing sessionId" });
        return;
      }

      await transport.handlePostMessage(req, res);
    });

    // Health check
    app.get("/health", (_req, res) => {
      res.json({ status: "ok", transport: "sse", sessions: transports.size });
    });

    app.listen(port, "0.0.0.0", () => {
      console.error(`Pact Contract MCP Server running on http://0.0.0.0:${port}`);
      console.error(`  SSE endpoint:     GET  http://localhost:${port}/sse`);
      console.error(`  Message endpoint: POST http://localhost:${port}/messages`);
      console.error(`  Health check:     GET  http://localhost:${port}/health`);
    });
  } else {
    // ── Default: stdio transport ──────────────────────────────────
    const transport = new StdioServerTransport();
    registerHandlers(server);
    await server.connect(transport);
    console.error("Pact Contract MCP Server running on stdio");
  }
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
