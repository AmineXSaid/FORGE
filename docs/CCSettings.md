# Claude Code Settings System Reference

> Claudix 扩展设置系统的完整参考文档。基于 [Claude Code 官方文档](https://code.claude.com/docs/en/settings) 整理。

---

## 1. 配置系统架构

### 1.1 Scope 层级（优先级从高到低）

| Scope | 位置 | 影响范围 | 团队共享 |
|-------|------|---------|---------|
| **Managed** | 系统目录 `managed-settings.json` | 所有用户（企业 IT 部署） | Yes |
| **CLI** | 命令行参数 `--model`, `--model-provider` 等 | 当前会话 | No |
| **Local** | `.claude/settings.local.json`（项目目录） | 当前用户，当前项目 | No (gitignored) |
| **Project (Shared)** | `.claude/settings.json`（项目目录） | 所有协作者 | Yes (git) |
| **User (Global)** | `~/.claude/settings.json` 或 `~/.claude/settings.{profile}.json` | 当前用户，所有项目 | No |
| **Default** | 内置默认值 | 所有人 | — |

**系统目录路径：**
- macOS: `/Library/Application Support/ClaudeCode/`
- Linux: `/etc/claude-code/`
- Windows: `C:\Program Files\ClaudeCode\`

### 1.2 三条数据管道

Claudix 扩展需要维护三条独立的数据管道：

```
管道 A: CC Settings (settings.json 文件族)
  ├── 写入: updateSetting(key, value, scope)
  ├── 读取: getSettings() / inspect(key)
  └── 覆盖 Tab: General / Models / Agent / Permissions / Hooks
                 / Sandbox / Network / Environments

管道 B: Extension Config (~/.claudix.json)
  ├── 写入: updateExtensionConfig(key, value)
  ├── 读取: getExtensionConfig()
  └── 覆盖 Tab: Profiles (activeProfile), Models (customModels),
                 General (systemNotifications, completionSound)

管道 C: MCP Config (~/.claude.json + .mcp.json)
  ├── 写入: CLI 命令 (claude mcp add/remove) 或直接操作文件
  ├── 读取: 解析 ~/.claude.json 和 .mcp.json
  └── 覆盖 Tab: MCP Servers (服务器列表的增删改)
  └── 注意: MCP 的策略控制 (enabledMcpjsonServers 等) 走管道 A
```

### 1.3 影子配置 (Shadow Config)

```
~/.claude/claudix.json = 当前活跃 Profile 的 settings.json 的副本
通过 --settings 参数传给 SDK CLI
纯实现细节，UI 层不直接感知
```

---

## 2. Settings Keys 完整清单

### 2.1 Core Settings

| Key | 类型 | 描述 | 示例值 | 归属 Tab |
|-----|------|------|-------|---------|
| `model` | string | 覆盖默认模型（alias 或完整 model ID） | `"opus"`, `"claude-sonnet-4-5-20250929"` | Models |
| `effortLevel` | `"low" \| "medium" \| "high"` | Opus 4.6 adaptive reasoning effort | `"high"` | Models |
| `alwaysThinkingEnabled` | boolean | 默认启用 extended thinking | `true` | Models |
| `language` | string | Claude 响应语言偏好 | `"japanese"` | General |
| `outputStyle` | string | 输出风格调整 | `"Explanatory"` | Agent |
| `agent` | string | 指定 agent | — | Agent |
| `apiKeyHelper` | string | 自定义脚本生成 auth 值 | `"/bin/generate_temp_api_key.sh"` | — (not offered: account auth is out of scope; the host refuses it) |
| `companyAnnouncements` | string[] | 启动公告（多条时随机显示） | `["Welcome message"]` | Memory & Rules |
| `attribution` | `{ commit?: string, pr?: string }` | Git commit/PR 归因自定义 | `{"commit": "Generated with Claude", "pr": ""}` | General |
| `includeCoAuthoredBy` | boolean | **Deprecated**: 使用 `attribution` 代替 | `false` | — |
| `cleanupPeriodDays` | number | 非活跃会话删除天数（0=立即） | `20` | General |
| `forceLoginMethod` | `"claudeai" \| "console"` | 限制登录类型 | `"claudeai"` | — (not offered: account auth is out of scope; the host refuses it) |
| `forceLoginOrgUUID` | string | 登录时自动选择组织 UUID | `"xxx-xxx"` | General |
| `autoUpdatesChannel` | `"stable" \| "latest"` | 更新通道 | `"stable"` | General |

### 2.2 UI & Experience Settings

| Key | 类型 | 描述 | 归属 Tab |
|-----|------|------|---------|
| `showTurnDuration` | boolean | 响应后显示 turn 耗时 | General |
| `spinnerTipsEnabled` | boolean | spinner 中显示提示 | General |
| `spinnerVerbs` | `{ mode: string, verbs: string[] }` | 自定义 spinner 动词 | General |
| `terminalProgressBarEnabled` | boolean | 终端进度条 | General |
| `prefersReducedMotion` | boolean | 减少 UI 动画（无障碍） | General |
| `statusLine` | `{ type: string, command: string }` | 自定义状态行 | Agent |
| `plansDirectory` | string | Plan 文件存储路径（相对项目） | Agent |
| `fileSuggestion` | `{ type: string, command: string }` | `@` 文件自动补全自定义脚本 | Agent |
| `respectGitignore` | boolean | 排除 .gitignore 匹配的文件 | Agent |
| `teammateMode` | `"auto" \| "in-process" \| "tmux"` | Agent team 显示模式 | Agent |

### 2.3 Permission Settings

```jsonc
{
  "permissions": {
    "allow": ["Bash(npm run lint)", "Bash(npm run test *)", "Read(~/.zshrc)"],
    "deny": ["Bash(curl *)", "Read(./.env)", "Read(./secrets/**)"],
    "ask": ["Bash(git push *)"],
    "defaultMode": "acceptEdits",           // 默认权限模式
    "additionalDirectories": ["../docs/"],  // 额外允许访问的目录
    "disableBypassPermissionsMode": "disable"
  }
}
```

**权限规则语法：** `Tool` 或 `Tool(specifier)`

| 规则 | 效果 |
|------|------|
| `Bash` | 所有 bash 命令 |
| `Bash(npm run *)` | 以 `npm run` 开头的命令 |
| `Read(./.env)` | 读取 .env 文件 |
| `Edit(./src/**)` | 编辑 src/ 下的文件 |
| `WebFetch(domain:example.com)` | 对 example.com 的 fetch 请求 |

**评估顺序：** Deny → Ask → Allow（首次匹配生效）

**归属 Tab：** Permissions

### 2.4 Hooks Settings

```jsonc
{
  "hooks": {
    "SessionStart": [{ "type": "command", "command": "echo session started" }],
    "SessionEnd": [...],
    "UserPromptSubmit": [...],
    "PreToolUse": [...],
    "PostToolUse": [...],
    "PostToolUseFailure": [...],
    "PermissionRequest": [...],
    "Stop": [...],
    "SubagentStart": [...],
    "SubagentStop": [...],
    "Notification": [...],
    "TeammateIdle": [...],
    "TaskCompleted": [...],
    "PreCompact": [...]
  },
  "disableAllHooks": false,
  "allowManagedHooksOnly": false   // Managed only
}
```

**支持 14 种生命周期事件。** 归属 Tab: Hooks

### 2.5 Sandbox Settings

```jsonc
{
  "sandbox": {
    "enabled": true,
    "autoAllowBashIfSandboxed": true,
    "excludedCommands": ["docker"],
    "allowUnsandboxedCommands": false,
    "enableWeakerNestedSandbox": false,
    "network": {
      "allowedDomains": ["github.com", "*.npmjs.org"],
      "allowUnixSockets": ["~/.ssh/agent-socket"],
      "allowAllUnixSockets": false,
      "allowLocalBinding": true,
      "httpProxyPort": 8080,
      "socksProxyPort": 1080
    }
  }
}
```

**归属 Tab：** Sandbox

### 2.6 MCP Server Policy Settings

| Key | 类型 | 描述 | Managed Only |
|-----|------|------|-------------|
| `enableAllProjectMcpServers` | boolean | 自动批准所有 `.mcp.json` 服务器 | No |
| `enabledMcpjsonServers` | string[] | 批准的 `.mcp.json` 服务器 | No |
| `disabledMcpjsonServers` | string[] | 拒绝的 `.mcp.json` 服务器 | No |
| `allowedMcpServers` | object[] | MCP 服务器允许列表 | **Yes** |
| `deniedMcpServers` | object[] | MCP 服务器拒绝列表 | **Yes** |

**归属 Tab：** MCP Servers

> **注意：** MCP 服务器的实际配置存储在 `~/.claude.json` 和 `.mcp.json` 中（管道 C），
> 上述 key 只是策略控制，存储在 settings.json 中（管道 A）。

### 2.7 Plugin Settings

```jsonc
{
  "enabledPlugins": {
    "formatter@acme-tools": true,
    "deployer@acme-tools": true
  },
  "extraKnownMarketplaces": {
    "acme-tools": {
      "source": { "source": "github", "repo": "acme-corp/claude-plugins" }
    }
  },
  "skippedMarketplaces": [],
  "skippedPlugins": [],
  "pluginConfigs": {},
  "strictKnownMarketplaces": []    // Managed only
}
```

**归属 Tab：** 暂无（可并入 MCP Servers 或独立 Plugins Tab）

### 2.8 Advanced / Enterprise Settings

| Key | 类型 | 描述 | Managed Only |
|-----|------|------|-------------|
| `otelHeadersHelper` | string | 动态 OpenTelemetry 头脚本 | No |
| `awsAuthRefresh` | string | AWS 认证刷新命令 | No |
| `awsCredentialExport` | string | AWS 凭证导出脚本 | No |
| `remote.defaultEnvironmentId` | string | 远程会话默认环境 ID | No |
| `allowManagedPermissionRulesOnly` | boolean | 仅允许 managed 权限规则 | **Yes** |
| `allowManagedHooksOnly` | boolean | 仅加载 managed hooks | **Yes** |

---

## 3. 环境变量完整清单

环境变量存储在 settings.json 的 `env` 对象中，但 **UI 层按用途拆分到各 Tab 展示**。

### 3.1 模型相关（Models Tab）

| 环境变量 | 描述 |
|---------|------|
| `ANTHROPIC_MODEL` | 全局模型覆盖（alias 或完整 ID） |
| `ANTHROPIC_DEFAULT_OPUS_MODEL` | Override `opus` alias 路由的实际模型 |
| `ANTHROPIC_DEFAULT_SONNET_MODEL` | Override `sonnet` / `default` alias 路由的实际模型 |
| `ANTHROPIC_DEFAULT_HAIKU_MODEL` | Override `haiku` alias 路由的实际模型 |
| `CLAUDE_CODE_SUBAGENT_MODEL` | 子代理使用的模型 |
| `CLAUDE_CODE_EFFORT_LEVEL` | Opus 4.6 effort level: `low`, `medium`, `high` |
| `MAX_THINKING_TOKENS` | Extended thinking token 上限（0=禁用） |
| `CLAUDE_CODE_MAX_OUTPUT_TOKENS` | 最大输出 token（默认 32000，最大 64000） |
| `CLAUDE_CODE_FILE_READ_MAX_OUTPUT_TOKENS` | 文件读取 token 上限 |

### 3.2 认证相关（General / 不在 UI）

| 环境变量 | 描述 |
|---------|------|
| `ANTHROPIC_API_KEY` | API key |
| `ANTHROPIC_AUTH_TOKEN` | 自定义 Authorization header 值 |
| `ANTHROPIC_CUSTOM_HEADERS` | 自定义 headers（`Name: Value` 格式，换行分隔） |

### 3.3 网络 & 代理（Network Tab）

| 环境变量 | 描述 |
|---------|------|
| `HTTP_PROXY` | HTTP 代理服务器 |
| `HTTPS_PROXY` | HTTPS 代理服务器 |
| `NO_PROXY` | 绕过代理的域名/IP |
| `CLAUDE_CODE_PROXY_RESOLVES_HOSTS` | 允许代理 DNS 解析 |
| `CLAUDE_CODE_CLIENT_CERT` | mTLS 客户端证书文件 |
| `CLAUDE_CODE_CLIENT_KEY` | mTLS 客户端私钥文件 |
| `CLAUDE_CODE_CLIENT_KEY_PASSPHRASE` | mTLS 私钥密码 |

### 3.4 云供应商（Network Tab / Advanced）

| 环境变量 | 描述 |
|---------|------|
| `CLAUDE_CODE_USE_BEDROCK` | 使用 AWS Bedrock |
| `CLAUDE_CODE_SKIP_BEDROCK_AUTH` | 跳过 Bedrock AWS 认证 |
| `AWS_BEARER_TOKEN_BEDROCK` | Bedrock API key |
| `CLAUDE_CODE_USE_VERTEX` | 使用 Google Vertex AI |
| `CLAUDE_CODE_SKIP_VERTEX_AUTH` | 跳过 Vertex Google 认证 |
| `VERTEX_REGION_*` | Vertex AI 按模型覆盖区域 |
| `CLAUDE_CODE_USE_FOUNDRY` | 使用 Microsoft Foundry |
| `CLAUDE_CODE_SKIP_FOUNDRY_AUTH` | 跳过 Foundry Azure 认证 |
| `ANTHROPIC_FOUNDRY_API_KEY` | Foundry API key |
| `ANTHROPIC_FOUNDRY_BASE_URL` | Foundry 资源 URL |
| `ANTHROPIC_FOUNDRY_RESOURCE` | Foundry 资源名称 |

### 3.5 Shell & Bash（Sandbox Tab）

| 环境变量 | 描述 |
|---------|------|
| `CLAUDE_CODE_SHELL` | 覆盖 shell 检测 |
| `CLAUDE_CODE_SHELL_PREFIX` | 命令前缀封装 |
| `CLAUDE_BASH_MAINTAIN_PROJECT_WORKING_DIR` | 每条命令后返回原始目录 |
| `BASH_DEFAULT_TIMEOUT_MS` | 默认 bash 超时 |
| `BASH_MAX_TIMEOUT_MS` | 模型可设置的最大超时 |
| `BASH_MAX_OUTPUT_LENGTH` | bash 输出截断长度上限 |

### 3.6 MCP 相关（MCP Servers Tab）

| 环境变量 | 描述 |
|---------|------|
| `MCP_TIMEOUT` | MCP 服务器启动超时（ms） |
| `MCP_TOOL_TIMEOUT` | MCP 工具执行超时（ms） |
| `MCP_CLIENT_SECRET` | OAuth 客户端密钥 |
| `MCP_OAUTH_CALLBACK_PORT` | 固定 OAuth 重定向端口 |
| `MAX_MCP_OUTPUT_TOKENS` | MCP 响应最大 token（默认 25000） |
| `ENABLE_TOOL_SEARCH` | 工具搜索: `auto`, `auto:N`, `true`, `false` |

### 3.7 遥测 & 监控（不在 UI / Environments Tab 通用列表）

| 环境变量 | 描述 |
|---------|------|
| `CLAUDE_CODE_ENABLE_TELEMETRY` | 启用 OpenTelemetry |
| `DISABLE_TELEMETRY` | 禁用 Statsig 遥测 |
| `DISABLE_ERROR_REPORTING` | 禁用 Sentry 错误报告 |
| `CLAUDE_CODE_DISABLE_FEEDBACK_SURVEY` | 禁用会话质量调查 |
| `DISABLE_COST_WARNINGS` | 禁用费用警告 |
| `OTEL_METRICS_EXPORTER` | OTel metrics exporter |

### 3.8 功能开关（不在 UI / Environments Tab 通用列表）

| 环境变量 | 描述 |
|---------|------|
| `CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION` | 启用/禁用 prompt 建议 |
| `CLAUDE_CODE_ENABLE_TASKS` | 使用任务跟踪系统 |
| `CLAUDE_CODE_DISABLE_AUTO_MEMORY` | 禁用自动记忆 |
| `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS` | 禁用后台任务 |
| `DISABLE_AUTOUPDATER` | 禁用自动更新 |
| `DISABLE_PROMPT_CACHING` | 全局禁用 prompt 缓存 |
| `DISABLE_PROMPT_CACHING_HAIKU` | 禁用 Haiku prompt 缓存 |
| `DISABLE_PROMPT_CACHING_SONNET` | 禁用 Sonnet prompt 缓存 |
| `DISABLE_PROMPT_CACHING_OPUS` | 禁用 Opus prompt 缓存 |
| `DISABLE_NON_ESSENTIAL_MODEL_CALLS` | 禁用非关键模型调用 |
| `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` | 禁用所有非必要流量 |

### 3.9 文件 & 存储

| 环境变量 | 描述 |
|---------|------|
| `CLAUDE_CONFIG_DIR` | 自定义配置/数据目录 |
| `CLAUDE_CODE_TMPDIR` | 覆盖临时目录 |

### 3.10 其他

| 环境变量 | 描述 |
|---------|------|
| `CLAUDE_CODE_HIDE_ACCOUNT_INFO` | 隐藏 email/org 信息 |
| `CLAUDE_CODE_DISABLE_TERMINAL_TITLE` | 禁用终端标题更新 |
| `CLAUDE_CODE_EXIT_AFTER_STOP_DELAY` | 自动退出延迟（ms） |
| `CLAUDE_CODE_TASK_LIST_ID` | 跨会话共享任务列表 |
| `CLAUDE_CODE_TEAM_NAME` | Agent team 名称 |
| `CLAUDE_CODE_API_KEY_HELPER_TTL_MS` | 凭证刷新间隔（ms） |
| `CLAUDE_CODE_AUTOCOMPACT_PCT_OVERRIDE` | 自动压缩触发百分比 (1-100) |
| `USE_BUILTIN_RIPGREP` | 使用内置 ripgrep（设 0 用系统 rg） |
| `IS_DEMO` | Demo 模式 |

---

## 4. 模型系统

### 4.1 Model Aliases

| Alias | 行为 |
|-------|------|
| `default` | 推荐设置，按账户类型决定（Max/Teams/Pro → Opus 4.6） |
| `sonnet` | 最新 Sonnet（当前 Sonnet 4.5），日常编码 |
| `opus` | 最新 Opus（当前 Opus 4.6），复杂推理 |
| `haiku` | 快速高效，简单任务 |
| `sonnet[1m]` | Sonnet + 1M context window |
| `opusplan` | Plan mode 用 Opus，执行用 Sonnet |

Alias 始终指向最新版本。要锁定特定版本，使用完整 model name（如 `claude-opus-4-6`）。

### 4.2 模型选择优先级

1. **会话内** — `/model <alias|name>` 切换
2. **启动时** — `claude --model <alias|name>`
3. **环境变量** — `ANTHROPIC_MODEL=<alias|name>`
4. **Settings** — `settings.json` 的 `model` 字段

### 4.3 模型路由环境变量

| 环境变量 | 覆盖的 Alias |
|---------|-------------|
| `ANTHROPIC_DEFAULT_SONNET_MODEL` | `sonnet` / `default` / `opusplan`(执行阶段) |
| `ANTHROPIC_DEFAULT_OPUS_MODEL` | `opus` / `opusplan`(Plan Mode 阶段) |
| `ANTHROPIC_DEFAULT_HAIKU_MODEL` | `haiku` / 后台功能 |
| `CLAUDE_CODE_SUBAGENT_MODEL` | 子代理 |

### 4.4 Effort Level

Opus 4.6 的 adaptive reasoning，动态分配思考量：

- `low` — 快速廉价，适合简单任务
- `medium` — 平衡
- `high` — 深度推理，适合复杂问题（默认）

可通过 settings key `effortLevel`、环境变量 `CLAUDE_CODE_EFFORT_LEVEL`、或 `/model` 滑块设置。

---

## 5. MCP 服务器配置

### 5.1 存储位置（与 settings.json 独立）

| Scope | 位置 | 用途 |
|-------|------|------|
| Local | `~/.claude.json`（按项目路径存储） | 个人、当前项目 |
| Project | `.mcp.json`（项目根目录） | 团队共享（git 提交） |
| User | `~/.claude.json`（全局区域） | 个人、跨项目 |
| Managed | 系统目录 `managed-mcp.json` | 企业级（独占控制） |

### 5.2 服务器类型

| 类型 | 传输方式 | 典型用法 |
|------|---------|---------|
| HTTP | Streamable HTTP | 远程云服务（推荐） |
| SSE | Server-Sent Events | 远程云服务（已废弃） |
| stdio | 标准输入输出 | 本地进程 |

### 5.3 .mcp.json 格式

```jsonc
{
  "mcpServers": {
    "server-name": {
      "type": "http",                    // 或 "stdio"
      "url": "https://mcp.example.com/mcp",  // HTTP/SSE
      "command": "/path/to/server",      // stdio
      "args": [],                        // stdio
      "env": {},                         // 环境变量
      "headers": {},                     // HTTP headers
      "oauth": {                         // OAuth 配置
        "clientId": "...",
        "callbackPort": 8080
      }
    }
  }
}
```

支持环境变量展开：`${VAR}` 和 `${VAR:-default}` 语法。

### 5.4 Managed MCP

- `managed-mcp.json` 部署后拥有**独占控制**，用户无法添加其他服务器
- 可与 `allowedMcpServers` / `deniedMcpServers` 组合使用
- 限制方式：按 `serverName`、`serverCommand`（精确匹配）、`serverUrl`（通配符）

---

## 6. Memory 系统

### 6.1 Memory 层次（优先级从高到低）

| 类型 | 位置 | 用途 | 共享范围 |
|------|------|------|---------|
| Managed policy | 系统目录 `CLAUDE.md` | 企业级指令 | 所有用户 |
| User memory | `~/.claude/CLAUDE.md` | 个人全局偏好 | 仅自己 |
| User rules | `~/.claude/rules/*.md` | 个人模块化规则 | 仅自己 |
| Project memory | `./CLAUDE.md` 或 `./.claude/CLAUDE.md` | 项目指令 | 团队 (git) |
| Project rules | `./.claude/rules/*.md` | 项目模块化规则 | 团队 (git) |
| Local memory | `./CLAUDE.local.md` | 本地项目偏好 | 仅自己 (gitignored) |
| Auto memory | `~/.claude/projects/<project>/memory/` | Claude 自动记录 | 仅自己 |

### 6.2 模块化规则 (.claude/rules/)

支持 YAML frontmatter 的 `paths` 字段实现路径条件规则：

```markdown
---
paths:
  - "src/api/**/*.ts"
---

# API Development Rules
- All API endpoints must include input validation
```

无 `paths` 字段的规则无条件加载。支持 glob 通配符和 brace 展开。

### 6.3 Auto Memory

存储在 `~/.claude/projects/<project>/memory/` 下：

```
memory/
├── MEMORY.md          # 简洁索引，每次会话加载前 200 行
├── debugging.md       # 调试模式笔记
├── api-conventions.md # API 设计决策
└── ...
```

通过 `CLAUDE_CODE_DISABLE_AUTO_MEMORY` 环境变量控制启用/禁用。

### 6.4 Import 语法

CLAUDE.md 文件支持 `@path/to/import` 语法导入其他文件：

```markdown
See @README for project overview.
Individual preferences: @~/.claude/my-project-instructions.md
```

递归导入，最大深度 5 层。代码块和代码 span 内的 `@` 不会触发导入。

---

## 7. Tab ↔ Setting Key 映射表

### 7.1 总览

| Tab | Settings Keys | UI 化的 Env Vars | 特殊数据源 |
|-----|--------------|-----------------|-----------|
| **General** | `language`, `cleanupPeriodDays`, `attribution`, `autoUpdatesChannel`, `showTurnDuration`, `spinnerTipsEnabled`, `spinnerVerbs`, `prefersReducedMotion`, `terminalProgressBarEnabled` | — | ExtensionConfig: `systemNotifications`, `completionSound` |
| **Models** | `model`, `effortLevel`, `alwaysThinkingEnabled` | `ANTHROPIC_DEFAULT_*_MODEL`, `ANTHROPIC_MODEL`, `CLAUDE_CODE_SUBAGENT_MODEL`, `MAX_THINKING_TOKENS` | ExtensionConfig: `customModels` |
| **Agent** | `agent`, `outputStyle`, `teammateMode`, `respectGitignore`, `plansDirectory`, `fileSuggestion`, `statusLine` | — | — |
| **Permissions** | `permissions.*` (allow/deny/ask/defaultMode/additionalDirectories/disableBypassPermissionsMode) | — | — |
| **Hooks** | `hooks` (14 种事件), `disableAllHooks` | — | — |
| **MCP Servers** | `enableAllProjectMcpServers`, `enabledMcpjsonServers`, `disabledMcpjsonServers` | `MCP_TIMEOUT`, `MCP_TOOL_TIMEOUT`, `MAX_MCP_OUTPUT_TOKENS`, `ENABLE_TOOL_SEARCH` | **管道 C**: `~/.claude.json`, `.mcp.json` |
| **Memory & Rules** | — | — | CLAUDE.md 文件族, `.claude/rules/*.md`, auto memory |
| **Environments** | `env` (排除已被其他 Tab 认领的 key) | 通用/未分类 env vars | — |
| **Sandbox** | `sandbox.*` | `BASH_DEFAULT_TIMEOUT_MS`, `BASH_MAX_TIMEOUT_MS`, `CLAUDE_CODE_SHELL`, `BASH_MAX_OUTPUT_LENGTH` | — |
| **Network** | `skipWebFetchPreflight`, `remote` | `HTTP_PROXY`, `HTTPS_PROXY`, `NO_PROXY`, `CLAUDE_CODE_CLIENT_*`, 云供应商 vars | — |
| **Profiles** | — | — | ExtensionConfig: `activeProfile` |
| **Slash Commands** | — | — | SDK (只读) |

### 7.2 Env 分治规则

所有环境变量存储在同一个 `settings.json` → `env` 对象中。UI 层按用途拆分展示：

- 每个 Tab 声明自己"认领"的 env key 集合
- Environments Tab 显示所有**未被认领**的 env key
- 写入时合并到同一个 `env` 对象：

```typescript
const currentEnv = settings.value.env || {};
updateSetting('env', { ...currentEnv, [KEY]: newValue }, scope);
```

---

## 8. Extension Config (管道 B)

### 8.1 存储位置

`~/.claudix.json` — 扩展独有配置，不跟随 CC Profile。

### 8.2 字段定义

| Key | 类型 | 描述 | 状态 |
|-----|------|------|------|
| `activeProfile` | `string \| null` | 当前活跃 Profile 名称 | ✅ 已实现 |
| `customModels` | `string[]` | 用户自定义模型 ID 列表 | ❌ 待新增 |
| `systemNotifications` | boolean | 系统通知开关 | ✅ 已实现 |
| `completionSound` | boolean | 完成提示音 | ✅ 已实现 |

### 8.3 已废弃 / 待迁移字段

| Key | 当前状态 | 迁移目标 |
|-----|---------|---------|
| `defaultModel` | ExtensionConfig | → CC Settings `model` (Models Tab) |
| `defaultPermissionMode` | ExtensionConfig | → CC Settings `permissions.defaultMode` (Permissions Tab) |
| `defaultThinkingLevel` | ExtensionConfig | → CC Settings `alwaysThinkingEnabled` + env `MAX_THINKING_TOKENS` |

---

## 9. 当前实现状态

### 9.1 Tab 实现进度

| Tab | 状态 | Scope 感知 | 使用 SettingsItem |
|-----|------|-----------|------------------|
| General | ✅ 已实现 | ⚠️ 部分（ext config 项无 scope） | ⚠️ 部分 |
| Models | ❌ Stub（读取 OK，写入未实现） | No | No |
| Agent | ⚠️ 部分（仅 cleanupPeriodDays） | No | No |
| Permissions | ❌ Coming Soon | — | — |
| Hooks | ❌ Coming Soon | — | — |
| MCP Servers | ❌ Coming Soon | — | — |
| Memory & Rules | ✅ 已实现 | No | No |
| Environments | ✅ 已实现 | ✅ 使用 SettingsItem | ✅ |
| Sandbox | ✅ 已实现 | No (hardcoded global) | No |
| Network | ✅ 已实现 | No (hardcoded global) | No |
| Profiles | ✅ 已实现 | N/A | N/A |
| Slash Commands | ❌ Coming Soon | — | — |

### 9.2 SettingsItem 组件

统一的 scope 感知设置项组件。功能：

- `inspect()` 读取当前值及其生效 scope
- 自动显示 ScopeSelect 下拉（User / Workspace / Local）
- 只读 scope（managed / cli）显示 badge 而非下拉
- 通过 slot 传递 `value` 和 `update` 回调

**当前使用情况：** 仅 General Tab（通知开关）和 Environments Tab 使用。目标是所有 CC settings 项统一使用。

---

## 10. 设计原则

### 10.1 三条规则

1. **CC schema 里有的 key** → 一律走管道 A (`updateSetting`)
2. **CC schema 里没有的、扩展独有的** → 走管道 B (`updateExtensionConfig`)
3. **每个设置项有且仅有一个权威来源**

### 10.2 统一组件模式

所有 CC settings 项应使用 `SettingsItem` 组件包装：

```vue
<SettingsItem setting-key="model" label="Default Model">
  <template #default="{ value, update }">
    <Dropdown :model-value="value" @update:model-value="update" :options="modelOptions" />
  </template>
</SettingsItem>
```

自动获得：scope 选择、inspect 读值、profile 切换刷新。

### 10.3 env 分治

`env` 是一个共享对象，UI 按用途拆分到各 Tab。每个 Tab 只展示和编辑自己认领的 key，写入时合并到同一个 `env` 对象。

### 10.4 Profile 行为

- 管道 A（CC Settings）：跟随 Profile 切换，不同 Profile 可以有不同的 model、env、permissions 等
- 管道 B（Extension Config）：不跟随 Profile，`customModels` / `systemNotifications` 等全局共享
- 管道 C（MCP Config）：MCP 服务器列表独立于 Profile 系统

---

## 11. Scope UX 设计

### 11.1 设计决策：页面级 Scope Tab

**弃用方案：** per-item ScopeSelect（每个设置项旁边有一个 scope 下拉框）

- 视觉噪音：10+ 个设置项都带下拉
- 认知负荷：每改一项都要想 "写到哪一层"
- 无法一眼看出 "项目团队共享了哪些设置"

**采用方案：** 页面级 Scope Tab（类似 VS Code 的 User / Workspace 切换）

### 11.2 布局结构

```
┌──────────────────────────────────────────────────────────┐
│  Settings                                                 │
│                                                           │
│  Profile: [Default ▾]          ← 仅影响 User scope       │
│                                                           │
│  ┌─────────┬─────────────┬─────────┐                      │
│  │  User   │  Workspace  │  Local  │  ← 页面级 Scope Tab  │
│  ╞═════════╧═════════════╧═════════╡                      │
│  │                                 │                      │
│  │  ┌──────────┐  ┌─────────────┐  │                      │
│  │  │ General  │  │  设置内容区  │  │                      │
│  │  │ Models   │  │             │  │                      │
│  │  │ Agent    │  │             │  │                      │
│  │  │ ...      │  │             │  │                      │
│  │  └──────────┘  └─────────────┘  │                      │
│  │  左侧 Tab      右侧内容         │                      │
│  └─────────────────────────────────┘                      │
└──────────────────────────────────────────────────────────┘
```

Scope Tab 位于内容区顶部，覆盖所有 Tab。切换 Scope 不会改变当前选中的 Tab。

### 11.3 三种 Scope 视图的行为

#### User 视图（默认）

- **显示**：`~/.claude/settings.json`（或 `settings.{profile}.json`）的值
- **编辑**：写入 → `updateSetting(key, value, 'global')`
- **未设置项**：显示 default 值 + "(default)" 标记
- **Override 提示**：当值被 Workspace/Local 覆盖时，显示 "⚠ 被 Workspace 覆盖为 xxx"

```
  Model           [Opus ▾]
  Effort Level    [High ▾]
  Thinking        [开启]
                  ⚠ 被 Workspace 覆盖为 "关闭"    ← Override 提示
```

#### Workspace 视图

- **显示**：`.claude/settings.json` 的值
- **编辑**：写入 → `updateSetting(key, value, 'shared')`
- **未设置项**：灰色显示继承自 User 的有效值 + "(inherited)" 标记
- **无工作区**：整个 tab 禁用，显示提示文案

```
  Model           [未设置]  (inherited: Opus)    ← 灰色，继承自 User
  Thinking        [关闭]                         ← Workspace 层有值
  permissions     [允许列表...]                   ← Workspace 层有值
```

#### Local 视图

- **显示**：`.claude/settings.local.json` 的值
- **编辑**：写入 → `updateSetting(key, value, 'local')`
- **未设置项**：灰色显示继承的有效值 + "(inherited)" 标记
- **无工作区**：整个 tab 禁用，显示提示文案

### 11.4 Override 指示器

利用 `inspect(key)` 返回的 `values` 字段，判断覆盖关系：

```typescript
// inspect('model') 返回示例
{
  value: "sonnet",           // 最终有效值
  effectiveScope: "shared",  // 生效在 Workspace 层
  values: {
    global: "opus",          // User 层设了 "opus"
    shared: "sonnet",        // Workspace 层覆盖为 "sonnet"
    local: undefined,        // Local 层未设置
    default: "default"       // 默认值
  }
}
```

| 当前视图 | 显示值 | 状态 | 操作 |
|---------|-------|------|------|
| User | `opus` | ⚠ 被 Workspace 覆盖 | 编辑 → `updateSetting('model', x, 'global')` |
| Workspace | `sonnet` | ✅ 已设置 | 编辑/重置 → `update/resetSetting('model', 'shared')` |
| Local | *(未设置)* (effective: sonnet) | 继承态 | 点击设置 → `updateSetting('model', x, 'local')` |

### 11.5 重置功能

每个已设置的值旁边显示 `[重置]` 按钮，调用 `resetSetting(key, scope)` 删除当前层的值，回落到继承。

### 11.6 Profile 与 Scope 的交互

```
Profile 切换只影响 User scope：
  ├── Profile "default"  → ~/.claude/settings.json
  ├── Profile "aws"      → ~/.claude/settings.aws.json
  └── Profile "vertex"   → ~/.claude/settings.vertex.json

Workspace 和 Local scope 不受 Profile 影响
```

因此 Profile 选择器只在 User 视图中有意义。在 Workspace / Local 视图中可以隐藏或灰显。

### 11.7 无工作区时的降级

当没有打开工作区时：
- Workspace 和 Local tab 禁用（不可点击）
- 显示 tooltip："打开工作区后可使用 Workspace 和 Local 设置"
- 通过 `GetSettingsResponse` 中添加 `hasWorkspace: boolean` 字段判断

### 11.8 实现架构

```
SettingsPage.vue
  │
  ├── activeScope = ref<'global' | 'shared' | 'local'>('global')
  ├── provide('settingsScope', activeScope)
  │
  ├── <SettingsScopeTab v-model="activeScope" />     ← 页面级 Scope 切换
  │
  └── <SettingsTab*>
        └── <SettingsItem setting-key="model">
              │
              ├── inject('settingsScope') → 得到当前 scope
              ├── inspect(key).values[scope] → 当前层的值
              ├── inspect(key).value → 有效值（用于继承态显示）
              ├── updateSetting(key, val, scope) → 写入当前层
              └── resetSetting(key, scope) → 重置当前层
```

### 11.9 SettingsItem 改造后的 Slot Props

```typescript
interface SettingsItemSlotProps {
  value: any;              // 当前 scope 层的值（可能 undefined）
  effectiveValue: any;     // 最终有效值（跨所有 scope）
  inherited: boolean;      // 是否为继承态（当前 scope 层未设置）
  overriddenBy: string | null;  // 被哪层覆盖（仅 User 视图有用）
  update: (val: any) => void;   // 写入当前 scope
  reset: () => void;            // 重置当前 scope
}
```
