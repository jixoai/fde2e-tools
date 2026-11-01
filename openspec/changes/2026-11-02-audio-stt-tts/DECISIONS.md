# 决策记录：黄页预览去 iframe（Owner 裁决 2026-11-02，grill-me 审查中拍板）

## 背景

本仓黄页（apps/directory）现行形态＝「工具卡片 + **iframe 实况预览**
（生产域嵌各子域）+ 入口」，语义锚在归档 change `project-bootstrap` 的
specs/tool-directory「生产域实况预览」Scenario。

Owner 在本次审查中裁决：**取消 iframe 预览，改构建期自动截图**。理由：
面向未来的工具站（含本 change 即将新增的 STT/TTS 站）体积只会更大
（模型装机、WebGPU 会话），iframe 实况加载对方整站＝作死；截图可以
在构造阶段精心布局，效果更好、成本更低。

## 裁决与影响

1. **方向已定**（不再是问题）：
   - 黄页卡片渲染「精心布局的站内截图」（构建期产出）替代 iframe 实况
     加载；
   - 本 change 的 STT/TTS 两站黄页条目从一开始就按截图形态交付，
     guidance 不再描述 iframe 行为；
2. **归属**（本 change vs 另立 change）——本 change 的职责边界是 STT/TTS
   ：黄页去 iframe 触及 **存量 11 站** 的黄页呈现与 static-tools-hosting/
   tool-directory 既有语义（requirement MODIFIED），是跨站公共行为变更，
   按 openspec 纪律**另立 change**（建议名 `directory-snapshot-preview`）
   承接：存量 11 站卡片一并迁移 + 构建期截图管线（Playwright 视口截图、
   reduced-motion 相位冻结、明暗双态）＋ X-Frame-Options 相关服务器侧
   放行条款随之清理。
   本 change 只做配套单向对齐：新增站以截图语义入黄页（tabs/断言按新
   形态写，不写 iframe 断言），确保另立 change 落地时新增两站零返工。
3. **写进本 change 的具体改动**：
   - proposal/tasks 措辞：黄页收编任务不再引用「实况预览」语义；
     tasks 5.4 黄页断言按「卡片 + 截图语义」写；
   - Q1 裁决（COOP/COEP v1 不采）嗣候补落 proposal 风险面：iframe 取消
     后 COOP/COEP 的 iframe 传染面自动消失，未来 SAB 需求自立项。

## 与既有语义的关系

- 若 `directory-snapshot-preview` change 落地，`project-bootstrap` 的
  tool-directory 里「生产域实况预览」Requirement 由它 MODIFIED/REMOVED；
  本 change 不碰那片 spec 增量（不抢归属）。
