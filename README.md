# Knowledge Keeper 🧠

智能知识管理插件 - 让 AI 对话自动转化为可搜索的知识库

## 功能

- ✅ **知识保存** - 自动提取对话要点，结构化存储
- ✅ **知识搜索** - 关键词搜索，支持标签筛选
- ✅ **知识回顾** - 按时间范围回顾，统计报告
- ✅ **Markdown 存储** - 兼容 Obsidian、Notion 等笔记软件
- ✅ **审计日志** - 记录所有操作，完整性验证（v0.4.0 新增）
- ✅ **版本历史** - 记录版本变更，支持回滚（v0.5.0 新增）
- 🆕 **MCP 支持** - 可被 Claude Code、Cursor、Gemini CLI 调用

## 安装

### OpenClaw 插件

```bash
openclaw plugins install @openclaw/knowledge-keeper
```

### MCP Server（独立版）

支持 Claude Code、Cursor、Gemini CLI、Windsurf：

```bash
npm install @zsc-glitch/knowledge-keeper-mcp@alpha
```

详见 [knowledge-keeper-mcp](../knowledge-keeper-mcp/README.md)

## 使用方法

### 保存知识

对我说：
- "记住这个：..."
- "把这个记下来"
- "保存这个想法"

示例：
```
记住这个：每周五下午3点是团队会议
```

### 搜索知识

对我说：
- "查一下关于...的内容"
- "我记得说过..."
- "搜索..."

示例：
```
搜索团队会议
```

### 回顾知识

对我说：
- "回顾一下最近的知识"
- "看看这周学了什么"
- "知识库统计"

## 知识类型

| 类型 | 说明 |
|------|------|
| concept | 概念定义 |
| decision | 决策记录 |
| todo | 待办事项 |
| note | 通用笔记 |
| project | 项目相关 |

## 配置

在 `~/.openclaw/openclaw.json` 中：

```json
{
  "skills": {
    "entries": {
      "knowledge_keeper": {
        "enabled": true,
        "config": {
          "vaultDir": "~/.knowledge-vault"
        }
      }
    }
  }
}
```

## 知识库结构

```
~/.knowledge-vault/
├── concepts/       # 概念定义
├── decisions/      # 决策记录
├── todos/          # 待办事项
├── notes/          # 通用笔记
├── projects/       # 项目相关
├── .audit/         # 审计日志（v0.4.0）
│   └── audit-YYYY-MM-DD.jsonl
└── index.json      # 索引文件
```

## 版本历史功能

v0.5.0 新增版本历史，支持知识点版本追踪和回滚：

### 功能特性

| 功能 | 说明 |
|------|------|
| 版本记录 | 每次更新自动保存版本 |
| 版本对比 | 对比两个版本差异 |
| 版本回滚 | 回滚到任意历史版本 |
| 版本清理 | 自动清理过期版本（默认30天） |

### 版本工具

- `knowledge_versions` - 查看版本历史
- `knowledge_version_get` - 获取指定版本
- `knowledge_version_compare` - 版本对比
- `knowledge_version_rollback` - 版本回滚
- `knowledge_version_stats` - 版本统计
- `knowledge_version_cleanup` - 清理过期版本

### 版本存储结构

```
~/.knowledge-vault/.versions/
├── kp-xxx/           # 每个知识点一个目录
│   └── versions.jsonl
└── index.json        # 版本索引
```

---

## 审计日志功能

v0.4.0 新增审计日志，记录所有知识库操作：

### 支持的操作记录

| 操作 | 说明 |
|------|------|
| save | 保存新知识点 |
| update | 更新知识点 |
| delete | 删除知识点 |
| link/unlink | 关联/取消关联 |
| rename_tag | 重命名标签 |

### 审计特性

- **完整性哈希** - SHA256 哈希链，防篡改
- **按日期分文件** - 便于管理和清理
- **自动清理** - 默认保留 90 天
- **操作前后状态** - 支持未来 rollback 功能

### 使用示例

```
查看审计日志
验证审计完整性
审计统计
清理审计日志（保留90天）
```

## 导出

知识以 Markdown 格式存储，可直接导入：
- Obsidian
- Notion
- Logseq
- 其他支持 Markdown 的笔记软件

## 开发

```bash
# 安装依赖
npm install

# 编译 TypeScript
npm run build

# 测试
npm test
```

## License

MIT

---

## ☕ 支持开发者

如果这个工具对你有帮助，欢迎请我喝杯咖啡 ☕

**微信收款：** （请添加你的微信收款二维码）

---

Made with 🧠 by 小影
---

## ☕ 支持开发者

如果这些工具对你有帮助，欢迎请我喝杯咖啡 ☕

![微信赞赏码](https://raw.githubusercontent.com/zsc-glitch/assets/main/wechat-pay.png)

---

Made with ❤️ by [小影](https://github.com/zsc-glitch)

