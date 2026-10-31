# fde2e-tools 项目指令

> 补充（不覆盖）主仓 `~/.agents/AGENTS.md`、`~/.zcode/AGENTS.md` 与 fde2e 主仓 AGENTS.md。

## 产品红线（违反＝返工）

1. **全静态零后端**：一切工具纯前端实现（浏览器 API / vendored 库 / URL 参数），
   不引入任何服务端。「图源无 CORS 头」维持现行为（可见不可导＋提示转存素材库），
   不以此为由加代理。未来动态代理类功能必须**带认证方案**立项（spec:
   static-tools-hosting「静态对外的演进边界」）。
2. **URL 参数契约保真**：pdf-tool / img-tool / url-tool 已有智能体按 URL 参数
   调用。参数名、取值语义、默认值、clamp、状态行文案（#status）一字不改；
   新参数只许追加。改契约＝改 registry + 改 app + 改 ai-guide 三面同步。
   办公三站 URL 契约只有 `?sample=`（示例载入，不触发生成）。
3. **DOM id 稳定**：ai-guide 引用的全部可交互元素 id 是行为的一部分，迁移/重构
   不得改名；输入类元素保持**非受控**（智能体程序化 set value 后点按钮必须生效）。
4. **registry 单源**：工具元数据只活在 `packages/shared/src/registry.ts`——黄页、
   工具页、WebMCP schema 派生三面消费它；加工具＝registry 加一条 + 新建
   apps/<id>，禁止在消费侧复刻第二份。
5. **UI 组件零手写仿制**：组件只从 shadcn/ui 官方 registry（base-nova style）
   收编进 `packages/shared/src/ui/`，逐字保留、文件头注明出处；组合形态用官方
   底座件。视觉问题回到官方源排查，不手调。

## 工程纪律

- **接口一致性审查（2026-10-31 接口审查裁决制度化，记住！）**：接口变更
  （新增/改参/改名/改返回形态）必须——①对照 `docs/webmcp-interface-guidelines.md`
  逐条自查（items 统一选择器、旧名兼容别名与同传互斥、filename×tag 优先级、
  ok:false 全带 error 不 reject、URL 层与工具层契约语汇分立）；②过
  `node scripts/interface-lint.mjs`（静态：registry/EXPECT/webmcp 三面一致＋
  schema additionalProperties 全关＋参数 camelCase＋选择器白名单）；③
  `pnpm webmcp:check` 非法入参矩阵（每工具非法输入必须 resolve
  {ok:false, error}）。同名工具跨站必须同名且同义；同名不同义必须改名或显式
  区分（先例：pptx export_png＝逐页多文件，长图＝export_long_png＋别名
  export_pages_png）。
- **vendor 纪律**：上游副本（solid-glass 主题、WebMCP polyfill）逐字收编、
  本地零改动、文件头/README 注明来源与许可；升级＝重取 diff，适配只在消费侧。
- **WebMCP**：工具注册走 `@fde2e-tools/shared/webmcp` 统一助手（原生探测＋
  polyfill 兜底），不要各 app 自写注册循环；工具 inputSchema 双轨——URL 参数型
  用 schemaFromUrlParams 从 registry 派生，结构化参数型（url-tool pack_url、
  办公三站 create_*）在各 app webmcp.ts 内定义（registry urlParams 是扁平 URL
  契约面，承载不了嵌套结构；registry tools 字段仍登记工具名与说明，黄页投影
  单源）；输出含用户可控内容必须标 `untrustedContentHint`。**polyfill 偏差**：
  executeTool 裸返回对象（不 stringify，vendor 不能改）——消费侧必须过
  `normalizeExecuteResult` 归一（原生返回字符串），两条路径才同形。
- **绿门**：`pnpm -r check && pnpm -r build` 全绿；涉工具注册/页面的改动加跑
  `pnpm webmcp:check`（原生+polyfill 双路径，含办公三站 create_* 全链真下载）
  与 `pnpm smoke:check`（含 pdf 导出真下载断言与办公三站**真文件反读断言**）。
  办公三站的生成链改动必须过真文件反读门：xlsx 用 SheetJS Node 侧逐格核对、
  docx/pptx 解 zip 核对 OOXML 关键内容——只断言状态行不算覆盖。改动 pdf 导出
  路径必须过 B1 色守卫（export-color-guard）——html2canvas 1.4.x 不识别 oklch，
  守卫缺失＝导出 100% 抛错。
- **办公线红线（office-suite ＋ office-editorial-upgrade）**：
  - **轻量生成线（easy-*）与 packages/shared 禁 AGPL 不放宽**（ranuts/document
    不得以任何依赖形态进入；npm `xlsx` 0.18.5 带 CVE 禁引入——用 CDN tarball
    0.20.3）；生成库一律动态 import 独立 chunk（改动后 grep 各 dist 验证其它站
    零生成库代码）。
  - **编辑器三站（xlsx/docx/pptx 主域名）**：内核库（Univer/TipTap/docx+mammoth/
    PPTist）一律 dynamic import 懒加载独立 chunk；**apps/pptx 目录整体 AGPL-3.0
    隔离**（PPTist vendored 于 src/pptist/ 逐字零改动仅排除入口 main.ts；其代码
    与依赖禁入 packages/shared 与其它 app；许可边界见 apps/pptx/README.md；
    上游升级＝git archive 重取 diff）；编辑器站下载文件名契约沿用
    `<站id>-export.<ext>`，safeFilename 单源清洗；URL 契约只有 `?sample=`。
  - **Univer 写入双坑防御（univer-write-gate）**：seed 一律经完整快照格式工厂
    （snapshot.ts 单源，禁简化格式——幽灵工作簿静默拒写）；写命令一律过
    Rendered 生命周期门禁（未就绪显式 ok:false，禁静默失败）；两坑各有 smoke
    回归断言，改动写入路径必须重跑。
- **TW4 扫描面**：各 app 的 app.css 已 `source("../")` 收窄并把 shared 加源；
  给 shared/ui 新增组件类名后无需改 CSS 配置，但新增目录要确认被 `@source`
  覆盖。
- **部署**：`TOOLS_DEST=<目标> bash deploy/tools-upload.sh <app>`（目标目录与
  vhost 由编排者管理）；本仓禁把密钥/服务器路径硬编码进任何入库文件。
- **变更管理走 openspec**（本仓 `openspec/`）：先 change（proposal/tasks/specs）
  再实现；交付即归档。
- **TS 模板字符串生成文本含字面反斜杠时必须双写**（`\\n`），写完对构建产物
  grep 验证（img-tool ai-guide 是现例）。
