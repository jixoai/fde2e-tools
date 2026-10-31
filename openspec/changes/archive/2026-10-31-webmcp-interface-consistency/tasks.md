# Tasks: webmcp-interface-consistency

## 1. A 批修复（接口审查断层，零破坏）

- [x] 1.1 **F23 img-tool 颜色双重编码**：工具层 description 改裸 `#rrggbb`；
      execute 对 color/bg 的 `%23` 开头值剥一层编码（已发布调用方兜底）；
      smoke 断言裸 `#ff0000` 与 `%23ff0000` 两形态底衬纯红落画布。
- [x] 1.2 **F8 filename×选择参数**：shared `resolveDownloadName` 单源
      （自定义 filename 为主、tag 追加其上）；xlsx export_pdf/export_png/
      export_xlsx、pptx export_pdf/export_long_png、docx export_pdf/export_png
      七处改正；smoke 断言 `周报附件-周营收-A1F5.pdf` / `汇报-p2.pdf`。
- [x] 1.3 **F16 裸 throw 残留**：xlsx set_formula/format_range 前置 A1 校验转
      ok:false（checkA1Prefix）；file-viewer preview_file 缺 url → ok:false。
- [x] 1.4 **F15/F24/F26/F27**：directory list_tools/search_tools + ok:true；
      easy-* 三站头注释路径修正；set_cells 错误文案带收到值形态（describeValue）；
      pptx pages schema 补单数 number 形态。

## 2. 制度化落仓

- [x] 2.1 `docs/webmcp-interface-guidelines.md` v1（七条 + 断层台账 A/B/C/D）；
      README 架构图与「单源纪律」段、repo AGENTS.md「接口一致性审查」条目指针。
- [x] 2.2 `scripts/interface-lint.mjs` 静态 lint：三面一致（registry↔各 app
      webmcp.ts↔webmcp-check EXPECT）／schema additionalProperties:false／
      参数 camelCase／选择器白名单（items＋旧名）／ok:false 必带 error／
      img-tool URL·工具双层契约。10 app 全过。
- [x] 2.3 webmcp-check 非法入参矩阵：非编辑器 8 站（pdf/img/url/file-viewer/
      easy-*/directory）每工具 2 个非法输入 + directory 正例 ok:true；编辑器三站
      矩阵挂 EDITOR_FULL_CHAIN[].illegal（就绪后执行：items×旧名互斥/缺字段/
      越界/非法区域/无交集）。断言 resolve {ok:false, error} 且不 reject。

## 3. 绿门（既有断言零缩水）

- [x] 3.1 smoke-check 新增：img-tool F23 两形态；pptx F5（filename 前缀
      foo-01/foo-02）＋F8（汇报-p2.pdf）＋export_pages_png 别名＋items≡pages＋
      互斥；docx items 多节＋F9 文件名（docx-export-节名.pdf）＋互斥。
- [x] 3.2 `pnpm -r check && pnpm -r build`、interface-lint、webmcp-check、
      smoke-check 全量重跑（证据见本轮报告）。

## 4. 收口

- [x] 4.1 小步中文 commit（不 push）。
- [ ] 4.2 change 归档（交付验证后随 commit 入库）。

## 5. 后续排期（本轮不做）

- [ ] 5.1 **C 批（v1.2 change）**：F14 error 增发全站扫尾、F17 selected 统一规范、
      F6 slideCount。
- [ ] 5.2 **D 批（v2 change，破坏性带 migration）**：F19 easy 站改名、F12 全仓
      统一 1 基、F11 A1 主推。
