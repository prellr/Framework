/**
 * MCP server for this system (design §8.1) — agent access to the warehouse & screening
 * engine over JSON-RPC/HTTP, mounted at POST /mcp.
 *
 * Every tool maps 1:1 onto an existing tRPC procedure via a server-side caller, so there is
 * ONE implementation and ONE authorization path (Framework's RBAC). Because no procedure maps
 * to a Jester mutate/trade call, MCP inherits the analysis-only guarantee for free. Auth reuses
 * the same X-API-Key + AGENT_API_ROLE (read-only by default) as the rest of the app.
 *
 * This is a separate system from the `jester-trading` skill — it never proxies for trading.
 */

import { Hono } from "hono";
import { timingSafeEqual } from "crypto";
import { getSetting } from "../services/config.ts";
import { appRouter } from "../trpc/router.ts";

const PROTOCOL_VERSION = "2024-11-05";

type Caller = ReturnType<typeof appRouter.createCaller>;

interface McpTool {
  name: string;
  description: string;
  inputSchema: object;
  role: "viewer" | "operator";
  /**
   * Run this tool's caller at operator scope even for a viewer-role agent. ONLY for the
   * knowledge base: it's non-destructive institutional memory (writes snapshot a revision, nothing
   * is deleted) that agents are explicitly meant to write back to. This never applies to sweeps,
   * trading, or any fund-touching path — those stay gated on the agent's real role.
   */
  elevate?: boolean;
  run: (args: any, caller: Caller) => Promise<unknown>;
}

const obj = (props: object, required: string[] = []) => ({
  type: "object",
  properties: props,
  required,
  additionalProperties: false,
});

const TOOLS: McpTool[] = [
  {
    name: "analysis_search_strategies",
    description: "List mirrored Jester strategies (id, name, tier, category). Optionally filter by tier.",
    inputSchema: obj({ tier: { type: "string", description: "BASIC | STANDARD | PREMIUM" } }),
    role: "viewer",
    run: (a, c) => c.catalog.list(a?.tier ? { tier: a.tier } : undefined),
  },
  {
    name: "analysis_query_results",
    description:
      "Query the shared backtest warehouse (deduplicated full-window results). Filter by strategyId, pair, timeframe, minTrades.",
    inputSchema: obj({
      strategyId: { type: "string" },
      pair: { type: "string" },
      timeframe: { type: "string" },
      minTrades: { type: "number" },
      limit: { type: "number" },
    }),
    role: "viewer",
    run: (a, c) => c.results.query(a ?? {}),
  },
  {
    name: "analysis_strategy_detail",
    description: "All warehouse rows for one strategy across pairs/timeframes/windows.",
    inputSchema: obj({ strategyId: { type: "string" } }, ["strategyId"]),
    role: "viewer",
    run: (a, c) => c.results.byStrategy({ strategyId: a.strategyId }),
  },
  {
    name: "analysis_sweep_status",
    description: "A sweep with its cells and their metrics, by sweep id.",
    inputSchema: obj({ id: { type: "string" } }, ["id"]),
    role: "viewer",
    run: (a, c) => c.sweeps.get({ id: a.id }),
  },
  {
    name: "analysis_account_status",
    description: "Non-secret Jester connection status for the agent's account (accountId, hyperliquidReady).",
    inputSchema: obj({}),
    role: "viewer",
    run: (_a, c) => c.credentials.status(),
  },
  {
    name: "analysis_polymarket_microstructure_status",
    description:
      "Read-only progress for the prospectively registered Polymarket microstructure tape: boundary, rows, usable rows, markets, resolved markets, span, and readiness. Returns no outcome-conditioned alpha.",
    inputSchema: obj({}),
    role: "viewer",
    run: (_a, c) => c.polymarket.microstructureTape(),
  },
  {
    name: "analysis_venue_lead_lag_status",
    description:
      "Read-only count/span/block readiness for the prospective Hyperliquid↔Chainlink tape. Returns no correlations, lag rankings, or directional alpha.",
    inputSchema: obj({}),
    role: "viewer",
    run: (_a, c) => c.polymarket.venueLeadLagTape(),
  },
  {
    name: "analysis_authoritative_trade_flow_status",
    description:
      "Read-only coverage, finality, mapping-integrity, and readiness for the prospectively registered Polymarket taker-flow tape. Returns no trade-direction aggregate, outcomes, or P&L.",
    inputSchema: obj({}),
    role: "viewer",
    run: (_a, c) => c.polymarket.authoritativeTradeFlowTape(),
  },
  {
    name: "analysis_hyperliquid_flow_status",
    description:
      "Read-only coverage, timing, bucket, and health readiness for the prospectively registered Hyperliquid aggressor-flow tape. Returns no flow sign, outcome, grade, strategy rule, or P&L.",
    inputSchema: obj({}),
    role: "viewer",
    run: (_a, c) => c.polymarket.hyperliquidFlowTape(),
  },
  {
    name: "analysis_polymarket_flow_distribution_audit",
    description:
      "Read-only preregistered feature distributions and immutable feature-cut freeze status for the Hyperliquid and CLOB event-flow tapes. Each report remains null and performs no feature-value query until that source passes every frozen readiness floor. Returns no outcomes, paper decisions, directional rule, strategy performance, or execution capability.",
    inputSchema: obj({}),
    role: "viewer",
    run: (_a, c) => c.polymarket.flowDistributionAudit(),
  },
  {
    name: "analysis_polymarket_microstructure_state_distribution_audit",
    description:
      "Read-only preregistered paired-book state distributions by asset, 5m/15m horizon, and causal sample minute. The feature report remains null and performs no feature-value query until the inherited raw microstructure tape gate passes. Returns no outcomes, paper decisions, strategy performance, rule, or execution capability.",
    inputSchema: obj({}),
    role: "viewer",
    run: (_a, c) => c.polymarket.microstructureStateDistributionAudit(),
  },
  {
    name: "analysis_cross_asset_lead_lag_status",
    description:
      "Read-only exact-match count/span/block readiness for the prospective BTC→alt lead/lag tape. Returns no correlations, lag rankings, signs, or directional alpha.",
    inputSchema: obj({}),
    role: "viewer",
    run: (_a, c) => c.polymarket.crossAssetLeadLagTape(),
  },
  {
    name: "analysis_paper_markout_status",
    description:
      "Read-only count/data-quality readiness for the prospective 30-second paper-fill markout tape. Returns no directional markouts, signs, bot rankings, or asset/session cuts.",
    inputSchema: obj({}),
    role: "viewer",
    run: (_a, c) => c.polymarket.paperMarkoutTape(),
  },
  {
    name: "analysis_deribit_skew_status",
    description:
      "Read-only row/span/freshness readiness for the prospective BTC/ETH Deribit skew tape. Returns no skew, OI ratio, IV, or directional alpha.",
    inputSchema: obj({}),
    role: "viewer",
    run: (_a, c) => c.polymarket.deribitSkewTape(),
  },
  {
    name: "analysis_pricer_calibration_audit",
    description:
      "Forward-only BSM-vs-UP-book calibration audit. Returns only observation/span/cluster readiness until its frozen floor passes, then the preregistered pooled proper-score report.",
    inputSchema: obj({}),
    role: "viewer",
    run: (_a, c) => c.polymarket.pricerCalibration(),
  },
  {
    name: "analysis_bsm_profile_calibration_audit",
    description:
      "Read-only BTC5m paired proper-score audit for the frozen BSM window profile versus its parent. Returns counts/timing only until all preregistered floors pass.",
    inputSchema: obj({}),
    role: "viewer",
    run: (_a, c) => c.polymarket.bsmWindowProfileCalibration(),
  },
  {
    name: "analysis_microstructure_absorption_audit",
    description:
      "Read-only 5m effort-vs-response absorption audit. Returns counts/timing/session bet counts only until every preregistered floor passes; never places orders.",
    inputSchema: obj({}),
    role: "viewer",
    run: (_a, c) => c.polymarket.microstructureAbsorption(),
  },
  {
    name: "analysis_four_streak_reversal_audit",
    description:
      "Read-only 5m four-result streak-reversal audit. Returns coverage/bet/cluster/timing/session counts only until every preregistered floor passes; never places orders.",
    inputSchema: obj({}),
    role: "viewer",
    run: (_a, c) => c.polymarket.fourStreakReversal(),
  },
  {
    name: "analysis_strategy_independence",
    description:
      "Outcome-free strategy × timeframe overlap and side-agreement map for the registered forward paper roster. Reads cohort key, market ID, and chosen side only; never reads outcomes, fills, asks, or P&L.",
    inputSchema: obj({}),
    role: "viewer",
    run: (_a, c) => c.polymarket.strategyIndependence(),
  },
  {
    name: "analysis_complete_set_taker_audit",
    description:
      "Read-only same-condition UP+DOWN matched-share cost audit. Returns only count/span readiness until the frozen floor passes; uses batched public books and exposes no order or merge path.",
    inputSchema: obj({}),
    role: "viewer",
    run: (_a, c) => c.polymarket.completeSetTaker(),
  },
  {
    name: "analysis_cross_horizon_bundle_audit",
    description:
      "Read-only readiness for synchronized 5m/15m nested-strike bundle observations. Returns counts/span only until all frozen floors pass, then the preregistered fee-adjusted cost audit.",
    inputSchema: obj({}),
    role: "viewer",
    run: (_a, c) => c.polymarket.crossHorizonBundle(),
  },
  {
    name: "analysis_run_sweep",
    description:
      "Launch a backtest sweep over a matrix {strategies, assets, timeframes, windows}. Requires operator role. windows are day counts or the string \"max\".",
    inputSchema: obj(
      {
        name: { type: "string" },
        strategies: { type: "array", items: { type: "string" } },
        assets: { type: "array", items: { type: "string" } },
        timeframes: { type: "array", items: { type: "string" } },
        windows: { type: "array", items: {} },
      },
      ["strategies", "assets", "timeframes", "windows"],
    ),
    role: "operator",
    run: (a, c) => c.sweeps.create(a),
  },

  // ── Knowledge base — the team's durable memory. Read BEFORE re-researching; write findings back
  //    AFTER. Reads are viewer; writes are scope-elevated (elevate) so agents can record findings
  //    without unlocking sweeps/trading. Non-destructive: edits snapshot a revision, archive never
  //    deletes.
  {
    name: "kb_search",
    description:
      "Search the knowledge base (Postgres full-text over title+body, rank-ordered). Filter by category (operations|strategy|research|provider|decision|postmortem) or tag. Returns slug, title, category, tags, snippet. READ THIS BEFORE redoing research.",
    inputSchema: obj({
      query: { type: "string" },
      category: { type: "string" },
      tag: { type: "string" },
      includeArchived: { type: "boolean" },
      limit: { type: "number" },
    }),
    role: "viewer",
    run: (a, c) => c.kb.search(a ?? {}),
  },
  {
    name: "kb_get",
    description: "Fetch one knowledge article by slug, with its full markdown body and revision count.",
    inputSchema: obj({ slug: { type: "string" } }, ["slug"]),
    role: "viewer",
    run: (a, c) => c.kb.get({ slug: a.slug }),
  },
  {
    name: "kb_categories",
    description: "List knowledge categories with article counts.",
    inputSchema: obj({}),
    role: "viewer",
    run: (_a, c) => c.kb.categories(),
  },
  {
    name: "kb_write",
    description:
      "Create or update a knowledge article (kebab-case slug is the key; updating snapshots the prior version to history). category ∈ operations|strategy|research|provider|decision|postmortem. body is markdown. Write findings back here so they're never redone. Optional sources: [{title,url}].",
    inputSchema: obj(
      {
        slug: { type: "string", description: "kebab-case, stable key" },
        title: { type: "string" },
        category: { type: "string" },
        tags: { type: "array", items: { type: "string" } },
        body: { type: "string", description: "markdown" },
        sources: { type: "array", items: obj({ title: { type: "string" }, url: { type: "string" } }, ["title", "url"]) },
        status: { type: "string", description: "active|superseded|archived" },
        supersededBySlug: { type: "string" },
      },
      ["slug", "title", "category", "body"],
    ),
    role: "operator",
    elevate: true,
    run: (a, c) => c.kb.upsert(a),
  },
  {
    name: "kb_archive",
    description:
      "Archive (or supersede, if supersededBySlug given) an article — never a hard delete, so the 'why we stopped doing X' trail survives.",
    inputSchema: obj({ slug: { type: "string" }, supersededBySlug: { type: "string" } }, ["slug"]),
    role: "operator",
    elevate: true,
    run: (a, c) => c.kb.archive(a),
  },
];

const PROMPTS = [
  {
    name: "screen-strategy",
    description: "Rigorously screen a strategy for a durable edge (the methodology this system enforces).",
    arguments: [{ name: "strategyId", description: "Strategy to screen", required: true }],
    build: (a: any) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text:
              `Screen the strategy "${a?.strategyId ?? "<id>"}" for a REAL edge, not a mirage.\n\n` +
              `1. Use analysis_strategy_detail to pull every window/timeframe already in the warehouse.\n` +
              `2. Compare the recent-30-day slice against the FULL-WINDOW result — a strategy that only ` +
              `looks good on the last month is a flattering slice, not an edge.\n` +
              `3. Ignore any row with < 20 trades (too small a sample to trust).\n` +
              `4. Judge by full-window profit factor across multiple assets/timeframes; PF ≤ 1.0 = no edge.\n` +
              `If coverage is thin, launch a sweep (analysis_run_sweep) over majors × [15m,1h] × [30, max] first.`,
          },
        },
      ],
    }),
  },
];

const INTENT_GUIDE = {
  howToUse:
    "Observe before you act. Read the warehouse first; only launch sweeps when coverage is thin. And search the knowledge base (kb_search) BEFORE re-researching anything — write findings back with kb_write after.",
  routes: [
    { userSays: ["what strategies", "catalog"], tools: ["analysis_search_strategies"] },
    { userSays: ["results", "best strategy", "profit factor", "backtest"], tools: ["analysis_query_results", "analysis_strategy_detail"] },
    { userSays: ["run a sweep", "backtest these", "screen"], tools: ["analysis_run_sweep (operator)", "analysis_sweep_status"] },
    { userSays: ["what do we know", "have we researched", "why did we", "findings", "prior work"], tools: ["kb_search", "kb_get"] },
    { userSays: ["record this", "write it down", "save finding", "document"], tools: ["kb_write"] },
    { userSays: ["am i connected", "account"], tools: ["analysis_account_status"] },
  ],
};

async function authorize(req: Request): Promise<{ role: "viewer" | "operator" } | null> {
  const provided = req.headers.get("X-API-Key");
  if (!provided) return null;
  const expected = await getSetting("AGENT_API_KEY");
  if (!expected || provided.length !== expected.length) return null;
  if (!timingSafeEqual(Buffer.from(provided), Buffer.from(expected))) return null;
  const role = (await getSetting("AGENT_API_ROLE")) === "operator" ? "operator" : "viewer";
  return { role };
}

function makeCaller(role: "viewer" | "operator", req: Request): Caller {
  const user = {
    id: "agent",
    name: "Agent",
    email: "agent@localhost",
    role,
    banned: false,
    banReason: null,
    banExpires: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    emailVerified: false,
    image: null,
  };
  return appRouter.createCaller({ user, session: null, req });
}

const ok = (id: unknown, result: unknown) => ({ jsonrpc: "2.0", id, result });
const err = (id: unknown, code: number, message: string) => ({ jsonrpc: "2.0", id, error: { code, message } });

export function createMcpApp() {
  const app = new Hono();

  app.post("/mcp", async (c) => {
    const auth = await authorize(c.req.raw);
    if (!auth) return c.json(err(null, -32001, "Unauthorized: valid X-API-Key required"), 401);

    const body = await c.req.json().catch(() => null);
    if (!body || body.jsonrpc !== "2.0") return c.json(err(null, -32600, "Invalid JSON-RPC request"), 400);
    const { id, method, params } = body;

    switch (method) {
      case "initialize":
        return c.json(
          ok(id, {
            protocolVersion: PROTOCOL_VERSION,
            capabilities: { tools: {}, prompts: {}, resources: {} },
            serverInfo: { name: "jester-analysis", version: "0.1.0" },
            instructions: INTENT_GUIDE.howToUse,
          }),
        );

      case "ping":
        return c.json(ok(id, {}));

      case "tools/list":
        return c.json(
          ok(id, {
            tools: TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })),
          }),
        );

      case "tools/call": {
        const tool = TOOLS.find((t) => t.name === params?.name);
        if (!tool) return c.json(err(id, -32602, `Unknown tool: ${params?.name}`));
        try {
          // KB write tools run at operator scope (see McpTool.elevate); everything else at the
          // agent's real role, so sweeps/trading stay gated.
          const caller = makeCaller(tool.elevate ? "operator" : auth.role, c.req.raw);
          const result = await tool.run(params?.arguments ?? {}, caller);
          return c.json(ok(id, { content: [{ type: "text", text: JSON.stringify(result) }] }));
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          return c.json(ok(id, { content: [{ type: "text", text: `Error: ${message}` }], isError: true }));
        }
      }

      case "prompts/list":
        return c.json(ok(id, { prompts: PROMPTS.map(({ name, description, arguments: a }) => ({ name, description, arguments: a })) }));

      case "prompts/get": {
        const prompt = PROMPTS.find((p) => p.name === params?.name);
        if (!prompt) return c.json(err(id, -32602, `Unknown prompt: ${params?.name}`));
        return c.json(ok(id, prompt.build(params?.arguments ?? {})));
      }

      case "resources/list":
        return c.json(
          ok(id, {
            resources: [],
            resourceTemplates: [
              { uriTemplate: "strategy://{id}", name: "Strategy detail", description: "All warehouse rows for a strategy" },
              { uriTemplate: "sweep://{id}", name: "Sweep", description: "A sweep with its cells" },
              { uriTemplate: "kb://{slug}", name: "Knowledge article", description: "A knowledge-base article by slug" },
            ],
          }),
        );

      case "resources/read": {
        const uri: string = params?.uri ?? "";
        const caller = makeCaller(auth.role, c.req.raw);
        try {
          let data: unknown;
          const strat = uri.match(/^strategy:\/\/(.+)$/);
          const sweep = uri.match(/^sweep:\/\/(.+)$/);
          const kb = uri.match(/^kb:\/\/(.+)$/);
          if (strat) data = await caller.results.byStrategy({ strategyId: strat[1] });
          else if (sweep) data = await caller.sweeps.get({ id: sweep[1] });
          else if (kb) data = await caller.kb.get({ slug: kb[1] });
          else return c.json(err(id, -32602, `Unsupported resource uri: ${uri}`));
          return c.json(ok(id, { contents: [{ uri, mimeType: "application/json", text: JSON.stringify(data) }] }));
        } catch (e) {
          return c.json(err(id, -32603, e instanceof Error ? e.message : String(e)));
        }
      }

      default:
        return c.json(err(id, -32601, `Method not found: ${method}`));
    }
  });

  return app;
}
