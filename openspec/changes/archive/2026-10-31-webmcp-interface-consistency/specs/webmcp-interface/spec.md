# webmcp-interface 规格增量（ADDED）

## ADDED Requirements

### Requirement: 接口设计指南与三面一致

全仓 WebMCP 工具 SHALL 遵守 `docs/webmcp-interface-guidelines.md`（一等文档：
命名/寻址/返回形态/文件名契约/错误形态/文档单源与 URL·工具契约区分/版本化兼容）。
registry.ts、各 app webmcp.ts 注册面、webmcp-check EXPECT 三面 MUST 逐工具一致；
`scripts/interface-lint.mjs` 静态门禁 SHALL 断言：schema `additionalProperties:false`
全关、参数名 camelCase、选择器统一 `items`（`sheets/section/pages` 仅兼容别名）、
ok:false 分支必带 error、img-tool 工具层 description 用裸 `#rrggbb` 而 registry
urlParams 用 URL 层 `%23rrggbb`。

#### Scenario: 接口变更过审查门

- **WHEN** 新增/改参/改名的接口变更被提交
- **THEN** `node scripts/interface-lint.mjs` 全过且 `pnpm webmcp:check` 非法入参
  矩阵全绿，否则视为未完成

### Requirement: 非法入参矩阵（resolve 不 reject）

每工具 SHALL 对非法输入返回 `{ok:false, error: 人话}`（error 非空、含可检索
语汇），execute MUST NOT reject。绿门 SHALL 覆盖：非编辑器 8 站每工具 2-3 个
非法输入；编辑器三站（就绪后）选择器互斥（items×旧名「只能用一个」）/单元缺
关键字段/越界/非法区域/区域无交集。

#### Scenario: 旧名与新选择器同传

- **WHEN** `export_pdf({items:[...], sheets:[...]})`（或 pages/section 同形）
- **THEN** 返回 `ok:false` 且 error 含「只能用一个」（禁静默取舍），execute 不 reject

### Requirement: 文件名优先级与逐页前缀

下载型工具 SHALL 遵循 `resolveDownloadName` 单源文件名契约：自定义 `filename`
为主、选择 tag 追加其上（`<自定义stem>-<tag>.<ext>`）；逐页多文件导出的
`filename` 为前缀语义（pptx export_png：`foo` → `foo-01.png` 起，序号＝原 deck
页码，缺省前缀 `pptx-page` 不变）；`export_pages_png` SHALL 作为 `export_png`
别名工具（同 execute）存在并在 registry/EXPECT 三面登记。

#### Scenario: 自定义文件名不丢

- **WHEN** `export_pdf({filename:"汇报", pages:[2]})`
- **THEN** 下载 `汇报-p2.pdf`（自定义 stem＋tag），`selected=[2]`

### Requirement: 工具层与 URL 层契约语汇分立

URL 参数契约（registry urlParams）SHALL 用编码后形态（img-tool 颜色
`%23rrggbb`）；工具层 description/schema SHALL 用解码后形态（裸 `#rrggbb`）。
工具 execute SHALL 对已发布调用方按旧文档传入的 `%23` 开头色值剥一层编码
（仅 color/bg 两键），两形态产物颜色一致。

#### Scenario: 两形态色值

- **WHEN** `overlay_text({src:"sample", bg:"#ff0000"})` 与 `bg:"%23ff0000"` 各调一次
- **THEN** 两次底衬均以纯红落画布（像素断言），不得静默回退默认色

### Requirement: 查询类工具返回 ok 面

只读查询工具（directory list_tools/search_tools）成功返回 SHALL 带
`ok: true` 与业务字段（count/tools），错误路径同样 ok:false＋error。

#### Scenario: 黄页查询

- **WHEN** `list_tools({})` / `search_tools({query:"pdf"})`
- **THEN** 返回 `ok:true`、count 正确、tools 带 webmcpTools 投影
