# tool-registry 规格增量（ADDED）

## ADDED Requirements

### Requirement: 工具元数据单源

系统 SHALL 在 `packages/shared/src/registry.ts` 维护唯一的工具元数据表
（ToolMeta）：id / 名称 / 一句话 / 子域 / 标签 / aiGuide 摘要 / URL 参数契约
（urlParams，含可选 enum）/ WebMCP 入口点（tools）/ 仓库路径。黄页渲染、
各工具页自述、WebMCP inputSchema 派生 SHALL 全部消费该单源，禁止在消费侧
复刻第二份元数据。

#### Scenario: 加新工具只改一处元数据

- **WHEN** 开发者按「registry 加一条 + 新建 apps/<id>」接入新工具
- **THEN** 黄页无需改代码即收录该工具（卡片、搜索、预览、入口全部自动出现）
- **AND** 该工具页的 WebMCP schema 经 schemaFromUrlParams 从 registry urlParams
  派生，不落第二份参数文档

#### Scenario: 契约文档与实现不一致视为 bug

- **WHEN** 任一工具的 URL 参数实现语义与 registry urlParams 描述不一致
- **THEN** 判定为缺陷：同步修正 registry 与 app 实现，并在 change 中记录契约变更

### Requirement: URL 参数契约保真

三个存量工具（pdf-tool / img-tool / url-tool）的 URL 参数契约 SHALL 逐字保留
（已有智能体按参数调用）：参数名、取值语义、默认值、clamp 边界、错误文案均
不得变更；新增参数只允许追加、不得改变既有参数行为。

#### Scenario: 存量调用方不受迁移影响

- **WHEN** 智能体按迁移前记录的调用 URL 打开迁移后的任一工具
- **THEN** 页面行为（渲染结果、状态行文案、导出/下载产物）与迁移前一致
