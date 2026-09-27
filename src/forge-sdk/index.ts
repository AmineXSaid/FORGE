/**
 * The Forge SDK: what Forge adds on top of the Claude Agent SDK and the
 * Claude Code CLI, with no editor in it. The VS Code extension is one host of
 * it; anything that runs the CLI can be another.
 *
 * Rule (enforced by test/forgeSdkLayer.spec.ts): nothing under src/forge-sdk
 * imports `vscode` or anything in src/services. Hosts inject what only they
 * have -- a diagnostics source, a way to tell the user a turn was stopped.
 */
export { GUARD_LEVELS, resolveGuardLevel, type GuardLevel } from './guards/levels';
export { createGuardHooks, merge, stepCapMessage, type GuardHookDeps, type GuardHookInput, type GuardHooks } from './guards/guardHooks';
export { EditDiagnostics } from './guards/editDiagnostics';
export { cliGuardSettings, GUARD_HOOK_EVENTS, GUARD_HOOK_TIMEOUT_S, HOOK_TOKEN_ENV } from './cli/cliGuardSettings';
export { MAX_HOOK_BODY_BYTES, startGuardHookServer, type GuardHookHandler, type GuardHookServer } from './cli/guardHookServer';
export { prepareCliGuards, type CliGuardLaunch, type CliGuardOptions } from './cli/cliGuards';
