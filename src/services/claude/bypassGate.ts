/**
 * Whether Claude Code will refuse bypass permissions in this environment.
 *
 * Found in a Dev Container (2026-09-25): VS Code Server runs as root there.
 * Picking "Bypass permissions" asked Forge to turn on
 * `forge.allowDangerouslySkipPermissions`, and from then on every launch
 * passed `allowDangerouslySkipPermissions`. The CLI exited at once:
 * "--dangerously-skip-permissions cannot be used with root/sudo privileges for
 * security reasons". That happened in Manual mode too, so no session could
 * start.
 *
 * The rule, ported from the Claude Code 2.1.274 binary:
 *
 *   function i(s){return s?.permissionMode==="bypassPermissions"||s?.allowBypass===!0}
 *   function l(s){if(!i(s))return;if(Xb.isRootOutsideDeliberateSandbox())
 *     console.error("--dangerously-skip-permissions cannot be used with root/sudo privileges for security reasons"),process.exit(1)}
 *   isRootOutsideDeliberateSandbox(){return this.sources.platform!=="win32"&&this.sources.getuid()===0
 *     &&!this.sources.isSandboxEnvSet()&&!this.sources.isBubblewrapEnvSet()}
 *   isSandboxEnvSet:()=>process.env.IS_SANDBOX==="1"
 *   isBubblewrapEnvSet:()=>a.CLAUDE_CODE_BUBBLEWRAP
 *
 * The allow option alone is enough to trip it, so where it applies Forge
 * neither passes the option nor offers the row. The CLI refuses them anyway.
 */

/** Why bypass is unavailable, as the webview and the log say it. */
export const BYPASS_REFUSED_AS_ROOT =
    'Claude Code refuses bypass permissions when it runs as root, as VS Code does in most Dev Containers. ' +
    'Run the container as a non-root user (remoteUser in devcontainer.json) to use it.';

/**
 * The CLI's `isRootOutsideDeliberateSandbox`, over the environment the CLI will
 * get. `uid` is `process.getuid?.()`, which is undefined on Windows.
 */
export function cliRefusesBypass(
    platform: NodeJS.Platform,
    uid: number | undefined,
    env: Readonly<Record<string, string | undefined>>
): boolean {
    return platform !== 'win32' && uid === 0 && env.IS_SANDBOX !== '1' && !env.CLAUDE_CODE_BUBBLEWRAP;
}
