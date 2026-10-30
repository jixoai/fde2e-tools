# static-tools-hosting 规格增量（ADDED）

## ADDED Requirements

### Requirement: 全静态零后端

本仓全部工具（黄页与各工具独立站） SHALL 为纯静态构建产物：零后端、零数据库、
零服务端会话；一切工具逻辑在浏览器本地完成（用户数据不离开本机）。

#### Scenario: 构建产物可任意静态托管

- **WHEN** 任一 app 执行 `pnpm --filter <app> build`
- **THEN** `apps/<app>/dist/` 为自足的静态目录（index.html + assets），可被任意
  静态服务器/Nginx/对象存储直接托管
- **AND** 页面不发起任何对第三方 CDN 的运行时依赖（vendored 依赖全部随产物分发）

#### Scenario: 本地构建不留运行时服务

- **WHEN** 开发者在本地跑 dev server（5271~5274）
- **THEN** dev server 仅绑 IPv4 回环、不对外暴露、不产生任何持久化服务端状态

### Requirement: 静态对外的演进边界（动态代理类功能须加认证限制）

本仓的对外形态 SHALL 默认保持「全静态、无认证」。若未来出现**网络代理类动态
功能**（如图片代理解跨域、服务端渲染、上传中转等任何需要服务端执行或转发的
能力），该功能 MUST：

1. 引入**认证限制**——不得以无认证的公开服务端端点形式上线（防止被滥用为
   开放代理/DDoS 跳板/流量套利）；
2. 保持与静态工具**同一仓、不同能力面**——静态面（黄页与工具页）继续零认证
   对外，动态面单独挂认证边界；
3. 在本规格追加对应能力 spec 并走新 openspec change 评审，不静默扩面。

#### Scenario: 未来新增图片代理功能

- **WHEN** 任何 change 提议在工具站中加入「服务端代理外部图片」类动态能力
- **THEN** 该 change MUST 同时给出认证方案（凭据/限额/来源约束至少其一），
  且 proposal 的 Impact 节显式声明「打破全静态边界」
- **AND** 未携带认证方案的此类 change 不允许进入实现

#### Scenario: 现有三工具不引入服务端

- **WHEN** pdf-tool / img-tool / url-tool 任一工具的新需求到达
- **THEN** 默认以纯前端方式满足（vendored 库、浏览器 API、URL 参数）
- **AND** 跨域受限图源（无 CORS 头）维持现行为：可见但不可导出，并提示用户
  转存素材库——不以此为由引入代理服务端
