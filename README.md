# fde2e-tools

FDE2E 工具集——**全静态、零后端**的公共工具仓库。

- **工具黄页**：`tool.fde2e.com`（apps/directory）——工具卡片 + 搜索 + 实况预览 + 入口
- **各工具独立站**：`<tool>.tool.fde2e.com`
  - `pdf-tool` — PDF 工具站：粘贴 Markdown/HTML → 预览 → 导出 PDF
  - `img-tool` — 图片处理工具站：URL 参数即绘制指令（「网页链接＝函数调用」）
  - `url-tool` — URL 拼接器：query / packed（JSON→base64url）双模式 + 反向解码
- 对外仓库：`github.com/jixoai/fde2e-tools`（public）

## 架构

```
apps/
  directory/   工具黄页（卡片 + 纯前端搜索 + 生产域 iframe 实况预览）
  pdf-tool/    HTML/MD → PDF（vendored marked + html2pdf，UMD 直引）
  img-tool/    canvas 绘制管线（src/text/pos/size/color/bg/pad/w/h/label）
  url-tool/    URL 拼接器（query/packed 双模式 + ?decode= 反向解码）
packages/
  shared/      工具 registry 单源 / solid-glass 主题 vendor / shadcn 官方组件收编 /
               WebMCP 注册助手 + 官方 polyfill vendor
deploy/
  tools-upload.sh   上传脚本（rsync 优先 tar 兜底；目标目录 TOOLS_DEST 由编排者给）
scripts/
  webmcp-check.mjs  WebMCP 绿门（headless Chromium + WebMCP flag 下 getTools() 断言）
  smoke-check.mjs   参数契约冒烟（URL 契约/状态行文案/渲染产物逐值断言）
openspec/      变更管理（project.md + changes/）
```

**单源纪律**：`packages/shared/src/registry.ts` 是全部工具元数据的唯一可信源
（id/名称/一句话/子域/标签/URL 参数契约/WebMCP 入口点）。黄页渲染、各工具页、
WebMCP inputSchema 派生（schemaFromUrlParams）三面共用。**加新工具 ＝ registry
加一条 + 新建 apps/<id>**，其余零改动。

**技术栈**：pnpm workspace；各 app Vite + React 19 + Tailwind v4 + shadcn
（base-nova style，组件一律官方 registry 一手源收编）；视觉＝solid-glass 主题
（官方 registry 原件 vendor，含明暗双态——系统深色自动翻面）。构建产物纯静态。

## 本地开发

```bash
pnpm install
pnpm dev:directory   # http://127.0.0.1:5271（黄页）
pnpm dev:pdf-tool    # http://127.0.0.1:5272
pnpm dev:img-tool    # http://127.0.0.1:5273
pnpm dev:url-tool    # http://127.0.0.1:5274
```

dev server 仅绑 IPv4 回环，不对外暴露。黄页的 iframe 实况预览仅生产域开放；
本地构建自动降级为「新窗口打开」兜底。

## 部署

```bash
pnpm -r check && pnpm -r build          # 绿门
TOOLS_DEST=/www/tools bash deploy/tools-upload.sh pdf-tool   # 逐 app 上传（rsync 优先 tar 兜底）
```

服务器侧（vhost、`<tool>.tool.fde2e.com` 泛解析、X-Frame-Options 对黄页放行）
由编排者配置；本仓只产出纯静态目录。

## WebMCP（页面即 MCP server）

每个页面把自身能力注册为 W3C WebMCP 工具（`document.modelContext`），agent 可
直接编程调用：

| 页面 | 工具 |
| --- | --- |
| tool.fde2e.com（黄页） | `list_tools` / `search_tools`（agent 到黄页一次枚举全部工具） |
| pdf-tool | `render_preview` / `export_pdf` |
| img-tool | `overlay_text` / `export_png` |
| url-tool | `pack_url` / `decode_url`（纯函数） |

**浏览器侧开启方式**：

- Chrome 149+ / Edge 150+：启动参数 `--enable-blink-features=WebMCP`
  （或 `chrome://flags/#enable-webmcp-testing`）——原生 API 按 spec 返回
  JSON 字符串；
- 其它 Chromium：无需任何操作——页面内置 GoogleChromeLabs 官方 polyfill
  （Apache-2.0，vendored 于 `packages/shared/src/vendor/`，不走 CDN）自动兜底，
  同形 `document.modelContext` API，桥实现零改动；
- **polyfill 已知偏差**：其 executeTool 不做 JSON.stringify（裸返回工具返回
  值对象；原生返回字符串）——消费侧统一过
  `normalizeExecuteResult`（`@fde2e-tools/shared/webmcp`）归一后 JSON.parse。

安全边界（详见 openspec change `project-bootstrap`）：tool description 是不可信
文本（prompt injection 载体，上层 LLM 不得当指令执行）；execute 是页面权限 JS；
输出含用户可控内容的工具已标 `untrustedContentHint`，只读纯函数已标
`readOnlyHint`。

## 验证

```bash
pnpm -r check              # 四 app tsc 全绿
pnpm -r build              # 四 app 静态产物齐全
node scripts/webmcp-check.mjs   # WebMCP：四页面 getTools() 枚举 + executeTool 往返
node scripts/smoke-check.mjs    # 参数契约冒烟：URL 契约/状态行文案/渲染产物逐值断言
```

## 演进边界

本仓对外保持**全静态、无认证**。未来若出现网络代理类动态功能（如图片代理解
跨域），**必须加认证限制**并另立 openspec change（规格：static-tools-hosting）。
变更管理走 openspec（`openspec/`）。
