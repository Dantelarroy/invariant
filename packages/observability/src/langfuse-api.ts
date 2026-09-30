import type { PromptDefinition } from "./prompts.js";
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

/** The Basic auth header of the public API: public key and secret key. */
export function basicAuth(settings: LangfuseSettings): string {
  return `Basic ${Buffer.from(`${settings.publicKey}:${settings.secretKey}`).toString("base64")}`;
}

async function request(
  settings: LangfuseSettings,
  path: string,
  init: {
    method?: string;
    body?: unknown;
    query?: Record<string, string>;
  } = {},
): Promise<Response> {
  const url = new URL(path, settings.baseUrl);
  for (const [key, value] of Object.entries(init.query ?? {})) {
    url.searchParams.set(key, value);
  }
  return fetch(url, {
    method: init.method ?? "GET",
    headers: {
      Authorization: basicAuth(settings),
      ...(init.body === undefined
        ? {}
        : { "Content-Type": "application/json" }),
    },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });
}

async function ok(response: Response, what: string): Promise<Response> {
  if (!response.ok) {
    throw new Error(
      `Langfuse answered ${response.status} for ${what}: ${await response.text()}`,
    );
  }
  return response;
}

/**
 * Every registered version of the given prompt families, with its text
 * (`GET /api/public/v2/prompts?name=`, then one read per version). Only text
 * prompts are expected; a family that does not exist yields nothing.
 */
export async function fetchPromptVersions(
  settings: LangfuseSettings,
  names: readonly string[],
): Promise<PromptDefinition[]> {
  const found: PromptDefinition[] = [];
  for (const name of names) {
    const listed = (await (
      await ok(
        await request(settings, "/api/public/v2/prompts", {
          query: { name, limit: "100" },
        }),
        `the ${name} prompt list`,
      )
    ).json()) as { data: { name: string; versions: number[] }[] };
    const versions = listed.data.find((p) => p.name === name)?.versions ?? [];
    for (const version of versions) {
      const prompt = (await (
        await ok(
          await request(
            settings,
            `/api/public/v2/prompts/${encodeURIComponent(name)}`,
            { query: { version: String(version) } },
          ),
          `${name} version ${version}`,
        )
      ).json()) as { prompt: unknown };
      if (typeof prompt.prompt !== "string") {
        throw new Error(
          `prompt ${name} version ${version} is not a text prompt`,
        );
      }
      found.push({ name, version, text: prompt.prompt });
    }
  }
  return found;
}

/**
 * Registers a new version of a text prompt (`POST /api/public/v2/prompts`).
 * Langfuse numbers it itself (the family's next version) and returns it.
 */
export async function createPromptVersion(
  settings: LangfuseSettings,
  prompt: PromptDefinition,
): Promise<number> {
  const id = `${prompt.name}-v${prompt.version}`;
  const created = (await (
    await ok(
      await request(settings, "/api/public/v2/prompts", {
        method: "POST",
        body: {
          name: prompt.name,
          type: "text",
          prompt: prompt.text,
          labels: [],
          tags: ["invariant"],
          config: { promptVersion: id },
          commitMessage: `Seeded from git (${id})`,
        },
      }),
      `creating ${id}`,
    )
  ).json()) as { version: number };
  return created.version;
}
