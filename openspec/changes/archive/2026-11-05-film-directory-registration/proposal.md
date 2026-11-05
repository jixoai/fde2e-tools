# Proposal: film-directory-registration

## Why

主仓 change `web-openfilm-editor` task 6.2 要求把已上线的纯 Web 视频剪辑工作台登记到
FDE2E Tools 黄页。实现位于独立 MIT fork 仓 `fde2e-tools-film`，不能为满足本仓「加
工具＝apps/<id>」惯例复制一份代码；黄页 registry 已有 `editor` 外部工具先例，应以同一
external 投影形态收录并保持实现单源。

## What Changes

- registry 新增 `film` 外部静态工具条目，canonical 入口
  `https://film.tool.fde2e.com/`，投影完整 35 项 WebMCP 名称与人话说明。
- 黄页卡的大工具面摘要统一为「总数＋前四项＋省略号」，完整名称仍留 registry 与
  DOM `title`，避免 Film 35 项撑高卡片并让既有 9 项办公卡受同一规则约束。
- smoke 门从 13 卡更新到 14 卡，并新增 Film 搜索、入口、WebMCP 摘要与组合关键词断言。

## Capabilities

### Modified
- `tool-registry`：允许实现保持在受控外部仓的已上线纯静态工具，以 `external:` repoPath
  收录；黄页/搜索/WebMCP list_tools 仍完全由 registry 单源派生。

## Impact

- `packages/shared/src/registry.ts`
- `apps/directory/src/App.tsx`
- `scripts/smoke-check.mjs`
- 生产黄页 `tool.fde2e.com`（只更新静态构建，无新后端/端口）
