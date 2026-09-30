import type { ReportObservation } from "./report.js";
import type { LangfuseSettings } from "./settings.js";

interface ObservationsPage {
  data: ReportObservation[];
  meta: { cursor?: string };
}

/**
 * Reads every observation of an environment in a time window through the
 * Langfuse v4 public API (`GET /api/public/v2/observations`, cursor paging).
 * The v1 traces endpoint is not available on v4 deployments, so traces are
 * rebuilt from observations: roots and workflow runs give the trace, the
 * GENERATION observations give model, cost and prompt version.
 */
export async function fetchObservations(
  settings: LangfuseSettings,
  query: { environment: string; from: string; to?: string },
): Promise<ReportObservation[]> {
  const auth = Buffer.from(
    `${settings.publicKey}:${settings.secretKey}`,
  ).toString("base64");
  const observations: ReportObservation[] = [];
  let cursor: string | undefined;
  do {
    const url = new URL("/api/public/v2/observations", settings.baseUrl);
    url.searchParams.set("environment", query.environment);
    url.searchParams.set("fromStartTime", query.from);
    if (query.to) url.searchParams.set("toStartTime", query.to);
    url.searchParams.set("fields", "core,basic,metadata,model,usage");
    url.searchParams.set("limit", "1000");
    if (cursor) url.searchParams.set("cursor", cursor);
    const response = await fetch(url, {
      headers: { Authorization: `Basic ${auth}` },
    });
    if (!response.ok) {
      throw new Error(
        `Langfuse answered ${response.status} for ${url.pathname}: ${await response.text()}`,
      );
    }
    const page = (await response.json()) as ObservationsPage;
    observations.push(...page.data);
    cursor = page.meta.cursor;
  } while (cursor);
  return observations;
}
