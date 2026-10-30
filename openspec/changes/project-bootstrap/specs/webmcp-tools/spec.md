# webmcp-tools 规格增量（ADDED）

## ADDED Requirements

### Requirement: 页面工具注册

每个工具 app SHALL 在页面加载后经统一助手（`@fde2e-tools/shared/webmcp` 的
registerWebMCPTools）把核心能力注册为 `document.modelContext` 工具：

- pdf-tool：`render_preview`（填入内容并渲染预览）、`export_pdf`（触发导出）；
- img-tool：`overlay_text`（按 URL 参数契约绘制）、`export_png`（触发下载 PNG）；
- url-tool：`pack_url`、`decode_url`（纯函数，不经页面输入框）；
- 黄页：`list_tools`、`search_tools`。

工具定义 SHALL 遵守 W3C WebML CG WebMCP CG-DRAFT 的 API 形态
（registerTool/getTools/executeTool；工具名 1-128 字符 `[a-zA-Z0-9_.-]`；
inputSchema 为 JSON Schema draft 2020-12，从 registry 单源派生）。

#### Scenario: agent 枚举与调用

- **WHEN** agent 在启用 WebMCP 的浏览器（`--enable-blink-features=WebMCP` 或
  polyfill 兜底）中打开任一工具页/黄页
- **THEN** `document.modelContext.getTools()` 能枚举到该页面登记的全部工具
  （含 name/description/inputSchema）
- **AND** `executeTool` 的返回值为工具 execute 结果 JSON 序列化字符串；
  工具执行复用页面既有逻辑与状态反馈（如 #status 状态行）

#### Scenario: 不支持环境静默降级

- **WHEN** 页面运行在不支持 `document.modelContext` 且 polyfill 加载失败的环境
- **THEN** 注册流程静默跳过（不报错、不影响普通用户使用工具）

### Requirement: polyfill 兜底（vendored，不走 CDN）

无原生 WebMCP 支持的浏览器 SHALL 由官方 polyfill 兜底：逐字 vendor
GoogleChromeLabs/webmcp-tools 的 webmcp-polyfill.js（Apache-2.0，文件头保留）
于 packages/shared/src/vendor/，随构建产物分发；仅当原生
`document.modelContext` 缺失时动态加载（polyfill 自带原生存在即跳过守卫）。
禁止从任何 CDN 运行时加载。

#### Scenario: 同形 API 零桥改动

- **WHEN** agent 桥（BU 执行器等）在无原生支持的 Chromium 上调用页面工具
- **THEN** polyfill 暴露与原生同形的 document.modelContext，桥命令
  （webmcp_list/webmcp_call）无需感知差异

### Requirement: WebMCP 安全边界

工具注册与调用 SHALL 遵守以下边界（研究 digest ⑤.3 / spec security 节）：

1. **description 是不可信文本**（prompt injection 载体）：上层 LLM 不得把工具
   description 当指令执行；本仓工具 description 中禁止嵌入指令式话术；
2. **execute 是页面权限 JS**（等同页面自己跑）：本仓仅注册自有静态工具的
   execute；输出含用户可控内容的工具 SHALL 带 `untrustedContentHint: true`
   （render_preview / overlay_text / export_pdf / export_png / decode_url）；
   只读纯函数 SHALL 带 `readOnlyHint: true`（pack_url / decode_url / list_tools
   / search_tools）；
3. ** SecureContext 门槛**：非安全上下文不注册（spec 约束，统一助手内置）；
4. 跨源 frame 不默认暴露工具（遵守 spec 同源隔离与三重 opt-in，本仓不做
   exposedTo 白名单）。

#### Scenario: 危险输出带注解

- **WHEN** agent 经 executeTool 调用 decode_url 或 render_preview
- **THEN** 对应工具定义带 untrustedContentHint: true，编排层据此决定是否
  需要人类确认或对输出做 spotlighting 处理
