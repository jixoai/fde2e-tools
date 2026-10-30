# tool-directory 规格增量（ADDED）

## ADDED Requirements

### Requirement: 黄页 = 预览 + 搜索 + 入口

`tool.fde2e.com`（apps/directory）SHALL 提供三个能力：工具卡片（名称/一句话/
描述/标签/aiGuide 摘要/URL 参数契约数/WebMCP 入口点）、纯前端搜索、打开工具
入口。数据 SHALL 全部来自 registry 单源，页面无任何后端调用。

#### Scenario: 纯前端搜索

- **WHEN** 用户/agent 在搜索框输入关键词（空格分词 AND）
- **THEN** 黄页在 registry 的 name/tagline/description/tags/aiGuideSummary 上
  做不区分大小写子串过滤，实时更新卡片列表与计数
- **AND** 无命中时显示空态提示，不发生任何网络请求

#### Scenario: 生产域实况预览

- **WHEN** 黄页跑在 fde2e.com 生产域（tool.fde2e.com 或其子域）
- **THEN** 每张工具卡内嵌 iframe 实况预览 `https://<id>.tool.fde2e.com/`
- **AND** X-Frame-Options/frame-ancestors 放行由服务器侧配置（不在前端职责内）

#### Scenario: 本地构建新窗口兜底

- **WHEN** 黄页跑在非 fde2e.com 域（本地 dev/preview）
- **THEN** 卡片不渲染 iframe，改渲染「新窗口打开」兜底入口
- **AND** 「打开工具」按钮在任何环境都直达独立站

### Requirement: 黄页自身面向 agent

黄页 SHALL 在页内提供 `<pre id="ai-guide">`（说明黄页定位、各工具独立站规律、
ai-guide 惯例与 URL 契约稳定性），并 SHALL 注册 WebMCP 工具 `list_tools` 与
`search_tools`（见 webmcp-tools 能力）——agent 到黄页一次即可枚举全部工具。
