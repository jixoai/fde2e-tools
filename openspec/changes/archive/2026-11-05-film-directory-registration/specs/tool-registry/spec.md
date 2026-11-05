# tool-registry Delta

## MODIFIED Requirements

### Requirement: registry 单一可信源覆盖本仓与受控外部静态工具

工具元数据 SHALL 只存在于 `packages/shared/src/registry.ts`。本仓实现使用
`repoPath: apps/<id>`；已上线且由 FDE2E 受控独立仓维护的纯静态工具 MAY 使用
`repoPath: external:<source>`，但 MUST 登记 canonical 子域、完整 WebMCP 工具名与许可/来源边界。
黄页卡、搜索与 `list_tools`/`search_tools` SHALL 从同一条目派生，不复制第二份目录数据。

#### Scenario: 收录独立 Film fork

- **WHEN** registry 登记 id=`film`、subdomain=`film.tool.fde2e.com` 与 35 项 WebMCP
- **THEN** 黄页自动出现现役卡，搜索「视频剪辑」与「OPFS WebCodecs」各唯一命中，
  `list_tools` 返回相同入口与工具面，且本仓不新增 `apps/film` 代码副本

#### Scenario: 大工具面不撑垮卡片

- **WHEN** 工具登记超过四项 WebMCP
- **THEN** 卡片显示「总数＋前四项＋省略号」，完整列表仍可从 registry、WebMCP 黄页工具与
  卡片 title 获取
