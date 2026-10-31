# 专业幻灯编辑器（apps/pptx）——AGPL-3.0 隔离目录

> **本目录整体以 AGPL-3.0 许可**（仓库其余部分为 Apache-2.0，见根 README
> 「许可分区」）。本文件是许可边界与嵌入形态的权威声明。

## 来源与许可

- 上游：**PPTist**（https://github.com/pipipi-pikachu/PPTist ，v2.0.0，
  **AGPL-3.0**，LICENSE 为其原文全文）。
- vendored 副本：`src/pptist/`（上游 `src/` 逐字零改动；**仅排除其入口
  `src/main.ts`**——启动配方由本仓胶水层 `src/bridge.ts` 逐字复刻并接管挂载点，
  以及上游仓库根的开发 harness 文件（eslint/husky/doc/.github/上游
  vite.config 等，与运行时无关）。版本与排除项以 `git log` 提交信息为准。
- `public/`（mocks/imgs/favicon）同为上游副本（AGPL 覆盖）。
- 本仓胶水层（`src/App.tsx`、`src/bridge.ts`、`src/webmcp.ts`、
  `src/export-name.ts`、`src/main.tsx`、`vite.config.ts` 等）与 PPTist 状态
  **强耦合**，按同一 AGPL-3.0 对外（保守取传染面全包）；对上游的适配（别名
  `@ → src/pptist`、插件链同形）只在构建配置层，不改上游源码。

## AGPL §13 合规路径

本站点以 AGPL 软件对用户提供服务，按 §13 需向站点用户提供对应源码——本仓
（github.com/jixoai/fde2e-tools）**公开即满足**；`src/pptist/` 副本与上游
LICENSE 一并随仓分发。上游后续升级＝重取其发布版本 diff（vendor 纪律：
逐字替换、本地零改动）。

## 隔离纪律（红线）

- PPTist 源码与其依赖（vue/pinia/pptxgenjs/pptxtojson 等）**只进本目录**：
  - 禁止 import 进 `packages/shared` 或任何其它 app（`apps/pptx/package.json`
    是唯一依赖声明点）；
  - 其余工具站（含 easy-* 轻量线）构建产物经 grep 验证零 PPTist 代码。
- easy-* 生成线「禁 AGPL」红线**不放宽**：pptxgenjs（MIT）在 easy-pptx 的
  生成链与 AGPL 无涉；本目录的 AGPL 义务来自 PPTist 本体及其派生胶水层。

## 特性边界（如实告知）

- PPTist 自带「AI 生成 PPT / AI 润色 / 图片搜索」等特性依赖其上游服务端
  （server.pptist.cn）。本站为**纯静态零后端**部署、不代理不配置——点击这些
  特性会得到上游错误提示（CORS 拒绝），**核心编辑 / 导入 / 导出全部离线可用**。
- 导出保真边界＝pptxgenjs 固有能力：文本/形状/表格/图表基础项可靠，复杂字体/
  动画有损；导入（pptxtojson）解析保真中等。对外承诺「基础演示往返保真」。

## 编辑器岛挂载

React（solid-glass 外框）渲染页首/操作卡/状态行，`src/bridge.ts` 在容器内
`createApp(App.vue)` 挂载 vendored Vue 应用（boot 配方＝上游 main.ts 逐字），
并把 Pinia store 与 useExport/useImport 暴露为编程面（WebMCP 工具经它驱动）。
PPTist 大库整块 dynamic import 懒加载独立 chunk。
