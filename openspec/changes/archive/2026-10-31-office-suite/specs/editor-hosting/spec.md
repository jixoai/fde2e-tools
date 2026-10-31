# editor-hosting 规格增量（ADDED）

## ADDED Requirements

### Requirement: AGPL 合规托管形态（深度集成禁令）

ranuts/document（AGPL-3.0，含 ONLYOFFICE 上游附加条款，NOTICE 声明 derivative
work）作为编辑器站部署到 `editor.tool.fde2e.com` 时，SHALL 采用**未修改的上游
构建产物独立部署**形态：

- 禁把其源码/构建产物 vendor 进本仓（MIT/Apache 系仓库不得混入 AGPL 内容）；
- 禁改其代码后部署（改源码即触发 AGPL §13 更重义务，须另过法务）；
- 禁与其余工具站深度集成（不得以 npm 依赖、import、同源同进程形态嵌入三构建
  站或黄页的代码链）——合法形态只有：独立子域/独立容器自部署 + 页面外链；
- AI 消费 SHALL 走其自带的 WebMCP 7 工具（open_document_url /
  open_document_buffer / create_document / save_document / get_document_text /
  set_readonly / get_document_state）与 embed API（iframe postMessage），
  由编排者在消费侧另行接线。

#### Scenario: 仓库不含 AGPL 内容

- **WHEN** 审计本仓任一入库文件
- **THEN** 无 ranuts/document 的源码或构建产物（部署物只存在于服务器/镜像层）

#### Scenario: 生成链与编辑器链分离

- **WHEN** 三构建站生成文件
- **THEN** 生成链只用 MIT/Apache 库，不经编辑器/OnlyOffice 引擎（编辑器定位
  是「编辑/转换」工具位，digest 实证其无数据→文件生成 API）

### Requirement: source 指引义务

部署 SHALL 满足 AGPL §13 网络服务义务的较稳形态：不改上游文件，在部署面提供
**来源与 license 指引**——以独立附属页（如 `/fde2e-source-note.html`，不修改
上游任何文件）或 vhost 附属路径声明：上游仓库地址、部署所钉的上游版本
（tag/commit 或镜像 digest）、获取完整对应源码的方式。

#### Scenario: 来源指引可达

- **WHEN** 用户访问编辑器站的 source 指引页
- **THEN** 可看到上游仓库、钉定版本与 AGPL-3.0 license 说明

### Requirement: 二期部署方案（钉版本拉上游产物）

本轮（2026-10-31）实测结论：上游 GitHub release v0.0.5~v0.0.8 均无构建产物
资产；自建须搬 300MB+ vendored 树（sdkjs 125MB + fonts 184MB）跑其官方构建
流程；官方 docker 镜像（ghcr.io/ranuts/document）内含专用 static-web-server
与 sws.toml 编码配置（.br/.gz 与缓存头），提取静态树给 OpenResty 直挂不成立。
故编辑器站降级为**二期**，部署 SHALL 按以下方案执行（编排者侧）：

1. 首选：服务器直接运行官方镜像**钉 digest**（`docker pull
   ghcr.io/ranuts/document@sha256:<digest>`），OpenResty 反代
   `editor.tool.fde2e.com` → 本机回环端口（端口按主仓 PORT.md 台账纪律认领）；
2. 备选：钉上游 tag（如 v0.0.8）按其官方构建流程（`bin/build.sh`）出静态包，
   自建同等 static-web-server 配置托管；
3. 上线前补齐 source 指引页与本地 headless 冒烟（编辑器可加载、保存流可用）。

`deploy/editor-fetch.sh` SHALL 记录钉版本拉取/验证的准备步骤，本轮不执行
（未上线）。

#### Scenario: 二期上线 checklist

- **WHEN** 编排者执行二期上线
- **THEN** 按 deploy/editor-fetch.sh 钉 digest 拉取并记录镜像指纹
- **AND** 反代 + source 指引 + headless 冒烟三步完成后才对外
