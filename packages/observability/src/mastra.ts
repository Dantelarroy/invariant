import type { ObservabilityExporter } from "@mastra/core/observability";
import { LangfuseExporter } from "@mastra/langfuse";
import { Observability } from "@mastra/observability";
import { type Env, langfuseSettings } from "./settings.js";

const SERVICE_NAME = "invariant";

/** A Mastra observability config sending spans to the given exporters. */
export function observabilityWith(
  exporters: ObservabilityExporter[],
): Observability {
  return new Observability({
    configs: { invariant: { serviceName: SERVICE_NAME, exporters } },
  });
}

/**
 * The Mastra observability config for the local Langfuse, or undefined when
 * tracing is off (no LANGFUSE_BASE_URL). The exporter logs export errors and
 * never throws them into a run.
 */
export function createObservability(
  env: Env,
  options: { environment: string },
): Observability | undefined {
  const settings = langfuseSettings(env);
  if (!settings) return undefined;
  return observabilityWith([
    new LangfuseExporter({
      // Always explicit: the exporter's default is Langfuse Cloud.
      baseUrl: settings.baseUrl,
      publicKey: settings.publicKey,
      secretKey: settings.secretKey,
      environment: options.environment,
    }),
  ]);
}
