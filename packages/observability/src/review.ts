import { basicAuth } from "./langfuse-api.js";
import {
  type Env,
  type LangfuseSettings,
  langfuseSettings,
} from "./settings.js";
import type { GenerationRef } from "./spans.js";

/** The annotation queue paused documents go to (ADR-0013). */
export const REVIEW_QUEUE_NAME = "invariant-review";
/** The categorical score config the reviewer sets on each item. */
export const VERDICT_CONFIG_NAME = "verdict";
/** The reviewer's verdicts, in the order Langfuse numbers them (0, 1, 2). */
export const VERDICTS = ["correct", "corrected", "unusable"] as const;
export type Verdict = (typeof VERDICTS)[number];
/** Langfuse stores a corrected output as a CORRECTION score with this name. */
export const CORRECTION_SCORE_NAME = "output";

/** Where Langfuse is and how to call it; `fetch` is replaced in tests. */
export interface LangfuseClient {
  settings: LangfuseSettings;
  fetch: typeof fetch;
}

export interface ReviewQueueIds {
  queueId: string;
  verdictConfigId: string;
}

/** A CORRECTION score, as the v3 scores API returns it. */
export interface CorrectionScore {
  name: string;
  dataType: "CORRECTION";
  value: string;
  source: string;
  timestamp: string;
}

/** A completed queue item, with what the reviewer set and what they reviewed. */
export interface CompletedReview {
  itemId: string;
  /** The reviewed generation. */
  observationId: string;
  completedAt: string | null;
  /** Undefined when no verdict was set, or its label is unknown. */
  verdict: Verdict | undefined;
  /** The Langfuse user who set the verdict, when known. */
  reviewer: string | undefined;
  /** The corrected output as typed (a JSON string), when there is one. */
  correction: string | undefined;
  /** Undefined when the generation cannot be read back. */
  generation: ReviewedGeneration | undefined;
}

/** What the reviewed generation recorded (ADR-0012), and its run. */
export interface ReviewedGeneration {
  traceId: string;
  runId: string | undefined;
  documentId: string | undefined;
  promptVersion: string | undefined;
  /** The source text the model read. */
  source: string | undefined;
  /** The extracted invoice, as recorded; not validated here. */
  output: unknown;
}

const PAGE_LIMIT = 100;
/** A review request that takes longer is abandoned (and logged). */
const REQUEST_TIMEOUT_MS = 5000;

async function call<T>(
  client: LangfuseClient,
  path: string,
  init: {
    method?: string;
    body?: unknown;
    query?: Record<string, string>;
  } = {},
): Promise<T> {
  const url = new URL(path, client.settings.baseUrl);
  for (const [key, value] of Object.entries(init.query ?? {})) {
    url.searchParams.set(key, value);
  }
  const response = await client.fetch(url, {
    method: init.method ?? "GET",
    headers: {
      Authorization: basicAuth(client.settings),
      ...(init.body === undefined
        ? {}
        : { "Content-Type": "application/json" }),
    },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(
      `Langfuse answered ${response.status} for ${init.method ?? "GET"} ${url.pathname}: ${await response.text()}`,
    );
  }
  return (await response.json()) as T;
}

/** Every row of a page-numbered list (score configs, queues, queue items). */
async function allPages<T>(
  client: LangfuseClient,
  path: string,
  query: Record<string, string> = {},
): Promise<T[]> {
  const rows: T[] = [];
  for (let page = 1; ; page++) {
    const result = await call<{ data: T[]; meta: { totalPages: number } }>(
      client,
      path,
      { query: { ...query, page: String(page), limit: String(PAGE_LIMIT) } },
    );
    rows.push(...result.data);
    if (page >= (result.meta.totalPages ?? 1) || result.data.length === 0) {
      return rows;
    }
  }
}

/** Every row of a cursor-paged list (v3 scores). */
async function allCursorPages<T>(
  client: LangfuseClient,
  path: string,
  query: Record<string, string>,
): Promise<T[]> {
  const rows: T[] = [];
  let cursor: string | undefined;
  do {
    const result = await call<{ data: T[]; meta: { cursor?: string } }>(
      client,
      path,
      {
        query: {
          ...query,
          limit: String(PAGE_LIMIT),
          ...(cursor ? { cursor } : {}),
        },
      },
    );
    rows.push(...result.data);
    cursor = result.meta.cursor;
  } while (cursor);
  return rows;
}

/**
 * Finds the `invariant-review` queue and its `verdict` config by name, and
 * creates whichever is missing. Queues and configs cannot be deleted through
 * the API, so they are looked up before anything is created.
 */
export async function ensureReviewQueue(
  client: LangfuseClient,
): Promise<ReviewQueueIds> {
  const configs = await allPages<{
    id: string;
    name: string;
    dataType: string;
    isArchived?: boolean;
  }>(client, "/api/public/score-configs");
  const existing = configs.find(
    (c) =>
      c.name === VERDICT_CONFIG_NAME &&
      c.dataType === "CATEGORICAL" &&
      !c.isArchived,
  );
  const verdictConfigId =
    existing?.id ??
    (
      await call<{ id: string }>(client, "/api/public/score-configs", {
        method: "POST",
        body: {
          name: VERDICT_CONFIG_NAME,
          dataType: "CATEGORICAL",
          categories: VERDICTS.map((label, value) => ({ label, value })),
          description:
            "correct: the extraction matches the document. corrected: it did not; the corrected output holds the invoice as printed (integer cents). unusable: the document cannot be used.",
        },
      })
    ).id;
  const queues = await allPages<{ id: string; name: string }>(
    client,
    "/api/public/annotation-queues",
  );
  const queueId =
    queues.find((q) => q.name === REVIEW_QUEUE_NAME)?.id ??
    (
      await call<{ id: string }>(client, "/api/public/annotation-queues", {
        method: "POST",
        body: {
          name: REVIEW_QUEUE_NAME,
          description:
            "Invoices that failed a business rule. Set the verdict; when it is 'corrected', edit the corrected output (see docs/review.md).",
          scoreConfigIds: [verdictConfigId],
        },
      })
    ).id;
  return { queueId, verdictConfigId };
}

/**
 * Adds a generation to the review queue, unless it is already there (Langfuse
 * would add the same object twice). Returns the item and whether it is new.
 */
export async function enqueueForReview(
  client: LangfuseClient,
  target: GenerationRef,
  ids?: ReviewQueueIds,
): Promise<{ queueId: string; itemId: string; created: boolean }> {
  const { queueId } = ids ?? (await ensureReviewQueue(client));
  const path = `/api/public/annotation-queues/${encodeURIComponent(queueId)}/items`;
  const items = await allPages<{ id: string; objectId: string }>(client, path);
  const existing = items.find((i) => i.objectId === target.observationId);
  if (existing) return { queueId, itemId: existing.id, created: false };
  const created = await call<{ id: string }>(client, path, {
    method: "POST",
    body: { objectId: target.observationId, objectType: "OBSERVATION" },
  });
  return { queueId, itemId: created.id, created: true };
}

/**
 * The correction to use among several (the API does not keep one per object):
 * the reviewer's annotation first, then the latest.
 */
export function pickCorrection(
  scores: readonly CorrectionScore[],
): CorrectionScore | undefined {
  const byLatest = [...scores].sort((a, b) =>
    b.timestamp.localeCompare(a.timestamp),
  );
  return byLatest.find((s) => s.source === "ANNOTATION") ?? byLatest[0];
}

function parseJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function metadataValue(
  metadata: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  const value =
    metadata?.[`attributes.mastra.metadata.${key}`] ?? metadata?.[key];
  return typeof value === "string" ? value : undefined;
}

async function readGeneration(
  client: LangfuseClient,
  observationId: string,
): Promise<ReviewedGeneration | undefined> {
  const { data } = await call<{
    data: {
      id: string;
      traceId: string;
      input: unknown;
      output: unknown;
      metadata?: Record<string, unknown>;
    }[];
  }>(client, "/api/public/v2/observations", {
    query: {
      fields: "core,basic,metadata,io",
      filter: JSON.stringify([
        { type: "string", column: "id", operator: "=", value: observationId },
      ]),
    },
  });
  const observation = data.find((o) => o.id === observationId);
  if (!observation) return undefined;
  const input = parseJson(observation.input) as
    | { promptVersion?: unknown; source?: unknown }
    | undefined;
  return {
    traceId: observation.traceId,
    runId: metadataValue(observation.metadata, "runId"),
    documentId: metadataValue(observation.metadata, "documentId"),
    promptVersion:
      metadataValue(observation.metadata, "promptVersion") ??
      (typeof input?.promptVersion === "string"
        ? input.promptVersion
        : undefined),
    source: typeof input?.source === "string" ? input.source : undefined,
    output: parseJson(observation.output),
  };
}

interface ScoreRow {
  name: string;
  dataType: string;
  value: unknown;
  source: string;
  timestamp: string;
  configId?: string | null;
  authorUserId?: string | null;
  subject?: { kind?: string; id?: string; traceId?: string | null };
}

/**
 * Every completed item of the review queue, joined with the verdict and the
 * corrected output set on its generation (or on its trace), and with what the
 * generation recorded: run and document ids, prompt version, source text and
 * extracted invoice. Pending items are left out.
 */
export async function listCompletedReviews(
  client: LangfuseClient,
  ids?: ReviewQueueIds,
): Promise<CompletedReview[]> {
  const { queueId, verdictConfigId } = ids ?? (await ensureReviewQueue(client));
  const items = await allPages<{
    id: string;
    objectId: string;
    objectType: string;
    completedAt?: string | null;
  }>(
    client,
    `/api/public/annotation-queues/${encodeURIComponent(queueId)}/items`,
    {
      status: "COMPLETED",
    },
  );
  const reviews: CompletedReview[] = [];
  for (const item of items) {
    if (item.objectType !== "OBSERVATION") continue;
    const generation = await readGeneration(client, item.objectId);
    const scores = generation
      ? await allCursorPages<ScoreRow>(client, "/api/public/v3/scores", {
          traceId: generation.traceId,
          name: `${VERDICT_CONFIG_NAME},${CORRECTION_SCORE_NAME}`,
          fields: "details,subject,annotation",
        })
      : [];
    const onItem = scores.filter(
      (s) =>
        s.subject?.id === item.objectId ||
        (s.subject?.kind === "trace" && s.subject.id === generation?.traceId),
    );
    const verdictScore = onItem
      .filter(
        (s) =>
          s.name === VERDICT_CONFIG_NAME &&
          (s.configId === verdictConfigId || s.configId == null),
      )
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp))[0];
    const verdict = (VERDICTS as readonly unknown[]).includes(
      verdictScore?.value,
    )
      ? (verdictScore?.value as Verdict)
      : undefined;
    const correction = pickCorrection(
      onItem
        .filter(
          (s) =>
            s.name === CORRECTION_SCORE_NAME && s.dataType === "CORRECTION",
        )
        .map((s) => ({ ...s, dataType: "CORRECTION", value: String(s.value) })),
    );
    reviews.push({
      itemId: item.id,
      observationId: item.objectId,
      completedAt: item.completedAt ?? null,
      verdict,
      reviewer: verdictScore?.authorUserId ?? undefined,
      correction: correction?.value,
      generation,
    });
  }
  return reviews;
}

/** Queues paused generations from a workflow; created only when tracing is on. */
export interface ReviewQueueSink {
  /** Queues one generation in the background. Never throws, never waits. */
  enqueue(target: GenerationRef): void;
  /** Waits for every enqueue so far; call it before the process exits. */
  flush(): Promise<void>;
}

/**
 * The review queue as the workflow uses it: enqueues run in the background, a
 * Langfuse failure is logged and never reaches the run, and the queue and
 * config are looked up once per process. Undefined when tracing is off.
 */
export function createReviewQueue(
  env: Env,
  options: { fetch?: typeof fetch; warn?: (message: string) => void } = {},
): ReviewQueueSink | undefined {
  const settings = langfuseSettings(env);
  if (!settings) return undefined;
  const client: LangfuseClient = { settings, fetch: options.fetch ?? fetch };
  const warn =
    options.warn ?? ((message) => console.warn(`[observability] ${message}`));
  let ids: Promise<ReviewQueueIds> | undefined;
  const pending = new Set<Promise<void>>();
  return {
    enqueue(target) {
      ids ??= ensureReviewQueue(client);
      const request = ids
        .then((found) => enqueueForReview(client, target, found))
        .then(
          () => undefined,
          (error: unknown) => {
            ids = undefined; // look the queue up again next time
            warn(
              `generation ${target.observationId} was not queued for review: ${String(error)}`,
            );
          },
        );
      pending.add(request);
      void request.finally(() => pending.delete(request));
    },
    async flush() {
      while (pending.size > 0) await Promise.allSettled([...pending]);
    },
  };
}
