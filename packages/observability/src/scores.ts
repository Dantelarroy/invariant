import { RULES, type VerificationResult } from "@invariant/rules";
import { basicAuth } from "./langfuse-api.js";
import { type Env, langfuseSettings } from "./settings.js";
import type { GenerationRef } from "./spans.js";

/** A score as `POST /api/public/scores` takes it. */
export interface ScoreBody {
  id: string;
  traceId: string;
  observationId: string;
  name: string;
  value: number;
  dataType: "BOOLEAN" | "NUMERIC";
  comment?: string;
  metadata?: Record<string, unknown>;
  environment: string;
}

/** Sends rule results as Langfuse scores; created only when tracing is on. */
export interface ScoreSink {
  /** Scores one verified generation. Fire-and-forget: never throws, never waits. */
  ruleScores(target: GenerationRef, verification: VerificationResult): void;
  /** Waits for every score sent so far; call it before the process exits. */
  flush(): Promise<void>;
}

/** A score request that takes longer is abandoned (and logged). */
const REQUEST_TIMEOUT_MS = 5000;

/**
 * The scores of one verified generation (ADR-0012): `rule.<id>` per rule
 * (BOOLEAN, 1 when it held; violation messages as comment, severity and
 * details as metadata), `rules.score` (NUMERIC, 0..1) and `rules.valid`
 * (BOOLEAN, no error rule failed). Ids are `<observationId>-<name>`, so
 * sending them again updates them.
 */
export function ruleScoreBodies(
  target: GenerationRef,
  verification: VerificationResult,
  environment: string,
): ScoreBody[] {
  const score = (
    name: string,
    value: number,
    dataType: ScoreBody["dataType"],
    extra: Pick<ScoreBody, "comment" | "metadata"> = {},
  ): ScoreBody => ({
    id: `${target.observationId}-${name}`,
    traceId: target.traceId,
    observationId: target.observationId,
    name,
    value,
    dataType,
    ...extra,
    environment,
  });
  const perRule = RULES.map((rule) => {
    const violations = verification.violations.filter(
      (v) => v.ruleId === rule.id,
    );
    if (violations.length === 0) {
      return score(`rule.${rule.id}`, 1, "BOOLEAN", {
        metadata: { severity: rule.severity },
      });
    }
    return score(`rule.${rule.id}`, 0, "BOOLEAN", {
      comment: violations.map((v) => v.message).join("\n"),
      metadata: {
        severity: rule.severity,
        details: violations.map((v) => ({
          ...(v.path === undefined ? {} : { path: v.path }),
          ...v.details,
        })),
      },
    });
  });
  return [
    ...perRule,
    score("rules.score", verification.score, "NUMERIC"),
    score("rules.valid", verification.valid ? 1 : 0, "BOOLEAN"),
  ];
}

/**
 * Posts rule scores to the Langfuse public API. Mastra's own score path only
 * sends NUMERIC scores, so booleans go over plain `fetch`, authenticated like
 * the report. Failures are logged and never reach the run; `flush()` awaits
 * whatever is still in flight. Returns undefined when tracing is off.
 * `options.fetch` replaces the global fetch (tests).
 */
export function createScoreSink(
  env: Env,
  options: {
    environment: string;
    fetch?: typeof fetch;
    warn?: (message: string) => void;
  },
): ScoreSink | undefined {
  const settings = langfuseSettings(env);
  if (!settings) return undefined;
  const send = options.fetch ?? fetch;
  const warn =
    options.warn ?? ((message) => console.warn(`[observability] ${message}`));
  const url = new URL("/api/public/scores", settings.baseUrl).toString();
  const authorization = basicAuth(settings);
  const pending = new Set<Promise<void>>();

  /** Sends one score; resolves with why it failed, or undefined. */
  async function post(body: ScoreBody): Promise<string | undefined> {
    try {
      const response = await send(url, {
        method: "POST",
        headers: {
          Authorization: authorization,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!response.ok) {
        return `${body.name} refused (${response.status}): ${await response.text()}`;
      }
      return undefined;
    } catch (error) {
      return `${body.name}: ${String(error)}`;
    }
  }

  return {
    ruleScores(target, verification) {
      try {
        const bodies = ruleScoreBodies(
          target,
          verification,
          options.environment,
        );
        // One warning per generation, not one per score, when Langfuse is down.
        const request = Promise.all(bodies.map(post)).then((results) => {
          const failures = results.filter((r) => r !== undefined);
          if (failures.length > 0) {
            warn(
              `${failures.length} of ${bodies.length} scores of ${target.observationId} were not sent; first: ${failures[0]}`,
            );
          }
        });
        pending.add(request);
        void request.finally(() => pending.delete(request));
      } catch (error) {
        warn(`rule scores could not be built: ${String(error)}`);
      }
    },
    async flush() {
      while (pending.size > 0) await Promise.allSettled([...pending]);
    },
  };
}
