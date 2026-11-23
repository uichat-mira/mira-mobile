/**
 * Local Agent Loop engine selection.
 *
 * `mobile` is the production path and remains the default. `pi-core` is the
 * isolated Pi Agent Core bridge used for developer evaluation and the one-off
 * Android acceptance build; it is not exposed as a user-facing setting.
 *
 * Change this constant only for an explicitly authorized Pi acceptance build.
 */
export type LocalAgentEngine = 'mobile' | 'pi-core';

export const LOCAL_AGENT_ENGINE: LocalAgentEngine = 'mobile';
