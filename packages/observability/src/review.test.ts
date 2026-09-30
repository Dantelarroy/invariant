import { describe, expect, it } from "vitest";
import {
  type CorrectionScore,
  createReviewQueue,
  enqueueForReview,
  ensureReviewQueue,
  listCompletedReviews,
  pickCorrection,
  REVIEW_QUEUE_NAME,
  VERDICT_CONFIG_NAME,
} from "./review.js";

const settings = {
  baseUrl: "http://127.0.0.1:3000",
  publicKey: "pk",
  secretKey: "sk",
};

type Row = Record<string, unknown>;

/**
 * An in-memory Langfuse answering the few public API routes the review queue
 * uses, recording every request. `fail` makes every request throw.
 */
function fakeLangfuse(options: { fail?: boolean } = {}) {
  const configs: Row[] = [
    { id: "probe-config", name: "probe-approved", dataType: "BOOLEAN" },
  ];
  const queues: Row[] = [
    {
      id: "probe-queue",
      name: "probe-queue",
      scoreConfigIds: ["probe-config"],
    },
  ];
  const items: Row[] = [];
  const scores: Row[] = [];
  const observations: Row[] = [];
  const requests: { method: string; path: string; body?: Row }[] = [];
  let next = 0;
  const id = (prefix: string) => `${prefix}-${++next}`;
  const page = (data: Row[]) => ({
    data,
    meta: { page: 1, limit: 100, totalItems: data.length, totalPages: 1 },
  });
  const json = (body: unknown) =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });

  const fetch = async (input: string | URL, init?: RequestInit) => {
    if (options.fail) throw new TypeError("fetch failed");
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const body = init?.body
      ? (JSON.parse(String(init.body)) as Row)
      : undefined;
    requests.push({ method, path: url.pathname, ...(body ? { body } : {}) });
    const q = url.searchParams;
    const path = url.pathname;
    if (path === "/api/public/score-configs") {
      if (method === "POST") {
        const created = { id: id("config"), isArchived: false, ...body };
        configs.push(created);
        return json(created);
      }
      return json(page(configs));
    }
    if (path === "/api/public/annotation-queues") {
      if (method === "POST") {
        const created = { id: id("queue"), ...body };
        queues.push(created);
        return json(created);
      }
      return json(page(queues));
    }
    const itemsPath = path.match(
      /^\/api\/public\/annotation-queues\/([^/]+)\/items$/,
    );
    if (itemsPath) {
      const queueId = itemsPath[1];
      if (method === "POST") {
        const created = {
          id: id("item"),
          queueId,
          status: "PENDING",
          completedAt: null,
          ...body,
        };
        items.push(created);
        return json(created);
      }
      const status = q.get("status");
      return json(
        page(
          items.filter(
            (i) => i.queueId === queueId && (!status || i.status === status),
          ),
        ),
      );
    }
    if (path === "/api/public/v3/scores") {
      const names = q.get("name")?.split(",");
      const traceId = q.get("traceId");
      return json({
        data: scores.filter(
          (s) =>
            (!names || names.includes(String(s.name))) &&
            (!traceId ||
              (s.subject as Row).traceId === traceId ||
              (s.subject as Row).id === traceId),
        ),
        meta: { limit: 100 },
      });
    }
    if (path === "/api/public/v2/observations") {
      const filter = JSON.parse(q.get("filter") ?? "[]") as Row[];
      const wanted = filter.find((f) => f.column === "id")?.value;
      return json({
        data: observations.filter((o) => o.id === wanted),
        meta: {},
      });
    }
    return new Response("not found", { status: 404 });
  };
  return {
    client: { settings, fetch: fetch as typeof globalThis.fetch },
    configs,
    queues,
    items,
    scores,
    observations,
    requests,
  };
}

/** A traced extraction generation as the v2 observations API returns it. */
function generation(observationId: string, traceId: string, invoice: Row) {
  return {
    id: observationId,
    traceId,
    type: "GENERATION",
    name: "extract-text-v1",
    input: JSON.stringify({
      promptVersion: "extract-text-v1",
      source: `text of ${observationId}`,
    }),
    output: JSON.stringify(invoice),
    metadata: {
      "attributes.mastra.metadata.runId": `run-${observationId}`,
      "attributes.mastra.metadata.documentId": `doc-${observationId}`,
      "attributes.mastra.metadata.promptVersion": "extract-text-v1",
    },
  };
}

function score(row: {
  name: string;
  value: string;
  observationId: string;
  traceId: string;
  source?: string;
  timestamp: string;
  dataType?: string;
  configId?: string | null;
  authorUserId?: string;
}): Row {
  return {
    id: `${row.name}-${row.timestamp}-${row.source ?? "ANNOTATION"}`,
    name: row.name,
    value: row.value,
    dataType:
      row.dataType ?? (row.name === "output" ? "CORRECTION" : "CATEGORICAL"),
    source: row.source ?? "ANNOTATION",
    timestamp: row.timestamp,
    configId: row.configId ?? null,
    authorUserId: row.authorUserId ?? null,
    subject: {
      kind: "observation",
      id: row.observationId,
      traceId: row.traceId,
    },
  };
}

describe("ensureReviewQueue", () => {
  it("creates the verdict config and the queue once, leaving other queues alone", async () => {
    const lf = fakeLangfuse();

    const first = await ensureReviewQueue(lf.client);
    const second = await ensureReviewQueue(lf.client);

    expect(second).toEqual(first);
    const verdict = lf.configs.find((c) => c.name === VERDICT_CONFIG_NAME);
    expect(verdict).toMatchObject({
      dataType: "CATEGORICAL",
      categories: [
        { label: "correct", value: 0 },
        { label: "corrected", value: 1 },
        { label: "unusable", value: 2 },
      ],
    });
    expect(lf.queues.filter((q) => q.name === REVIEW_QUEUE_NAME)).toEqual([
      expect.objectContaining({
        id: first.queueId,
        scoreConfigIds: [verdict?.id],
      }),
    ]);
    expect(first.verdictConfigId).toBe(verdict?.id);
    expect(lf.configs).toHaveLength(2);
    expect(lf.queues).toHaveLength(2);
  });
});

describe("enqueueForReview", () => {
  it("adds the generation once, as an observation item", async () => {
    const lf = fakeLangfuse();
    const target = { traceId: "t1", observationId: "o1" };

    const first = await enqueueForReview(lf.client, target);
    const again = await enqueueForReview(lf.client, target);

    expect(first.created).toBe(true);
    expect(again).toEqual({ ...first, created: false });
    expect(lf.items).toEqual([
      expect.objectContaining({ objectId: "o1", objectType: "OBSERVATION" }),
    ]);
  });
});

describe("pickCorrection", () => {
  const base = { name: "output", dataType: "CORRECTION" as const };
  it("prefers the reviewer's annotation, then the latest", () => {
    const scores: CorrectionScore[] = [
      {
        ...base,
        value: "api-newest",
        source: "API",
        timestamp: "2026-09-30T12:00:03Z",
      },
      {
        ...base,
        value: "annotation-old",
        source: "ANNOTATION",
        timestamp: "2026-09-30T12:00:01Z",
      },
      {
        ...base,
        value: "annotation-new",
        source: "ANNOTATION",
        timestamp: "2026-09-30T12:00:02Z",
      },
    ];
    expect(pickCorrection(scores)?.value).toBe("annotation-new");
    expect(pickCorrection(scores.slice(0, 1))?.value).toBe("api-newest");
    expect(pickCorrection([])).toBeUndefined();
  });
});

describe("listCompletedReviews", () => {
  it("joins each completed item with its verdict, correction and generation", async () => {
    const lf = fakeLangfuse();
    const { verdictConfigId } = await ensureReviewQueue(lf.client);
    const invoice = { number: "F-1", totalCents: 11285 };
    for (const n of [1, 2, 3]) {
      lf.observations.push(generation(`o${n}`, `t${n}`, invoice));
      await enqueueForReview(lf.client, {
        traceId: `t${n}`,
        observationId: `o${n}`,
      });
    }
    // o1 corrected, o2 completed without verdict, o3 still pending.
    for (const item of lf.items.slice(0, 2)) {
      item.status = "COMPLETED";
      item.completedAt = "2026-09-30T13:00:00Z";
    }
    lf.scores.push(
      score({
        name: VERDICT_CONFIG_NAME,
        value: "correct",
        observationId: "o1",
        traceId: "t1",
        timestamp: "2026-09-30T12:59:00Z",
        configId: verdictConfigId,
      }),
      score({
        name: VERDICT_CONFIG_NAME,
        value: "corrected",
        observationId: "o1",
        traceId: "t1",
        timestamp: "2026-09-30T12:59:30Z",
        configId: verdictConfigId,
        authorUserId: "user-1",
      }),
      score({
        name: "output",
        value: '{"totalCents":10285}',
        observationId: "o1",
        traceId: "t1",
        timestamp: "2026-09-30T12:59:10Z",
      }),
      score({
        name: "output",
        value: "api",
        observationId: "o1",
        traceId: "t1",
        timestamp: "2026-09-30T12:59:50Z",
        source: "API",
      }),
    );

    const reviews = await listCompletedReviews(lf.client);

    expect(reviews).toEqual([
      {
        itemId: lf.items[0]?.id,
        observationId: "o1",
        completedAt: "2026-09-30T13:00:00Z",
        verdict: "corrected",
        reviewer: "user-1",
        correction: '{"totalCents":10285}',
        generation: {
          traceId: "t1",
          runId: "run-o1",
          documentId: "doc-o1",
          promptVersion: "extract-text-v1",
          source: "text of o1",
          output: invoice,
        },
      },
      {
        itemId: lf.items[1]?.id,
        observationId: "o2",
        completedAt: "2026-09-30T13:00:00Z",
        verdict: undefined,
        reviewer: undefined,
        correction: undefined,
        generation: expect.objectContaining({ runId: "run-o2", traceId: "t2" }),
      },
    ]);
  });

  it("reports an unknown verdict label as undefined, and a missing generation as undefined", async () => {
    const lf = fakeLangfuse();
    await ensureReviewQueue(lf.client);
    await enqueueForReview(lf.client, { traceId: "t9", observationId: "o9" });
    const [item] = lf.items;
    if (item) item.status = "COMPLETED";

    const [review] = await listCompletedReviews(lf.client);

    expect(review).toMatchObject({ observationId: "o9", verdict: undefined });
    expect(review?.generation).toBeUndefined();
  });
});

describe("createReviewQueue", () => {
  it("is off without LANGFUSE_BASE_URL", () => {
    expect(createReviewQueue({})).toBeUndefined();
  });

  it("enqueues in the background; flush waits and a failure is only logged", async () => {
    const warnings: string[] = [];
    const lf = fakeLangfuse({ fail: true });
    const queue = createReviewQueue(
      { LANGFUSE_BASE_URL: settings.baseUrl },
      { fetch: lf.client.fetch, warn: (m) => warnings.push(m) },
    );

    expect(() =>
      queue?.enqueue({ traceId: "t", observationId: "o" }),
    ).not.toThrow();
    await queue?.flush();

    expect(warnings).toEqual([expect.stringContaining("o")]);
  });

  it("creates the queue once per process for several documents", async () => {
    const lf = fakeLangfuse();
    const queue = createReviewQueue(
      { LANGFUSE_BASE_URL: settings.baseUrl },
      { fetch: lf.client.fetch },
    );

    queue?.enqueue({ traceId: "t1", observationId: "o1" });
    queue?.enqueue({ traceId: "t2", observationId: "o2" });
    await queue?.flush();

    expect(lf.items.map((i) => i.objectId).sort()).toEqual(["o1", "o2"]);
    expect(
      lf.requests.filter(
        (r) =>
          r.method === "POST" && r.path === "/api/public/annotation-queues",
      ),
    ).toHaveLength(1);
  });
});
