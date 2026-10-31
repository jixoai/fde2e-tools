# univer-write-gate 规格增量（ADDED）

## ADDED Requirements

### Requirement: 完整快照格式 seed 单源工厂（幽灵工作簿防御）

Univer `createWorkbook` 的 seed SHALL 一律经**单一工厂**构造为完整快照格式：
`sheets` 为按 sheetId 索引的 Record ＋ `sheetOrder` 数组 ＋ 各 sheet 带
`id`（及 name/rowCount/columnCount/cellData）。禁止以「sheets 数组＋无 id」等
简化格式直接构造 seed——该形态创建的工作簿会静默拒绝一切写入（幽灵「range
protected」弹窗、save() 冻结在创建态；digest 实证官方 playground 100% 复现，
库级 footgun）。

工作簿创建（首载/导入/sample 重载）后 SHALL 立即执行 **canary 写入校验**：向
远离可视区的哨兵单元格写入标记值 → `wb.save()` 快照 → 验证标记值已落快照 →
清理哨兵。校验失败 SHALL 判定幽灵工作簿并显式暴露（状态行 error ＋ 全部写
工具 `ok:false`，错误文案含「幽灵工作簿」），禁止静默失败。

#### Scenario: 工厂单源

- **WHEN** 审查代码中全部 createWorkbook 调用点
- **THEN** seed 全部来自同一工厂函数（grep 无旁路构造）

#### Scenario: canary 运行时探测

- **WHEN** 任一途径创建了写入被静默拒绝的幽灵工作簿（如注入简化 seed）
- **THEN** canary 校验检出，写工具返回 `ok:false` 且错误含「幽灵工作簿」，
  恢复健康工作簿后同一工具 `ok:true`

### Requirement: Rendered 生命周期门禁（写入禁静默失败）

所有 Univer 写类 Facade 调用（WebMCP 写工具/页面写操作路径）SHALL 经统一
生命周期门禁：`getCurrentLifecycleStage() >= 2`（Rendered）前一律**排队或显式
拒绝**（本仓实现取显式拒绝——可预测、可断言）：等待就绪超时即返回
`ok:false`＋人话原因（含「未渲染完成」），禁止在 Ready/Started 阶段静默执行
或谎报成功。

#### Scenario: 门禁挂起拒绝

- **WHEN** 生命周期被强制挂起（测试缝）或尚未到达 Rendered 时调用 set_cells
- **THEN** 返回 `ok:false` 且错误含「未渲染完成/未就绪」

#### Scenario: 门禁释放通行

- **WHEN** 门禁释放（生命周期到达 Rendered）后重复同一调用
- **THEN** `ok:true` 且写入落格（get_snapshot 可核验）

### Requirement: 双坑回归断言入绿门

绿门 SHALL 为上述两坑各保留至少一条回归断言（smoke-check 编辑器路径）：

- 幽灵工作簿：注入简化 seed 创建幽灵工作簿 → 写工具必须 `ok:false`（含幽灵
  判定文案）→ 恢复工厂 seed 工作簿 → 同工具 `ok:true`；
- Rendered 门禁：挂起生命周期 → 写工具必须 `ok:false`（含未渲染文案）→ 释放
  → 同工具 `ok:true` 且写入核验落格。

既有办公三站（easy-*）断言 SHALL 零缩水保留。

#### Scenario: 绿门双坑回归

- **WHEN** smoke-check 运行 xlsx 编辑器段
- **THEN** 两坑回归断言存在且通过（ok:false 语义断言 + 恢复后 ok:true）
