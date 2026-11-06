import type { AgentModel } from "./agent-interview";

/**
 * Tries each configured provider in order and falls through on failure, so one provider's
 * outage or exhausted quota doesn't strand the agent: it only shows as "busy" when every
 * configured provider has failed on that same turn.
 *
 * This is deliberately a runtime failover, not a startup pick. `createXAgentModel` returning
 * a function only means a key is present, not that the provider will actually answer — a key
 * can exist and still be out of quota for the day. Picking "whichever has a key" at startup
 * and never looking again is what let an exhausted provider block every later turn.
 */
export function composeAgentModels(...models: (AgentModel | undefined)[]): AgentModel | undefined {
  const configured = models.filter((model): model is AgentModel => model !== undefined);
  if (configured.length === 0) return undefined;
  if (configured.length === 1) return configured[0];

  return async (request) => {
    let lastError: unknown;
    for (const model of configured) {
      try {
        return await model(request);
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError;
  };
}
