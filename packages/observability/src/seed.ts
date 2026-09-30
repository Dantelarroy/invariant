import type { PromptDefinition } from "./prompts.js";

/** What the seed does with one prompt version defined in code. */
export interface SeedAction {
  action: "skip" | "create";
  prompt: PromptDefinition;
}

/** Either every action to take, or why nothing may be written. */
export type SeedPlan =
  | { ok: true; actions: SeedAction[] }
  | { ok: false; errors: string[] };

/**
 * Plans `pnpm prompts:seed` (ADR-0012). Pure: `remote` is what the registry
 * already holds. Families are planned in name order, versions in number order:
 * - a registered version with the same text is skipped;
 * - a registered version with other text is drift;
 * - a missing version is created only when Langfuse would give it that number,
 *   i.e. it follows the family's highest version (Langfuse numbers each new
 *   version itself and never deduplicates).
 *
 * Any error fails the whole plan, so a failing seed writes nothing.
 */
export function planSeed(
  local: readonly PromptDefinition[],
  remote: readonly PromptDefinition[],
): SeedPlan {
  const errors: string[] = [];
  const actions: SeedAction[] = [];
  const families = [...new Set(local.map((prompt) => prompt.name))].sort();
  for (const name of families) {
    const versions = local
      .filter((prompt) => prompt.name === name)
      .sort((a, b) => a.version - b.version);
    const registered = remote.filter((prompt) => prompt.name === name);
    let highest = Math.max(0, ...registered.map((prompt) => prompt.version));
    let previous: number | undefined;
    for (const prompt of versions) {
      const id = `${name} version ${prompt.version}`;
      if (prompt.version === previous) {
        errors.push(`prompt ${id} is defined twice in code`);
        continue;
      }
      previous = prompt.version;
      const existing = registered.find((r) => r.version === prompt.version);
      if (existing) {
        if (existing.text === prompt.text) {
          actions.push({ action: "skip", prompt });
        } else {
          errors.push(
            `prompt ${id} differs between Langfuse and the code (${name}-v${prompt.version}); a changed prompt needs a new version`,
          );
        }
        continue;
      }
      if (prompt.version !== highest + 1) {
        errors.push(
          `prompt ${id} cannot be created: Langfuse would register it as version ${highest + 1}`,
        );
        continue;
      }
      actions.push({ action: "create", prompt });
      highest = prompt.version;
    }
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, actions };
}
