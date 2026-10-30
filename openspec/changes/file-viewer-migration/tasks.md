# Tasks: file-viewer-migration

## 迁移实现

- [ ] T1 源码导入：原仓检出 `/Users/kzf/Development/GitHub/jixoai/fde2e/.worktrees/fde2e-fileviewer-task-initial`
  → `apps/file-viewer/`（src 全量＋public/demo；剔除原仓脚手架层：自己的 components/ui、
  solid-glass 副本、独立 vite/tsconfig 配置并入本仓 workspace 约定）。
- [ ] T2 shared 归一：shadcn 收编件改 `@fde2e-tools/shared` ui（缺的件按 vendor 纪律
  补进 shared/ui，文件头注官方出处）；solid-glass 令牌改消费 shared vendor；
  import 别名对齐本仓 tsconfig.base。
- [ ] T3 registry 单源：`packages/shared/src/registry.ts` 加 `file-viewer` 条目
  （id/名/tagline/描述/标签/子域 `file-viewer`/urlParams 契约 url·name·decoder/
  WebMCP 入口点 `preview_file`）。
- [ ] T4 WebMCP 接线：`src/webmcp.ts` 走 shared 助手注册 `preview_file`（入参
  url/name/decoder，schema 由 schemaFromUrlParams 派生）；输出含页面内容标
  `untrustedContentHint`。
- [ ] T5 `#ai-guide`：页内智能体用法说明（URL 契约三参数逐字＋解码器清单＋示例链接）。
- [ ] T6 黄页联动：确认 apps/directory 渲染新卡（registry 驱动应零改动生效）＋实况
  预览 iframe 对新子域可用（X-Frame-Options 口径核对 deploy 说明）。
- [ ] T7 E2E 标记保真：`data-viewer-*`/`data-decoder-*` 全家族逐字保留；omni 侧
  `FV_VIEWER_REPO` 指引更新（迁后指向本仓构建产物）。

## 门禁与部署

- [ ] T8 绿门：`pnpm -r check && pnpm -r build`＋`pnpm webmcp:check`＋`pnpm smoke:check`
  （smoke 覆盖 url 契约/状态行/渲染产物）＋apps/file-viewer 自带 vitest 迁入并全绿。
- [ ] T9 部署：`TOOLS_DEST=<目标> bash deploy/tools-upload.sh file-viewer` →
  `file-viewer.tool.fde2e.com`；同步更新 `fileviewer.fde2e.com` vhost root 至同一
  dist（兼容别名），公网双域 200＋ACAO:* 验证。
- [ ] T10 回归走查：对真实 omni /uploads 文件全类型预览走查（E2E 场景等价人工过一遍）。

## 删旧与收尾

- [ ] T11 删 `jixoai/fde2e-fileviewer`（gh 无 delete_repo scope → 提请 Owner 手动；
  本地检出与主仓 `.worktrees` 残留清理）；omni 侧 E2E 路径指引随批更新。
- [ ] T12 归档本 change＋specs 同步＋主仓拓扑注记（fileviewer 不再作为独立子仓）。

## Out of Scope

- omni 代码改动（`OMNI_FILEVIEWER_BASE` 默认域名由兼容别名承载，零改动）。
- 新解码器能力（迁移＝功能保真，不加新）。
- LICENSE 补充（本仓 public 无 LICENSE——Owner 决策项，另行提示）。
