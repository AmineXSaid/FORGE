/**
 * Handler 类型定义
 *
 * 所有 handler 应遵循统一签名，便于路由和复用
 */

import { ILogService } from '../../logService';
import { IConfigurationService } from '../../configurationService';
import { IWorkspaceService } from '../../workspaceService';
import { IFileSystemService } from '../../fileSystemService';
import { INotificationService } from '../../notificationService';
import { ITerminalService } from '../../terminalService';
import { ITabsAndEditorsService } from '../../tabsAndEditorsService';
import { IClaudeSessionService } from '../ClaudeSessionService';
import { IClaudeSdkService } from '../ClaudeSdkService';
import { IClaudeAgentService } from '../ClaudeAgentService';
import { IWebViewService } from '../../webViewService';
import { IEndpointService } from '../../endpoints/endpointService';
import { IEndpointHealthService } from '../../endpoints/health';

/**
 * Handler 上下文
 * 包含所有必要的服务接口，禁止直接使用 VS Code 原生 API
 */
export interface HandlerContext {
    logService: ILogService;
    configService: IConfigurationService;
    workspaceService: IWorkspaceService;
    fileSystemService: IFileSystemService;
    notificationService: INotificationService;
    terminalService: ITerminalService;
    tabsAndEditorsService: ITabsAndEditorsService;
    sessionService: IClaudeSessionService;
    sdkService: IClaudeSdkService;
    agentService: IClaudeAgentService;
    webViewService: IWebViewService;
    /**
     * Present so handlers can tell whether Forge is pointed at someone else's
     * gateway. With no profile active it reports nothing and every handler
     * behaves exactly as before.
     */
    endpointService: IEndpointService;
    /**
     * What the active endpoint's models did when they were last asked to serve.
     *
     * Optional so the many specs that build a context by hand keep compiling:
     * every read here is "no record", which is the same answer a profile that
     * has never been swept gives, and that path is the one that falls back to
     * the gateway's own listing.
     */
    endpointHealthService?: IEndpointHealthService;
}

/**
 * Handler 函数类型
 */
export type HandlerFunction<TRequest = any, TResponse = any> = (
    request: TRequest,
    context: HandlerContext,
    signal?: AbortSignal
) => Promise<TResponse>;
