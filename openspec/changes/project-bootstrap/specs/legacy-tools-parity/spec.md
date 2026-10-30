# legacy-tools-parity 规格增量（ADDED）

## ADDED Requirements

### Requirement: 三工具迁移功能保真验收线

pdf-tool / img-tool / url-tool 自裸 HTML 单文件迁入 React+shadcn 时，SHALL 满足
以下保真项（视觉允许升级到 solid-glass，行为不允许漂移）：

1. **URL 参数契约**：全部参数（名/语义/默认值/clamp/校验正则）逐项一致；
2. **状态行文案**：`#status` 的全部文案字符串逐字一致（含错误/警告/成功三态）；
3. **导出参数**：pdf-tool 的 html2pdf options（margin/filename/image/html2canvas/
   jsPDF/pagebreak）逐字一致；img-tool 的下载文件名模式 `img-tool-<w>x<h>.png`
   一致；
4. **DOM id 稳定**：ai-guide 引用的全部可交互元素 id 不变（input-content/
   load-sample/render-btn/export-btn/file-input/preview/status；canvas-result/
   download-btn/copy-btn/src-input/load-url-btn/load-sample-btn/file-input/
   srcdrop；base-url/params-rows/add-param-btn/mode-query/mode-packed/mode-hint/
   result-url/copy-btn/open-btn/decode-panel/decode-table/decode-json/
   decode-load-btn）；
5. **输入类元素非受控**：智能体程序化 set input.value 后点击按钮仍生效；
6. **ai-guide 保留**：页首 `<pre id="ai-guide">` 文案与示例链接逐字保留
   （示例链接升级为绝对地址的行为一致）；
7. **vendored 依赖**：pdf-tool 的 marked/html2pdf 两个 UMD 库字节一致随仓分发。

#### Scenario: pdf-tool autoload 契约

- **WHEN** 打开 `pdf-tool 页面?autoload=sample`（或 `?autoload=示例`）
- **THEN** 自动载入内置示例周报并渲染好预览，状态行显示「示例周报已载入并渲染预览，
  点「导出 PDF」即可下载。」，点 export-btn 直接得到 pdf-tool-export.pdf

#### Scenario: img-tool URL 直调

- **WHEN** 打开 `img-tool?src=sample&text=...&pos=center&w=1080&h=1440&...`（任意
  迁移前合法参数组合）
- **THEN** 画布按契约渲染（cover 居中裁切/文字块位置/底衬/投影/角标算法与迁移前
  逐像素同语义），状态行给出「渲染完成：<w>×<h> px …」

#### Scenario: url-tool packed 互操作

- **WHEN** 打开 `url-tool?base=...&mode=packed&k=v...` 或
  `url-tool?decode=<q 值>`
- **THEN** 预填即出结果 / 自动解析出键值对表，编码链与迁移前字节兼容
  （JSON → encodeURIComponent → base64url，重复键保留最后一个）

#### Scenario: 状态行文案对表

- **WHEN** 对任一工具触发迁移前文档化的任一状态（成功/失败/受限）
- **THEN** `#status` 文本与迁移前逐字符一致（如「导出成功：文件已由浏览器下载」「该图源不允许跨域读取，请先把图转入素材库再用其 /uploads 地址」）

#### Scenario: 导出行为修复（历史缺陷注记，对抗审查 B1 2026-10-30）

- **背景**：基准裸 HTML 版的「导出 PDF」按钮本身是坏的——其脚本在 export-area
  元素入 DOM 前执行（`$("export-area")` 取到 null），点击即抛 TypeError，从不
  产生下载；保真对照物在该路径从未兑现「点导出即下载」。
- **WHEN** 用户/agent 在 fde2e-tools 版 pdf-tool 点击 export-btn（或调 export_pdf）
- **THEN** 浏览器真实下载 pdf-tool-export.pdf（%PDF 文件头、A4 纵向、含全部渲染
  内容）——本修复是对「点导出即下载」承诺的**首次真正兑现**，按行为修复验收，
  不逐字复刻基准缺陷
- **AND** 实现层：导出瞬间注入 oklch→sRGB 变量层钉扎 + 通配色兜底（vendored
  html2canvas 1.4.x 不识别 oklch），导出落定后卸载恢复主题原样（export-color-guard）
