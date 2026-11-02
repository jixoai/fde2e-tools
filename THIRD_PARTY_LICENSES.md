# Third-party licenses

本仓主体为 Apache-2.0（见 `LICENSE`）。以下依赖/资产随 Canvas 工具（`apps/canvas`）分发：

| 组件 | 版本/来源 | 许可 | 用途 |
| --- | --- | --- | --- |
| satori | 0.63.x | MPL-2.0 | JSON/React element → SVG |
| @resvg/resvg-wasm | 2.6.x | MPL-2.0 | SVG → PNG（WASM） |
| fontkit | 2.0.x | MIT | 字体解析/字形路径 |
| linebreak | 1.1.x | MIT | Unicode 换行 |
| bidi-js | 1.0.x | MIT | 双向文本 |
| svgpath | 2.6.x | MIT | SVG path 变换 |
| dompurify | 3.x | Apache-2.0 OR MPL-2.0 | SVG 清洗 |
| react / react-dom | 19.x | MIT | UI |
| Noto Sans SC | Google Fonts | OFL-1.1（见 `packages/shared/assets/fonts/OFL.txt`） | 内置中文字体；`*.subset.woff2` 为构建期常用字子集 |

- MPL-2.0 组件的源码可从其 npm 包/上游仓库获取；本仓不修改其源码。
- 字体版权不拦截：用户提供的字体 URL 由使用方自行确认授权，Canvas 只记录 provenance。
