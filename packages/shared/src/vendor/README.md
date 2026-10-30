# vendor/ —— 逐字收编的上游副本（禁手改）

| 文件 | 来源 | 许可 | 收编日期 |
| --- | --- | --- | --- |
| `webmcp-polyfill.js` | [GoogleChromeLabs/webmcp-tools](https://github.com/GoogleChromeLabs/webmcp-tools) `demos/shared/webmcp-polyfill.js`（main） | Apache-2.0（文件头保留） | 2026-10-30 |

纪律：与 omni 的 solid-glass vendor 同款——**逐字收编、本地零改动**（升级＝重新下载替换并 diff）；
适配只允许发生在消费侧（`src/webmcp.ts` 经动态 import 加载，polyfill 自带「原生
`document.modelContext` 存在即跳过」守卫）。不走 CDN，保证静态站零外网依赖。
