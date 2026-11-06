## ADDED Requirements

### Requirement: Film 工具投影保持真实
黄页 MUST 从registry单源呈现Film当前公开工具，MUST 使用官方入口且不得把已实现的检查/渲染描述为占位探测。

#### Scenario: 搜索剪辑工具
- **WHEN** 用户搜索视频剪辑
- **THEN** Film卡呈现44工具并链接正式Film站，新增历史/包/取消能力在完整清单中

### Requirement: 目录发布消费 CI 构建
目录发布 MUST 使用CI构建的artifact，包含源revision与逐文件SHA校验清单。

#### Scenario: 发布校验
- **WHEN** 目录产物上线
- **THEN** 部署字节与成功CI artifact一致，可回查源提交
