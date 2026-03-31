# Knowledge Keeper 🧠

智能知识管理插件 - 让 AI 对话自动转化为可搜索的知识库

## 功能

- ✅ **知识保存** - 自动提取对话要点，结构化存储
- ✅ **知识搜索** - 关键词搜索，支持标签筛选
- ✅ **知识回顾** - 按时间范围回顾，统计报告
- ✅ **Markdown 存储** - 兼容 Obsidian、Notion 等笔记软件

## 安装

```bash
openclaw plugins install @openclaw/knowledge-keeper
```

或者从本地安装：

```bash
openclaw plugins install /path/to/knowledge-keeper
```

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
└── index.json      # 索引文件
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