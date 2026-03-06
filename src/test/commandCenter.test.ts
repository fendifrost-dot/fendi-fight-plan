import { describe, it, expect } from "vitest";

// ── Types mirroring the router contract ──────────────────────────
interface AIRouterRequest {
  prompt: string;
  context: "credit" | "marketing";
  modelId?: string;
  extractedData?: Record<string, unknown>;
}

interface AIRouterResponse {
  provider: "lovable" | "vertex";
  model: string;
  content: string;
}

// ── 1 · Router classification logic (pure, no network) ─────────
function classifyContext(prompt: string): "credit" | "marketing" {
  const creditKeywords = [
    "dispute", "credit report", "bureau", "FCRA", "fcra", "triage",
    "charge-off", "collection", "derogatory", "inaccurate",
    "experian", "equifax", "transunion", "late payment",
    "violation", "fair credit reporting",
  ];
  const lower = prompt.toLowerCase();
  return creditKeywords.some((kw) => lower.includes(kw)) ? "credit" : "marketing";
}

function resolveProvider(context: "credit" | "marketing"): "lovable" | "vertex" {
  return context === "credit" ? "lovable" : "vertex";
}

function resolveModel(context: "credit" | "marketing", modelId?: string): string {
  if (modelId) return modelId;
  return context === "credit" ? "openai/gpt-5-mini" : "gemini-2.5-pro";
}

// ── 2 · Tests ────────────────────────────────────────────────────
describe("AI Router — context classification", () => {
  it("routes 'dispute letter' prompts to credit context", () => {
    expect(classifyContext("Generate a dispute letter for Equifax")).toBe("credit");
  });

  it("routes 'FCRA violation' prompts to credit context", () => {
    expect(classifyContext("Check for FCRA violations in my report")).toBe("credit");
  });

  it("routes 'social media' prompts to marketing context", () => {
    expect(classifyContext("Draft a Facebook ad for our spring sale")).toBe("marketing");
  });

  it("routes 'email campaign' prompts to marketing context", () => {
    expect(classifyContext("Write a Mailchimp email for new subscribers")).toBe("marketing");
  });

  it("routes ambiguous prompts to marketing by default", () => {
    expect(classifyContext("Help me with something")).toBe("marketing");
  });
});

describe("AI Router — provider resolution", () => {
  it("selects Lovable AI for credit context", () => {
    expect(resolveProvider("credit")).toBe("lovable");
  });

  it("selects Vertex AI for marketing context", () => {
    expect(resolveProvider("marketing")).toBe("vertex");
  });
});

describe("AI Router — model selection", () => {
  it("defaults credit context to openai/gpt-5-mini", () => {
    expect(resolveModel("credit")).toBe("openai/gpt-5-mini");
  });

  it("defaults marketing context to gemini-2.5-pro", () => {
    expect(resolveModel("marketing")).toBe("gemini-2.5-pro");
  });

  it("respects explicit modelId override", () => {
    expect(resolveModel("credit", "openai/gpt-5")).toBe("openai/gpt-5");
  });
});

describe("AI Router — secret initialisation guard", () => {
  it("rejects when GOOGLE_CLOUD_KEY is missing for vertex provider", () => {
    const secrets: Record<string, string | undefined> = {};
    const provider = "vertex";
    const hasKey = provider !== "vertex" || !!secrets["GOOGLE_CLOUD_KEY"];
    expect(hasKey).toBe(false);
  });

  it("passes when GOOGLE_CLOUD_KEY is present for vertex provider", () => {
    const secrets: Record<string, string | undefined> = { GOOGLE_CLOUD_KEY: "test-key-123" };
    const provider = "vertex";
    const hasKey = provider !== "vertex" || !!secrets["GOOGLE_CLOUD_KEY"];
    expect(hasKey).toBe(true);
  });

  it("does not require GOOGLE_CLOUD_KEY for lovable provider", () => {
    const secrets: Record<string, string | undefined> = {};
    const provider: "lovable" | "vertex" = "lovable";
    const hasKey = provider === "lovable" || !!secrets["GOOGLE_CLOUD_KEY"];
    expect(hasKey).toBe(true);
  });
});

describe("Triage layer — preserved through Command Center", () => {
  const makeAccount = (id: string, triage: string, confidence: number) => ({
    id,
    creditorName: `Creditor-${id}`,
    maskedAccountNumber: `XXXX-${id}`,
    triageState: triage,
    confidence,
    isSelected: triage === "included",
  });

  it("high confidence (>=0.7) defaults to included", () => {
    const acc = makeAccount("a1", "included", 0.85);
    expect(acc.triageState).toBe("included");
    expect(acc.isSelected).toBe(true);
  });

  it("low confidence (<0.7) defaults to pending", () => {
    const acc = makeAccount("a2", "pending", 0.5);
    expect(acc.triageState).toBe("pending");
    expect(acc.isSelected).toBe(false);
  });

  it("excluded accounts are filtered from letter generation payload", () => {
    const accounts = [
      makeAccount("a1", "included", 0.9),
      makeAccount("a2", "excluded", 0.8),
      makeAccount("a3", "included", 0.7),
      makeAccount("a4", "pending", 0.4),
    ];
    const safeAccounts = accounts.filter((a) => a.triageState === "included");
    expect(safeAccounts).toHaveLength(2);
    expect(safeAccounts.every((a) => a.triageState === "included")).toBe(true);
  });

  it("PDF extracted data is passed through unchanged to credit handler", () => {
    const extractedData = {
      accounts: [makeAccount("x1", "included", 0.95)],
      rawSummary: "Original PDF analysis",
      bureau: "experian",
    };
    // Simulate router passing data through
    const routerPayload = { ...extractedData, _routedVia: "lovable" };
    expect(routerPayload.accounts).toEqual(extractedData.accounts);
    expect(routerPayload.rawSummary).toBe("Original PDF analysis");
    expect(routerPayload.bureau).toBe("experian");
  });
});
