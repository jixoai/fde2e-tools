# Film 工具黄页同权修复

## Why
原会话审计发现 Film 能力补齐后，黄页仍登记35工具，遗漏包导入、历史回收与取消等公开能力。Owner已授权直接修复。

## What Changes
- registry从实际44工具投影补齐元数据与用途，保持唯一源。
- 目录检查与浏览器搜索入口验证同步。
- 静态目录经CI构建带revision与校验清单的artifact，部署消费同一字节。

## Capabilities
### New Capabilities
- `film-directory`: Film能力在黄页的真实投影与CI静态交付。

## Impact
packages/shared registry、directory静态构建与验收脚本；不改其它工具实现。
