/**
 * The keys the local Langfuse stack creates on its first start
 * (infra/langfuse/docker-compose.yml). Local-only, like the other stacks'
 * credentials; override them with LANGFUSE_PUBLIC_KEY / LANGFUSE_SECRET_KEY.
 */
export const LOCAL_PUBLIC_KEY = "pk-lf-invariant-local-only";
export const LOCAL_SECRET_KEY = "sk-lf-invariant-local-only";

export interface LangfuseSettings {
  baseUrl: string;
  publicKey: string;
  secretKey: string;
}

export type Env = Readonly<Record<string, string | undefined>>;

/**
 * Tracing is opt-in (ADR-0011): on only when LANGFUSE_BASE_URL is set.
 * Returns undefined otherwise, and callers then register nothing.
 */
export function langfuseSettings(env: Env): LangfuseSettings | undefined {
  const baseUrl = env.LANGFUSE_BASE_URL;
  if (!baseUrl) return undefined;
  return {
    baseUrl,
    publicKey: env.LANGFUSE_PUBLIC_KEY || LOCAL_PUBLIC_KEY,
    secretKey: env.LANGFUSE_SECRET_KEY || LOCAL_SECRET_KEY,
  };
}
