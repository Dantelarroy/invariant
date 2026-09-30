import { RULES, verifyInvoice } from "@invariant/rules";
import type { Invoice } from "@invariant/schema";
import { describe, expect, it, vi } from "vitest";
import { createScoreSink } from "./index.js";

const env = { LANGFUSE_BASE_URL: "http://127.0.0.1:3000" };
const target = { traceId: "trace-1", observationId: "obs-1" };

const invoice: Invoice = {
  number: "F-1",
  issueDate: "2026-09-24",
  currency: "EUR",
  supplier: { name: "Proveedor SL", taxId: "B12345674" },
  customer: { name: "Cliente SL" },
  lines: [
    {
      description: "Item",
      quantity: 1,
      unitPriceCents: 1000,
      lineTotalCents: 1000,
      vatRateBps: 2100,
    },
  ],
  taxBaseCents: 1000,
  vatAmountCents: 210,
  totalCents: 1210,
};
/** Fails only the total rule: base + VAT is 12,10 € but it says 13,10 €. */
const wrongTotal = verifyInvoice(
  { ...invoice, totalCents: 1310 },
  { today: "2026-09-30" },
);

type Body = Record<string, unknown>;

/** A fetch that records every request and answers 200. */
function recordingFetch() {
  const bodies: Body[] = [];
  const requests: { url: string; init: RequestInit }[] = [];
  const fetch = vi.fn(async (url: string | URL, init?: RequestInit) => {
    requests.push({ url: String(url), init: init ?? {} });
    bodies.push(JSON.parse(String(init?.body)) as Body);
    return new Response("{}", { status: 200 });
  });
  return {
    fetch: fetch as unknown as typeof globalThis.fetch,
    bodies,
    requests,
  };
}

describe("createScoreSink", () => {
  it("is off without LANGFUSE_BASE_URL", () => {
    expect(createScoreSink({}, { environment: "pipeline" })).toBeUndefined();
  });

  it("sends a boolean per rule, rules.score and rules.valid to the generation", async () => {
    const { fetch, bodies, requests } = recordingFetch();
    const sink = createScoreSink(env, { environment: "pipeline", fetch });

    sink?.ruleScores(target, wrongTotal);
    await sink?.flush();

    expect(bodies).toHaveLength(RULES.length + 2);
    expect(bodies.map((b) => b.name)).toEqual([
      ...RULES.map((rule) => `rule.${rule.id}`),
      "rules.score",
      "rules.valid",
    ]);
    for (const body of bodies) {
      expect(body).toMatchObject({
        id: `obs-1-${body.name}`,
        traceId: "trace-1",
        observationId: "obs-1",
        environment: "pipeline",
      });
    }
    const byName = new Map(bodies.map((b) => [b.name, b]));
    expect(byName.get("rule.total")).toMatchObject({
      value: 0,
      dataType: "BOOLEAN",
      comment: wrongTotal.violations[0]?.message,
      metadata: {
        severity: "error",
        details: [
          expect.objectContaining({ expectedCents: 1210, printedCents: 1310 }),
        ],
      },
    });
    expect(byName.get("rule.tax-ids")).toMatchObject({
      value: 1,
      dataType: "BOOLEAN",
      metadata: { severity: "error" },
    });
    expect(byName.get("rule.tax-ids")?.comment).toBeUndefined();
    expect(byName.get("rules.score")).toMatchObject({
      value: wrongTotal.score,
      dataType: "NUMERIC",
    });
    expect(byName.get("rules.valid")).toMatchObject({
      value: 0,
      dataType: "BOOLEAN",
    });
    expect(requests[0]?.url).toBe("http://127.0.0.1:3000/api/public/scores");
    expect(requests[0]?.init.method).toBe("POST");
    expect(
      (requests[0]?.init.headers as Record<string, string> | undefined)
        ?.Authorization,
    ).toMatch(/^Basic /);
  });

  it("uses the same ids when sent again, so Langfuse updates instead of duplicating", async () => {
    const { fetch, bodies } = recordingFetch();
    const sink = createScoreSink(env, { environment: "eval", fetch });

    sink?.ruleScores(target, wrongTotal);
    sink?.ruleScores(target, wrongTotal);
    await sink?.flush();

    const ids = bodies.map((b) => b.id);
    expect(ids.slice(0, ids.length / 2)).toEqual(ids.slice(ids.length / 2));
  });

  it("logs failures and never throws them", async () => {
    const warn = vi.fn();
    const fetch = vi.fn(async () => {
      throw new Error("connection refused");
    }) as unknown as typeof globalThis.fetch;
    const rejecting = vi.fn(
      async () => new Response("bad", { status: 400 }),
    ) as unknown as typeof globalThis.fetch;

    for (const failing of [fetch, rejecting]) {
      const sink = createScoreSink(env, {
        environment: "pipeline",
        fetch: failing,
        warn,
      });
      expect(() => sink?.ruleScores(target, wrongTotal)).not.toThrow();
      await expect(sink?.flush()).resolves.toBeUndefined();
    }
    expect(warn).toHaveBeenCalled();
  });
});
