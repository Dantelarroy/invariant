import { LangfuseClient } from "@langfuse/client";
import { type Env, langfuseSettings } from "./settings.js";

/**
 * A prompt version defined in code (the extractor's PromptDefinition fits).
 * Langfuse holds it under the family `name` as version `version` (ADR-0012).
 */
export interface PromptDefinition {
  readonly name: string;
  readonly version: number;
  readonly text: string;
}

/** The Langfuse prompt a generation used: its family and version. */
export interface PromptLink {
  name: string;
  version: number;
}

/** The text to send, and the registry prompt to link, if the registry served it. */
export interface ResolvedPrompt {
  text: string;
  link: PromptLink | undefined;
}

/** The part of `LangfuseClient.prompt` the resolver uses (tests pass a fake). */
export interface PromptSource {
  get(
    name: string,
    options: {
      type: "text";
      version: number;
      fallback: string;
      fetchTimeoutMs: number;
      maxRetries: number;
    },
  ): Promise<{ prompt: string; version: number; isFallback: boolean }>;
}

export type PromptResolver = (
  prompt: PromptDefinition,
) => Promise<ResolvedPrompt>;

/** A slow or absent registry costs a run at most this long, once per version. */
const FETCH_TIMEOUT_MS = 2000;

const local = (prompt: PromptDefinition): ResolvedPrompt => ({
  text: prompt.text,
  link: undefined,
});

/**
 * Resolves the prompt version the code pins (ADR-0012). Git is the source of
 * truth; Langfuse is a registry that links generations to their prompt:
 * - tracing off: the local text, and no network call;
 * - the registry serves the version: the local text, linked to it. If the
 *   registry's text differs (someone edited it), a drift warning is logged and
 *   the local text still wins;
 * - the registry is down, slow or lacks the version: the local text, unlinked.
 *
 * Each version is asked for once per resolver, so a process pays the timeout
 * at most once. Never throws.
 */
export function createPromptResolver(
  env: Env,
  options: { source?: PromptSource; warn?: (message: string) => void } = {},
): PromptResolver {
  const settings = langfuseSettings(env);
  if (!settings) return async (prompt) => local(prompt);
  const warn =
    options.warn ?? ((message) => console.warn(`[observability] ${message}`));
  let source = options.source;
  const cache = new Map<string, Promise<ResolvedPrompt>>();

  async function fetchPrompt(
    prompt: PromptDefinition,
  ): Promise<ResolvedPrompt> {
    const id = `${prompt.name} v${prompt.version}`;
    try {
      source ??= new LangfuseClient(settings).prompt;
      const served = await source.get(prompt.name, {
        type: "text",
        version: prompt.version,
        fallback: prompt.text,
        fetchTimeoutMs: FETCH_TIMEOUT_MS,
        maxRetries: 0,
      });
      if (served.isFallback || served.version !== prompt.version) {
        warn(
          `prompt ${id} was not served by the registry (not seeded, or Langfuse unreachable); using the local text`,
        );
        return local(prompt);
      }
      if (served.prompt !== prompt.text) {
        warn(
          `prompt ${id} differs in the registry; using the local text (git wins)`,
        );
      }
      return {
        text: prompt.text,
        link: { name: prompt.name, version: prompt.version },
      };
    } catch (error) {
      warn(
        `prompt ${id} could not be fetched (${String(error)}); using the local text`,
      );
      return local(prompt);
    }
  }

  return (prompt) => {
    const key = `${prompt.name}@${prompt.version}`;
    let resolved = cache.get(key);
    if (!resolved) {
      resolved = fetchPrompt(prompt);
      cache.set(key, resolved);
    }
    return resolved;
  };
}
