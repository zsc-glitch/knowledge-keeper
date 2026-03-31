/**
 * Knowledge Keeper Plugin
 * 智能知识管理插件
 */

import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";

// 知识类型
const KnowledgeTypes = ["concept", "decision", "todo", "note", "project"];

// 类型目录映射
const TypeDirs = {
  concept: "concepts",
  decision: "decisions",
  todo: "todos",
  note: "notes",
  project: "projects",
};

// 时期标签
const PeriodLabels = {
  today: "今天",
  week: "最近一周",
  month: "最近一个月",
  all: "全部",
};

// 获取知识库目录
function getVaultDir(config) {
  const dir = config?.vaultDir || process.env.KNOWLEDGE_KEEPER_DIR || "~/.knowledge-vault";
  return dir.replace("~", os.homedir());
}

// 生成知识点 ID
function generateId() {
  const date = new Date();
  const dateStr = date.toISOString().slice(0, 10).replace(/-/g, "");
  const rand = Math.random().toString(36).slice(2, 5);
  return `kp-${dateStr}-${rand}`;
}

// 确保目录存在
async function ensureDir(dir) {
  try {
    await fs.mkdir(dir, { recursive: true });
  } catch {
    // 目录已存在
  }
}

// 格式化知识点为 Markdown
function formatMarkdown(kp) {
  return `---
id: ${kp.id}
type: ${kp.type}
title: ${kp.title}
tags: [${kp.tags.join(", ")}]
created: ${kp.created}
updated: ${kp.updated}
source: ${kp.source}
---

# ${kp.title}

${kp.content}
`;
}

// 解析 Markdown 为知识点
function parseMarkdown(content) {
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!frontmatterMatch) return null;

  const [, frontmatter, body] = frontmatterMatch;
  const lines = frontmatter.split("\n");
  const meta = {};

  for (const line of lines) {
    const [key, ...valueParts] = line.split(":");
    if (key && valueParts.length > 0) {
      meta[key.trim()] = valueParts.join(":").trim();
    }
  }

  // 提取标题
  const titleMatch = body.match(/^#\s+(.+)$/m);
  const title = titleMatch ? titleMatch[1] : "Untitled";

  // 提取内容
  const contentWithoutTitle = body.replace(/^#\s+.+\n/, "").trim();

  // 解析标签
  const tagsMatch = meta.tags?.match(/\[([^\]]*)\]/);
  const tags = tagsMatch
    ? tagsMatch[1].split(",").map((t) => t.trim()).filter(Boolean)
    : [];

  return {
    id: meta.id || generateId(),
    type: meta.type || "note",
    title,
    content: contentWithoutTitle,
    tags,
    created: meta.created || new Date().toISOString(),
    updated: meta.updated || new Date().toISOString(),
    source: meta.source || "manual",
  };
}

// 更新索引
async function updateIndex(vaultDir, kp) {
  const indexPath = path.join(vaultDir, "index.json");

  let index = { entries: [] };

  try {
    const content = await fs.readFile(indexPath, "utf-8");
    index = JSON.parse(content);
  } catch {
    // 索引不存在
  }

  index.entries.push(kp);
  await fs.writeFile(indexPath, JSON.stringify(index, null, 2), "utf-8");
}

// 插件定义
export default {
  id: "knowledge-keeper",
  name: "Knowledge Keeper",
  description: "智能知识管理 - 自动提取对话要点、整理知识库、语义搜索",

  register(api, config) {
    const pluginConfig = config;

    // 保存知识工具
    api.registerTool(
      {
        name: "knowledge_save",
        description: "保存知识点到知识库。用于记录重要信息、决策、想法等。",
        parameters: {
          type: "object",
          properties: {
            type: {
              type: "string",
              enum: KnowledgeTypes,
              description: "知识类型：concept(概念), decision(决策), todo(待办), note(笔记), project(项目)",
            },
            title: {
              type: "string",
              description: "知识标题",
            },
            content: {
              type: "string",
              description: "知识内容",
            },
            tags: {
              type: "array",
              items: { type: "string" },
              description: "标签列表",
            },
          },
          required: ["type", "title", "content"],
        },
        async execute(_id, params) {
          try {
            const vaultDir = getVaultDir(pluginConfig);
            const typeDir = TypeDirs[params.type];
            const targetDir = path.join(vaultDir, typeDir);

            await ensureDir(targetDir);

            const kp = {
              id: generateId(),
              type: params.type,
              title: params.title,
              content: params.content,
              tags: params.tags || [],
              created: new Date().toISOString(),
              updated: new Date().toISOString(),
              source: "conversation",
            };

            const filename = `${kp.id}.md`;
            const filepath = path.join(targetDir, filename);
            const markdown = formatMarkdown(kp);

            await fs.writeFile(filepath, markdown, "utf-8");
            await updateIndex(vaultDir, kp);

            return {
              content: [
                {
                  type: "text",
                  text: `✅ 知识已保存\n\n📝 **${kp.title}**\n类型: ${kp.type}\nID: ${kp.id}\n标签: ${kp.tags.join(", ") || "无"}\n路径: ${filepath}`,
                },
              ],
            };
          } catch (error) {
            return {
              content: [
                {
                  type: "text",
                  text: `❌ 保存失败: ${error.message}`,
                },
              ],
            };
          }
        },
      },
      { optional: true }
    );

    // 搜索知识工具
    api.registerTool(
      {
        name: "knowledge_search",
        description: "搜索知识库中的知识点。支持关键词搜索和标签筛选。",
        parameters: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "搜索关键词",
            },
            type: {
              type: "string",
              enum: KnowledgeTypes,
              description: "按类型筛选",
            },
            tags: {
              type: "array",
              items: { type: "string" },
              description: "按标签筛选",
            },
            limit: {
              type: "number",
              description: "返回结果数量限制，默认10",
            },
          },
          required: ["query"],
        },
        async execute(_id, params) {
          try {
            const vaultDir = getVaultDir(pluginConfig);
            const results = [];
            const limit = params.limit || 10;

            const types = params.type ? [params.type] : [...KnowledgeTypes];

            for (const type of types) {
              const typeDir = path.join(vaultDir, TypeDirs[type]);
              try {
                const files = await fs.readdir(typeDir);
                for (const file of files) {
                  if (!file.endsWith(".md")) continue;

                  const filepath = path.join(typeDir, file);
                  const content = await fs.readFile(filepath, "utf-8");
                  const kp = parseMarkdown(content);

                  if (!kp) continue;

                  const queryLower = params.query.toLowerCase();
                  const matchesQuery =
                    kp.title.toLowerCase().includes(queryLower) ||
                    kp.content.toLowerCase().includes(queryLower);

                  const matchesTags =
                    !params.tags ||
                    params.tags.every((tag) =>
                      kp.tags.some((t) => t.toLowerCase().includes(tag.toLowerCase()))
                    );

                  if (matchesQuery && matchesTags) {
                    results.push(kp);
                    if (results.length >= limit) break;
                  }
                }
              } catch {
                // 目录不存在
              }
              if (results.length >= limit) break;
            }

            if (results.length === 0) {
              return {
                content: [
                  {
                    type: "text",
                    text: `🔍 未找到匹配的知识点\n\n搜索: "${params.query}"${params.type ? `\n类型: ${params.type}` : ""}${params.tags ? `\n标签: ${params.tags.join(", ")}` : ""}`,
                  },
                ],
              };
            }

            const resultText = results
              .map(
                (kp, i) =>
                  `${i + 1}. **${kp.title}** (${kp.type})\n   ID: ${kp.id}\n   ${kp.content.slice(0, 100)}${kp.content.length > 100 ? "..." : ""}\n   标签: ${kp.tags.join(", ") || "无"}`
              )
              .join("\n\n");

            return {
              content: [
                {
                  type: "text",
                  text: `🔍 找到 ${results.length} 条知识点\n\n${resultText}`,
                },
              ],
            };
          } catch (error) {
            return {
              content: [
                {
                  type: "text",
                  text: `❌ 搜索失败: ${error.message}`,
                },
              ],
            };
          }
        },
      },
      { optional: true }
    );

    // 回顾知识工具
    api.registerTool(
      {
        name: "knowledge_review",
        description: "回顾知识库，显示最近的知识点或统计数据。",
        parameters: {
          type: "object",
          properties: {
            period: {
              type: "string",
              enum: ["today", "week", "month", "all"],
              description: "时间范围：today, week, month, all，默认 week",
            },
            type: {
              type: "string",
              enum: KnowledgeTypes,
              description: "按类型筛选",
            },
          },
        },
        async execute(_id, params) {
          try {
            const vaultDir = getVaultDir(pluginConfig);
            const period = params.period || "week";
            const results = [];

            const now = new Date();
            let startDate;
            switch (period) {
              case "today":
                startDate = new Date(now.setHours(0, 0, 0, 0));
                break;
              case "week":
                startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
                break;
              case "month":
                startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
                break;
              default:
                startDate = new Date(0);
            }

            const types = params.type ? [params.type] : [...KnowledgeTypes];

            for (const type of types) {
              const typeDir = path.join(vaultDir, TypeDirs[type]);
              try {
                const files = await fs.readdir(typeDir);
                for (const file of files) {
                  if (!file.endsWith(".md")) continue;

                  const filepath = path.join(typeDir, file);
                  const content = await fs.readFile(filepath, "utf-8");
                  const kp = parseMarkdown(content);

                  if (!kp) continue;

                  const kpDate = new Date(kp.created);
                  if (kpDate >= startDate) {
                    results.push(kp);
                  }
                }
              } catch {
                // 目录不存在
              }
            }

            results.sort((a, b) => new Date(b.created) - new Date(a.created));

            const stats = {};
            for (const type of KnowledgeTypes) {
              stats[type] = 0;
            }
            for (const kp of results) {
              stats[kp.type]++;
            }

            if (results.length === 0) {
              return {
                content: [
                  {
                    type: "text",
                    text: `📊 知识库回顾 (${PeriodLabels[period]})\n\n暂无知识点\n\n统计:\n- 概念: ${stats.concept}\n- 决策: ${stats.decision}\n- 待办: ${stats.todo}\n- 笔记: ${stats.note}\n- 项目: ${stats.project}`,
                  },
                ],
              };
            }

            const recentText = results
              .slice(0, 10)
              .map(
                (kp, i) =>
                  `${i + 1}. **${kp.title}** (${kp.type})\n   ${new Date(kp.created).toLocaleDateString("zh-CN")}`
              )
              .join("\n\n");

            return {
              content: [
                {
                  type: "text",
                  text: `📊 知识库回顾 (${PeriodLabels[period]})\n\n共 ${results.length} 条知识点\n\n统计:\n- 概念: ${stats.concept}\n- 决策: ${stats.decision}\n- 待办: ${stats.todo}\n- 笔记: ${stats.note}\n- 项目: ${stats.project}\n\n最近的知识点:\n\n${recentText}`,
                },
              ],
            };
          } catch (error) {
            return {
              content: [
                {
                  type: "text",
                  text: `❌ 回顾失败: ${error.message}`,
                },
              ],
            };
          }
        },
      },
      { optional: true }
    );
  },
};