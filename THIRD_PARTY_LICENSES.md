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
| @paper-design/shaders | 0.0.82 | Apache-2.0 | Paper Shaders：WebGL2 背景生成/图像处理（mesh/glass/paper） |
| react / react-dom | 19.x | MIT | UI |
| Noto Sans SC | Google Fonts | OFL-1.1（见 `packages/shared/assets/fonts/OFL.txt`） | 内置中文字体；`*.subset.woff2` 为构建期常用字子集 |

- MPL-2.0 组件的源码可从其 npm 包/上游仓库获取；本仓不修改其源码。
- 字体版权不拦截：用户提供的字体 URL 由使用方自行确认授权，Canvas 只记录 provenance。

## Paper Shaders

Paper Shaders
Copyright 2026 Paper

Powered by Paper Shaders:
https://shaders.paper.design

- 上游许可：Apache-2.0；完整许可与 NOTICE 已随仓落位 `apps/canvas/third-party/paper-shaders/{LICENSE,NOTICE}`（与 npm 包 0.0.82 一致），本仓不修改其源码。
- 使用范围：Canvas 内置背景生成/处理（Static Mesh Gradient / Fluted Glass / Paper Texture），页面内 WebGL2 光栅化为静帧资产；不引入 `@paper-design/shaders-react`。
- 页面署名：Canvas 页脚 `Powered by Paper Shaders`。
