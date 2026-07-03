// Shared, in-process record of what the backing agent's dynamic instructions
// and dynamic tool observed for `requestContext.get("tenantId")` on the most
// recent run, keyed by the path used to reach the agent.
//
// This is the observable that makes the KEY assertion (tenant visible vs
// MISSING) independent of the LLM: the dynamic-instructions function and the
// tool both read requestContext *before/around* any model output, so we do not
// need a successful model completion to detect the propagation gap.

export type Observation = {
  /** tenantId the dynamic *instructions* function saw, or null. */
  instructionsTenant: string | null;
  /** tenantId the dynamic *tool* saw, or null (undefined if tool never ran). */
  toolTenant: string | null | undefined;
};

const observations = new Map<string, Observation>();

export function recordInstructionsTenant(channel: string, tenant: string | null): void {
  const prev = observations.get(channel) ?? { instructionsTenant: null, toolTenant: undefined };
  observations.set(channel, { ...prev, instructionsTenant: tenant });
}

export function recordToolTenant(channel: string, tenant: string | null): void {
  const prev = observations.get(channel) ?? { instructionsTenant: null, toolTenant: undefined };
  observations.set(channel, { ...prev, toolTenant: tenant });
}

export function getObservation(channel: string): Observation | undefined {
  return observations.get(channel);
}

export function resetObservation(channel: string): void {
  observations.delete(channel);
}
