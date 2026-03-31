/**
 * Knowledge Keeper Plugin
 * 智能知识管理插件
 */

import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { Type } from "@sinclair/typebox";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";

// 知识类型
type KnowledgeType = "concept" | "decision" | "todo" | "note" | "project";

// 知识点结构
interface KnowledgePoint {
  id: string;
  type: KnowledgeType;
  title: string;
  content: string;
  tags: string[];
  links: string[]; // 关联的知识点 ID
  created: string;
  updated: string;
  source: "conversation" | "manual";
}

// 索引结构
interface KnowledgeIndex {
  version: number;
  entries: KnowledgePoint[];
  tagsIndex: Record<string, string[]>; // tag -> [id1, id2, ...]
}

// 插件配置
interface PluginConfig {
  vaultDir?: string;
  autoExtract?: boolean;
  reviewReminder?: boolean;
}

// 错误类型
class KnowledgeError extends Error {
  constructor(
    message: string,
    public code: string,
    public details?: Record<string, unknown>
  ) {
    super(message);
    this.name = "KnowledgeError";
  }
}

// 获取知识库目录
function getVaultDir(config?: PluginConfig): string {
  const dir = config?.vaultDir || process.env.KNOWLEDGE_KEEPER_DIR || "~/.knowledge-vault";
  return dir.replace("~", os.homedir());
}

// 生成知识点 ID
function generateId(): string {
  const date = new Date();
  const dateStr = date.toISOString().slice(0, 10).replace(/-/g, "");
  const rand = Math.random().toString(36).slice(2, 5);
  return `kp-${dateStr}-${rand}`;
}

// 确保目录存在
async function ensureDir(dir: string): Promise<void> {
  try {
    await fs.mkdir(dir, { recursive: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EEXIST") {
      throw new KnowledgeError(
        `无法创建目录: ${dir}`,
        "DIR_CREATE_FAILED",
        { dir, error: err }
      );
    }
  }
}

// 获取类型对应的子目录
function getTypeDir(type: KnowledgeType): string {
  const dirs: Record<KnowledgeType, string> = {
    concept: "concepts",
    decision: "decisions",
    todo: "todos",
    note: "notes",
    project: "projects",
  };
  return dirs[type];
}

// 格式化知识点为 Markdown
function formatMarkdown(kp: KnowledgePoint): string {
  return `---
id: ${kp.id}
type: ${kp.type}
title: ${kp.title.replace(/\n/g, " ")}
tags: [${kp.tags.join(", ")}]
links: [${(kp.links || []).join(", ")}]
created: ${kp.created}
updated: ${kp.updated}
source: ${kp.source}
---

# ${kp.title}

${kp.content}
`;
}

// 解析 Markdown 为知识点
function parseMarkdown(content: string, filepath?: string): KnowledgePoint | null {
  try {
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    if (!frontmatterMatch) return null;

    const [, frontmatter, body] = frontmatterMatch;
    const lines = frontmatter.split("\n");
    const meta: Record<string, string> = {};

    for (const line of lines) {
      const colonIndex = line.indexOf(":");
      if (colonIndex > 0) {
        const key = line.slice(0, colonIndex).trim();
        const value = line.slice(colonIndex + 1).trim();
        meta[key] = value;
      }
    }

    // 提取标题（第一个 # 标题）
    const titleMatch = body.match(/^#\s+(.+)$/m);
    const title = titleMatch ? titleMatch[1].trim() : "Untitled";

    // 提取内容（去掉标题后的部分）
    const contentWithoutTitle = body.replace(/^#\s+.+\n/, "").trim();

    // 解析标签
    const tagsMatch = meta.tags?.match(/\[([^\]]*)\]/);
    const tags = tagsMatch
      ? tagsMatch[1].split(",").map((t) => t.trim()).filter(Boolean)
      : [];

    // 解析关联
    const linksMatch = meta.links?.match(/\[([^\]]*)\]/);
    const links = linksMatch
      ? linksMatch[1].split(",").map((l) => l.trim()).filter(Boolean)
      : [];

    return {
      id: meta.id || generateId(),
      type: (meta.type as KnowledgeType) || "note",
      title,
      content: contentWithoutTitle,
      tags,
      links,
      created: meta.created || new Date().toISOString(),
      updated: meta.updated || new Date().toISOString(),
      source: (meta.source as "conversation" | "manual") || "manual",
    };
  } catch (err) {
    console.error(`解析 Markdown 失败: ${filepath || "unknown"}`, err);
    return null;
  }
}

// 通过 ID 查找知识点文件路径
async function findKnowledgeFile(vaultDir: string, id: string): Promise<string | null> {
  const types: KnowledgeType[] = ["concept", "decision", "todo", "note", "project"];

  for (const type of types) {
    const typeDir = path.join(vaultDir, getTypeDir(type));
    const filepath = path.join(typeDir, `${id}.md`);
    try {
      await fs.access(filepath);
      return filepath;
    } catch {
      // 文件不存在，继续查找
    }
  }
  return null;
}

// 通过 ID 加载知识点
async function loadKnowledgeById(vaultDir: string, id: string): Promise<{ kp: KnowledgePoint; filepath: string } | null> {
  const filepath = await findKnowledgeFile(vaultDir, id);
  if (!filepath) return null;

  const content = await fs.readFile(filepath, "utf-8");
  const kp = parseMarkdown(content, filepath);
  if (!kp) return null;

  return { kp, filepath };
}

// 索引文件锁
let indexLock = Promise.resolve();

// 更新索引（带锁）
async function updateIndex(
  vaultDir: string,
  kp: KnowledgePoint,
  mode: "add" | "remove" | "update" = "add"
): Promise<void> {
  // 使用简单的 Promise 链实现锁
  return indexLock = indexLock.then(async () => {
    const indexPath = path.join(vaultDir, "index.json");

    let index: KnowledgeIndex = { version: 1, entries: [], tagsIndex: {} };

    try {
      const content = await fs.readFile(indexPath, "utf-8");
      const parsed = JSON.parse(content);
      index = {
        version: parsed.version || 1,
        entries: parsed.entries || [],
        tagsIndex: parsed.tagsIndex || {},
      };
    } catch {
      // 索引不存在或格式错误，使用默认值
    }

    if (mode === "add") {
      index.entries.push(kp);
      // 更新标签索引
      for (const tag of kp.tags) {
        if (!index.tagsIndex[tag]) {
          index.tagsIndex[tag] = [];
        }
        if (!index.tagsIndex[tag].includes(kp.id)) {
          index.tagsIndex[tag].push(kp.id);
        }
      }
    } else if (mode === "remove") {
      const removed = index.entries.find(e => e.id === kp.id);
      index.entries = index.entries.filter(e => e.id !== kp.id);
      // 从标签索引中移除
      if (removed) {
        for (const tag of removed.tags) {
          if (index.tagsIndex[tag]) {
            index.tagsIndex[tag] = index.tagsIndex[tag].filter(id => id !== kp.id);
            if (index.tagsIndex[tag].length === 0) {
              delete index.tagsIndex[tag];
            }
          }
        }
      }
    } else if (mode === "update") {
      const idx = index.entries.findIndex(e => e.id === kp.id);
      const oldKp = idx >= 0 ? index.entries[idx] : null;
      if (idx < 0) {
        // 条目不存在，降级为 add
        index.entries.push(kp);
      } else {
        index.entries[idx] = kp;
      }
      // 更新标签索引：先清理旧标签，再添加新标签
      const tagsToRemove = oldKp ? oldKp.tags : [];
      const tagsToAdd = kp.tags;
      for (const tag of tagsToRemove) {
        if (!tagsToAdd.includes(tag)) {
          if (index.tagsIndex[tag]) {
            index.tagsIndex[tag] = index.tagsIndex[tag].filter(id => id !== kp.id);
            if (index.tagsIndex[tag].length === 0) {
              delete index.tagsIndex[tag];
            }
          }
        }
      }
      for (const tag of tagsToAdd) {
        if (!index.tagsIndex[tag]) {
          index.tagsIndex[tag] = [];
        }
        if (!index.tagsIndex[tag].includes(kp.id)) {
          index.tagsIndex[tag].push(kp.id);
        }
      }
    }

    await fs.writeFile(indexPath, JSON.stringify(index, null, 2), "utf-8");
  });
}

// 加载索引
async function loadIndex(vaultDir: string): Promise<KnowledgeIndex> {
  const indexPath = path.join(vaultDir, "index.json");
  try {
    const content = await fs.readFile(indexPath, "utf-8");
    const parsed = JSON.parse(content);
    return {
      version: parsed.version || 1,
      entries: parsed.entries || [],
      tagsIndex: parsed.tagsIndex || {},
    };
  } catch {
    return { version: 1, entries: [], tagsIndex: {} };
  }
}

// 格式化错误响应
function formatErrorResponse(error: unknown): { text: string; details: Record<string, unknown> } {
  if (error instanceof KnowledgeError) {
    return {
      text: `❌ ${error.message} (${error.code})`,
      details: { error: true, code: error.code, ...error.details },
    };
  }
  if (error instanceof Error) {
    return {
      text: `❌ ${error.message}`,
      details: { error: true },
    };
  }
  return {
    text: `❌ 未知错误: ${String(error)}`,
    details: { error: true },
  };
}

// 知识类型联合
const KnowledgeTypeSchema = Type.Union([
  Type.Literal("concept"),
  Type.Literal("decision"),
  Type.Literal("todo"),
  Type.Literal("note"),
  Type.Literal("project"),
]);

// 时间范围联合
const PeriodSchema = Type.Union([
  Type.Literal("today"),
  Type.Literal("week"),
  Type.Literal("month"),
  Type.Literal("all"),
]);

// 插件入口
export default definePluginEntry({
  id: "knowledge-keeper",
  name: "Knowledge Keeper",
  description: "智能知识管理 - 自动提取对话要点、整理知识库、语义搜索",

  register(api) {
    const pluginConfig = api.pluginConfig as PluginConfig | undefined;

    // ==================== 保存知识 ====================
    api.registerTool({
      name: "knowledge_save",
      label: "保存知识",
      description: "保存知识点到知识库。用于记录重要信息、决策、想法等。",
      parameters: Type.Object({
        type: KnowledgeTypeSchema,
        title: Type.String(),
        content: Type.String(),
        tags: Type.Optional(Type.Array(Type.String())),
        links: Type.Optional(Type.Array(Type.String(), { description: "关联的知识点 ID 列表" })),
      }),
      async execute(toolCallId, params) {
        try {
          const vaultDir = getVaultDir(pluginConfig);
          const typeDir = getTypeDir(params.type);
          const targetDir = path.join(vaultDir, typeDir);

          await ensureDir(targetDir);

          // 验证关联的知识点是否存在
          if (params.links && params.links.length > 0) {
            for (const linkId of params.links) {
              const exists = await findKnowledgeFile(vaultDir, linkId);
              if (!exists) {
                throw new KnowledgeError(
                  `关联的知识点不存在: ${linkId}`,
                  "LINK_NOT_FOUND",
                  { linkId }
                );
              }
            }
          }

          const kp: KnowledgePoint = {
            id: generateId(),
            type: params.type,
            title: params.title,
            content: params.content,
            tags: params.tags || [],
            links: params.links || [],
            created: new Date().toISOString(),
            updated: new Date().toISOString(),
            source: "conversation",
          };

          const filename = `${kp.id}.md`;
          const filepath = path.join(targetDir, filename);
          const markdown = formatMarkdown(kp);

          await fs.writeFile(filepath, markdown, "utf-8");

          // 更新索引
          await updateIndex(vaultDir, kp, "add");

          const linksInfo = kp.links.length > 0
            ? `\n关联: ${kp.links.join(", ")}`
            : "";

          return {
            content: [
              {
                type: "text",
                text: `✅ 知识已保存\n\n📝 **${kp.title}**\n类型: ${kp.type}\nID: ${kp.id}\n标签: ${kp.tags.join(", ") || "无"}${linksInfo}\n路径: ${filepath}`,
              },
            ],
            details: { id: kp.id, type: kp.type, tags: kp.tags, links: kp.links },
          };
        } catch (error) {
          const { text, details } = formatErrorResponse(error);
          return {
            content: [{ type: "text", text }],
            details,
          };
        }
      },
    }, { optional: true });

    // ==================== 搜索知识 ====================
    api.registerTool({
      name: "knowledge_search",
      label: "搜索知识",
      description: "搜索知识库中的知识点。支持关键词搜索和标签筛选。",
      parameters: Type.Object({
        query: Type.String(),
        type: Type.Optional(KnowledgeTypeSchema),
        tags: Type.Optional(Type.Array(Type.String())),
        limit: Type.Optional(Type.Number()),
      }),
      async execute(toolCallId, params) {
        try {
          const vaultDir = getVaultDir(pluginConfig);
          const results: KnowledgePoint[] = [];
          const limit = Math.min(params.limit || 10, 50); // 最大 50 条

          // 优先使用索引进行标签筛选，避免全盘扫描
          let candidateIds: Set<string> | null = null;
          if (params.tags && params.tags.length > 0) {
            const index = await loadIndex(vaultDir);
            for (const tag of params.tags) {
              const tagLower = tag.toLowerCase();
              const matchingIds = Object.entries(index.tagsIndex)
                .filter(([t]) => t.toLowerCase().includes(tagLower))
                .flatMap(([, ids]) => ids);
              const idSet = new Set(matchingIds);
              if (candidateIds === null) {
                candidateIds = idSet;
              } else {
                candidateIds = new Set([...candidateIds].filter(id => idSet.has(id)));
              }
            }
            // 无匹配结果，提前返回
            if (!candidateIds || candidateIds.size === 0) {
              return {
                content: [
                  {
                    type: "text",
                    text: `🔍 未找到匹配的知识点\n\n搜索: "${params.query}"${params.type ? `\n类型: ${params.type}` : ""}${params.tags ? `\n标签: ${params.tags.join(", ")}` : ""}`,
                  },
                ],
                details: { count: 0, query: params.query },
              };
            }
          }

          // 搜索所有类型或指定类型
          const types: KnowledgeType[] = params.type
            ? [params.type]
            : ["concept", "decision", "todo", "note", "project"];

          for (const type of types) {
            const typeDir = path.join(vaultDir, getTypeDir(type));
            try {
              const files = await fs.readdir(typeDir);
              for (const file of files) {
                if (!file.endsWith(".md")) continue;

                const id = file.replace(/\.md$/, "");
                // 有候选 ID 集合时，只检查在集合中的文件
                if (candidateIds !== null && !candidateIds.has(id)) continue;

                const filepath = path.join(typeDir, file);
                const content = await fs.readFile(filepath, "utf-8");
                const kp = parseMarkdown(content, filepath);

                if (!kp) continue;

                // 关键词匹配（标题和内容）
                const queryLower = params.query.toLowerCase();
                const matchesQuery =
                  kp.title.toLowerCase().includes(queryLower) ||
                  kp.content.toLowerCase().includes(queryLower);

                // 标签匹配（索引已预筛选，此处做二次确认）
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
            } catch (err) {
              if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
                console.error(`读取目录失败: ${typeDir}`, err);
              }
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
              details: { count: 0, query: params.query },
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
            details: { count: results.length, results },
          };
        } catch (error) {
          const { text, details } = formatErrorResponse(error);
          return {
            content: [{ type: "text", text }],
            details,
          };
        }
      },
    }, { optional: true });

    // ==================== 获取单个知识点 ====================
    api.registerTool({
      name: "knowledge_get",
      label: "获取知识",
      description: "通过 ID 获取单个知识点的完整内容。",
      parameters: Type.Object({
        id: Type.String({ description: "知识点 ID，格式如 kp-20260330-abc" }),
      }),
      async execute(toolCallId, params) {
        try {
          const vaultDir = getVaultDir(pluginConfig);
          const result = await loadKnowledgeById(vaultDir, params.id);

          if (!result) {
            return {
              content: [
                {
                  type: "text",
                  text: `❌ 未找到知识点: ${params.id}`,
                },
              ],
              details: { error: true, notFound: true, id: params.id },
            };
          }

          const { kp, filepath } = result;
          const linksInfo = kp.links && kp.links.length > 0
            ? `\n关联: ${kp.links.join(", ")}`
            : "";

          return {
            content: [
              {
                type: "text",
                text: `📝 **${kp.title}**\n\n类型: ${kp.type}\nID: ${kp.id}\n创建: ${new Date(kp.created).toLocaleString("zh-CN")}\n更新: ${new Date(kp.updated).toLocaleString("zh-CN")}\n标签: ${kp.tags.join(", ") || "无"}${linksInfo}\n\n---\n\n${kp.content}`,
              },
            ],
            details: { kp, filepath },
          };
        } catch (error) {
          const { text, details } = formatErrorResponse(error);
          return {
            content: [{ type: "text", text }],
            details,
          };
        }
      },
    }, { optional: true });

    // ==================== 更新知识点 ====================
    api.registerTool({
      name: "knowledge_update",
      label: "更新知识",
      description: "更新现有知识点的内容、标题或标签。",
      parameters: Type.Object({
        id: Type.String({ description: "知识点 ID" }),
        title: Type.Optional(Type.String({ description: "新标题（可选）" })),
        content: Type.Optional(Type.String({ description: "新内容（可选）" })),
        tags: Type.Optional(Type.Array(Type.String())),
        appendTags: Type.Optional(Type.Array(Type.String())),
        links: Type.Optional(Type.Array(Type.String(), { description: "设置关联（替换现有）" })),
        appendLinks: Type.Optional(Type.Array(Type.String(), { description: "追加关联" })),
      }),
      async execute(toolCallId, params) {
        try {
          const vaultDir = getVaultDir(pluginConfig);
          const result = await loadKnowledgeById(vaultDir, params.id);

          if (!result) {
            return {
              content: [
                {
                  type: "text",
                  text: `❌ 未找到知识点: ${params.id}`,
                },
              ],
              details: { error: true, notFound: true, id: params.id },
            };
          }

          const { kp, filepath } = result;

          // 验证新的关联
          let newLinks: string[] = [];
          if (params.links) {
            newLinks = params.links;
          } else if (params.appendLinks) {
            newLinks = [...(kp.links || []), ...params.appendLinks];
          } else {
            newLinks = kp.links || [];
          }

          for (const linkId of newLinks) {
            if (linkId === kp.id) {
              throw new KnowledgeError(
                "知识点不能关联自己",
                "SELF_LINK",
                { id: kp.id }
              );
            }
            const exists = await findKnowledgeFile(vaultDir, linkId);
            if (!exists) {
              throw new KnowledgeError(
                `关联的知识点不存在: ${linkId}`,
                "LINK_NOT_FOUND",
                { linkId }
              );
            }
          }

          // 更新字段
          if (params.title) kp.title = params.title;
          if (params.content) kp.content = params.content;
          if (params.tags) {
            kp.tags = params.tags;
          } else if (params.appendTags) {
            kp.tags = [...new Set([...kp.tags, ...params.appendTags])];
          }
          kp.links = newLinks;
          kp.updated = new Date().toISOString();

          // 写回文件
          const markdown = formatMarkdown(kp);
          await fs.writeFile(filepath, markdown, "utf-8");

          // 更新索引
          await updateIndex(vaultDir, kp, "update");

          const linksInfo = kp.links.length > 0
            ? `\n关联: ${kp.links.join(", ")}`
            : "";

          return {
            content: [
              {
                type: "text",
                text: `✅ 知识已更新\n\n📝 **${kp.title}**\n类型: ${kp.type}\nID: ${kp.id}\n标签: ${kp.tags.join(", ") || "无"}${linksInfo}`,
              },
            ],
            details: { id: kp.id, updated: kp.updated, tags: kp.tags, links: kp.links },
          };
        } catch (error) {
          const { text, details } = formatErrorResponse(error);
          return {
            content: [{ type: "text", text }],
            details,
          };
        }
      },
    }, { optional: true });

    // ==================== 删除知识点 ====================
    api.registerTool({
      name: "knowledge_delete",
      label: "删除知识",
      description: "删除指定知识点。此操作不可恢复。",
      parameters: Type.Object({
        id: Type.String({ description: "要删除的知识点 ID" }),
      }),
      async execute(toolCallId, params) {
        try {
          const vaultDir = getVaultDir(pluginConfig);
          const result = await loadKnowledgeById(vaultDir, params.id);

          if (!result) {
            return {
              content: [
                {
                  type: "text",
                  text: `❌ 未找到知识点: ${params.id}`,
                },
              ],
              details: { error: true, notFound: true, id: params.id },
            };
          }

          const { kp, filepath } = result;

          // 删除文件
          await fs.unlink(filepath);

          // 更新索引
          await updateIndex(vaultDir, kp, "remove");

          // 清理其他知识点中的孤儿链接
          const index = await loadIndex(vaultDir);
          const linkedBy = index.entries.filter(e => e.links && e.links.includes(kp.id));

          for (const linkedKp of linkedBy) {
            // 从 links 中移除被删除的 ID
            linkedKp.links = linkedKp.links.filter(l => l !== kp.id);
            // 找到并更新文件
            const linkedFilePath = await findKnowledgeFile(vaultDir, linkedKp.id);
            if (linkedFilePath) {
              const markdown = formatMarkdown(linkedKp);
              await fs.writeFile(linkedFilePath, markdown, "utf-8");
              // 更新索引中的 links
              await updateIndex(vaultDir, linkedKp, "update");
            }
          }

          let cleanupInfo = "";
          if (linkedBy.length > 0) {
            cleanupInfo = `\n\n✅ 已清理 ${linkedBy.length} 条孤儿链接:\n${linkedBy.map(e => `- ${e.title} (${e.id})`).join("\n")}`;
          }

          return {
            content: [
              {
                type: "text",
                text: `🗑️ 已删除知识点\n\n📝 **${kp.title}**\n类型: ${kp.type}\nID: ${kp.id}${cleanupInfo}`,
              },
            ],
            details: { deleted: true, id: kp.id, linkedBy: linkedBy.map(e => e.id) },
          };
        } catch (error) {
          const { text, details } = formatErrorResponse(error);
          return {
            content: [{ type: "text", text }],
            details,
          };
        }
      },
    }, { optional: true });

    // ==================== 回顾知识 ====================
    api.registerTool({
      name: "knowledge_review",
      label: "回顾知识",
      description: "回顾知识库，显示最近的知识点或统计数据。",
      parameters: Type.Object({
        period: Type.Optional(PeriodSchema),
        type: Type.Optional(KnowledgeTypeSchema),
      }),
      async execute(toolCallId, params) {
        try {
          const vaultDir = getVaultDir(pluginConfig);
          const period = params.period || "week";
          const results: KnowledgePoint[] = [];

          // 计算时间范围（注意：不修改原 now 对象）
          const now = new Date();
          let startDate: Date;
          switch (period) {
            case "today":
              startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
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

          // 收集所有知识点
          const types: KnowledgeType[] = params.type
            ? [params.type]
            : ["concept", "decision", "todo", "note", "project"];

          for (const type of types) {
            const typeDir = path.join(vaultDir, getTypeDir(type));
            try {
              const files = await fs.readdir(typeDir);
              for (const file of files) {
                if (!file.endsWith(".md")) continue;

                const filepath = path.join(typeDir, file);
                const content = await fs.readFile(filepath, "utf-8");
                const kp = parseMarkdown(content, filepath);

                if (!kp) continue;

                const kpDate = new Date(kp.created);
                if (kpDate >= startDate) {
                  results.push(kp);
                }
              }
            } catch (err) {
              if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
                console.error(`读取目录失败: ${typeDir}`, err);
              }
            }
          }

          // 按时间排序
          results.sort(
            (a, b) => new Date(b.created).getTime() - new Date(a.created).getTime()
          );

          // 统计
          const stats: Record<KnowledgeType, number> = {
            concept: 0,
            decision: 0,
            todo: 0,
            note: 0,
            project: 0,
          };
          for (const kp of results) {
            stats[kp.type]++;
          }

          const periodLabels: Record<string, string> = {
            today: "今天",
            week: "最近一周",
            month: "最近一个月",
            all: "全部",
          };

          if (results.length === 0) {
            return {
              content: [
                {
                  type: "text",
                  text: `📊 知识库回顾 (${periodLabels[period]})\n\n暂无知识点\n\n统计:\n- 概念: ${stats.concept}\n- 决策: ${stats.decision}\n- 待办: ${stats.todo}\n- 笔记: ${stats.note}\n- 项目: ${stats.project}`,
                },
              ],
              details: { stats, period },
            };
          }

          const recentText = results
            .slice(0, 10)
            .map(
              (kp, i) =>
                `${i + 1}. **${kp.title}** (${kp.type})\n   ID: ${kp.id}\n   ${new Date(kp.created).toLocaleDateString("zh-CN")}`
            )
            .join("\n\n");

          return {
            content: [
              {
                type: "text",
                text: `📊 知识库回顾 (${periodLabels[period]})\n\n共 ${results.length} 条知识点\n\n统计:\n- 概念: ${stats.concept}\n- 决策: ${stats.decision}\n- 待办: ${stats.todo}\n- 笔记: ${stats.note}\n- 项目: ${stats.project}\n\n最近的知识点:\n\n${recentText}`,
              },
            ],
            details: { count: results.length, stats, period },
          };
        } catch (error) {
          const { text, details } = formatErrorResponse(error);
          return {
            content: [{ type: "text", text }],
            details,
          };
        }
      },
    }, { optional: true });

    // ==================== 导出知识库 ====================
    api.registerTool({
      name: "knowledge_export",
      label: "导出知识",
      description: "导出知识库为 JSON 格式，便于备份或迁移。",
      parameters: Type.Object({
        type: Type.Optional(KnowledgeTypeSchema),
      }),
      async execute(toolCallId, params) {
        try {
          const vaultDir = getVaultDir(pluginConfig);
          const allPoints: KnowledgePoint[] = [];

          const types: KnowledgeType[] = params.type
            ? [params.type]
            : ["concept", "decision", "todo", "note", "project"];

          for (const type of types) {
            const typeDir = path.join(vaultDir, getTypeDir(type));
            try {
              const files = await fs.readdir(typeDir);
              for (const file of files) {
                if (!file.endsWith(".md")) continue;
                const filepath = path.join(typeDir, file);
                const content = await fs.readFile(filepath, "utf-8");
                const kp = parseMarkdown(content, filepath);
                if (kp) allPoints.push(kp);
              }
            } catch (err) {
              if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
                console.error(`读取目录失败: ${typeDir}`, err);
              }
            }
          }

          if (allPoints.length === 0) {
            return {
              content: [
                { type: "text", text: "📭 知识库为空，无内容导出" },
              ],
              details: { count: 0 },
            };
          }

          // 导出文件
          const exportPath = path.join(vaultDir, `export-${new Date().toISOString().slice(0, 10)}.json`);
          await fs.writeFile(exportPath, JSON.stringify(allPoints, null, 2), "utf-8");

          return {
            content: [
              {
                type: "text",
                text: `✅ 导出完成\n\n共 ${allPoints.length} 条知识点\n导出路径: ${exportPath}`,
              },
            ],
            details: { count: allPoints.length, exportPath },
          };
        } catch (error) {
          const { text, details } = formatErrorResponse(error);
          return {
            content: [{ type: "text", text }],
            details,
          };
        }
      },
    }, { optional: true });

    // ==================== 关联知识点 ====================
    api.registerTool({
      name: "knowledge_link",
      label: "关联知识",
      description: "建立知识点之间的关联关系。可以双向关联或单向关联。",
      parameters: Type.Object({
        id: Type.String({ description: "源知识点 ID" }),
        targetId: Type.String({ description: "目标知识点 ID" }),
        bidirectional: Type.Optional(Type.Boolean({ description: "是否双向关联（默认 true）" })),
      }),
      async execute(toolCallId, params) {
        try {
          const vaultDir = getVaultDir(pluginConfig);
          const bidirectional = params.bidirectional !== false;

          // 加载源知识点
          const sourceResult = await loadKnowledgeById(vaultDir, params.id);
          if (!sourceResult) {
            return {
              content: [
                { type: "text", text: `❌ 未找到源知识点: ${params.id}` },
              ],
              details: { error: true, notFound: true, id: params.id },
            };
          }

          // 加载目标知识点
          const targetResult = await loadKnowledgeById(vaultDir, params.targetId);
          if (!targetResult) {
            return {
              content: [
                { type: "text", text: `❌ 未找到目标知识点: ${params.targetId}` },
              ],
              details: { error: true, notFound: true, id: params.targetId },
            };
          }

          const { kp: sourceKp, filepath: sourcePath } = sourceResult;
          const { kp: targetKp, filepath: targetPath } = targetResult;

          // 检查是否已关联
          if (sourceKp.links && sourceKp.links.includes(params.targetId)) {
            return {
              content: [
                {
                  type: "text",
                  text: `ℹ️ 知识点已关联\n\n"${sourceKp.title}" 已关联到 "${targetKp.title}"`,
                },
              ],
              details: { alreadyLinked: true, sourceId: params.id, targetId: params.targetId },
            };
          }

          // 添加关联
          if (!sourceKp.links) sourceKp.links = [];
          sourceKp.links.push(params.targetId);
          sourceKp.updated = new Date().toISOString();

          // 写回源文件
          await fs.writeFile(sourcePath, formatMarkdown(sourceKp), "utf-8");
          await updateIndex(vaultDir, sourceKp, "update");

          // 双向关联
          if (bidirectional) {
            if (!targetKp.links) targetKp.links = [];
            if (!targetKp.links.includes(params.id)) {
              targetKp.links.push(params.id);
              targetKp.updated = new Date().toISOString();
              await fs.writeFile(targetPath, formatMarkdown(targetKp), "utf-8");
              await updateIndex(vaultDir, targetKp, "update");
            }
          }

          const linkType = bidirectional ? "双向" : "单向";

          return {
            content: [
              {
                type: "text",
                text: `✅ 已建立${linkType}关联\n\n"${sourceKp.title}"\n↔️\n"${targetKp.title}"`,
              },
            ],
            details: {
              sourceId: params.id,
              targetId: params.targetId,
              bidirectional,
            },
          };
        } catch (error) {
          const { text, details } = formatErrorResponse(error);
          return {
            content: [{ type: "text", text }],
            details,
          };
        }
      },
    }, { optional: true });

    // ==================== 取消关联 ====================
    api.registerTool({
      name: "knowledge_unlink",
      label: "取消关联",
      description: "移除知识点之间的关联关系。",
      parameters: Type.Object({
        id: Type.String({ description: "源知识点 ID" }),
        targetId: Type.String({ description: "目标知识点 ID" }),
        bidirectional: Type.Optional(Type.Boolean({ description: "是否同时移除双向关联（默认 true）" })),
      }),
      async execute(toolCallId, params) {
        try {
          const vaultDir = getVaultDir(pluginConfig);
          const bidirectional = params.bidirectional !== false;

          // 加载源知识点
          const sourceResult = await loadKnowledgeById(vaultDir, params.id);
          if (!sourceResult) {
            return {
              content: [
                { type: "text", text: `❌ 未找到源知识点: ${params.id}` },
              ],
              details: { error: true, notFound: true, id: params.id },
            };
          }

          const { kp: sourceKp, filepath: sourcePath } = sourceResult;

          // 移除关联
          const hadLink = sourceKp.links && sourceKp.links.includes(params.targetId);
          if (sourceKp.links) {
            sourceKp.links = sourceKp.links.filter(id => id !== params.targetId);
          }
          sourceKp.updated = new Date().toISOString();

          await fs.writeFile(sourcePath, formatMarkdown(sourceKp), "utf-8");
          await updateIndex(vaultDir, sourceKp, "update");

          // 双向移除
          if (bidirectional) {
            const targetResult = await loadKnowledgeById(vaultDir, params.targetId);
            if (targetResult) {
              const { kp: targetKp, filepath: targetPath } = targetResult;
              if (targetKp.links) {
                targetKp.links = targetKp.links.filter(id => id !== params.id);
                targetKp.updated = new Date().toISOString();
                await fs.writeFile(targetPath, formatMarkdown(targetKp), "utf-8");
                await updateIndex(vaultDir, targetKp, "update");
              }
            }
          }

          if (!hadLink) {
            return {
              content: [
                { type: "text", text: `ℹ️ 知识点之间没有关联关系` },
              ],
              details: { noLink: true },
            };
          }

          return {
            content: [
              {
                type: "text",
                text: `✅ 已移除关联\n\n"${sourceKp.title}" 不再关联 ${params.targetId}`,
              },
            ],
            details: { sourceId: params.id, targetId: params.targetId },
          };
        } catch (error) {
          const { text, details } = formatErrorResponse(error);
          return {
            content: [{ type: "text", text }],
            details,
          };
        }
      },
    }, { optional: true });

    // ==================== 获取关联的知识点 ====================
    api.registerTool({
      name: "knowledge_linked",
      label: "获取关联",
      description: "获取指定知识点关联的所有知识点。",
      parameters: Type.Object({
        id: Type.String({ description: "知识点 ID" }),
      }),
      async execute(toolCallId, params) {
        try {
          const vaultDir = getVaultDir(pluginConfig);
          const result = await loadKnowledgeById(vaultDir, params.id);

          if (!result) {
            return {
              content: [
                { type: "text", text: `❌ 未找到知识点: ${params.id}` },
              ],
              details: { error: true, notFound: true, id: params.id },
            };
          }

          const { kp } = result;
          const links = kp.links || [];

          if (links.length === 0) {
            return {
              content: [
                {
                  type: "text",
                  text: `📝 "${kp.title}" 没有关联的知识点`,
                },
              ],
              details: { id: params.id, links: [] },
            };
          }

          // 加载所有关联的知识点
          const linkedKps: (KnowledgePoint & { filepath: string })[] = [];
          for (const linkId of links) {
            const linkedResult = await loadKnowledgeById(vaultDir, linkId);
            if (linkedResult) {
              linkedKps.push({ ...linkedResult.kp, filepath: linkedResult.filepath });
            }
          }

          const linksText = linkedKps
            .map((lkp, i) => `${i + 1}. **${lkp.title}** (${lkp.type})\n   ID: ${lkp.id}`)
            .join("\n\n");

          return {
            content: [
              {
                type: "text",
                text: `🔗 "${kp.title}" 关联的知识点 (${linkedKps.length}):\n\n${linksText}`,
              },
            ],
            details: {
              id: params.id,
              title: kp.title,
              links: linkedKps.map(k => ({ id: k.id, title: k.title, type: k.type })),
            },
          };
        } catch (error) {
          const { text, details } = formatErrorResponse(error);
          return {
            content: [{ type: "text", text }],
            details,
          };
        }
      },
    }, { optional: true });

    // ==================== 标签管理 - 列出所有标签 ====================
    api.registerTool({
      name: "knowledge_tags",
      label: "列出标签",
      description: "列出知识库中使用的所有标签及其使用次数。",
      parameters: Type.Object({}),
      async execute(toolCallId, params) {
        try {
          const vaultDir = getVaultDir(pluginConfig);
          const index = await loadIndex(vaultDir);

          // 从索引获取标签统计
          const tagsWithCount: Record<string, number> = {};
          for (const [tag, ids] of Object.entries(index.tagsIndex || {})) {
            tagsWithCount[tag] = ids.length;
          }

          // 如果索引为空，从文件系统重新构建
          if (Object.keys(tagsWithCount).length === 0) {
            const types: KnowledgeType[] = ["concept", "decision", "todo", "note", "project"];
            for (const type of types) {
              const typeDir = path.join(vaultDir, getTypeDir(type));
              try {
                const files = await fs.readdir(typeDir);
                for (const file of files) {
                  if (!file.endsWith(".md")) continue;
                  const filepath = path.join(typeDir, file);
                  const content = await fs.readFile(filepath, "utf-8");
                  const kp = parseMarkdown(content, filepath);
                  if (kp && kp.tags) {
                    for (const tag of kp.tags) {
                      tagsWithCount[tag] = (tagsWithCount[tag] || 0) + 1;
                    }
                  }
                }
              } catch (err) {
                if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
                  console.error(`读取目录失败: ${typeDir}`, err);
                }
              }
            }
          }

          const tags = Object.entries(tagsWithCount).sort((a, b) => b[1] - a[1]);

          if (tags.length === 0) {
            return {
              content: [
                { type: "text", text: "📭 暂无标签" },
              ],
              details: { count: 0, tags: [] },
            };
          }

          const tagsText = tags
            .map(([tag, count]) => `- **${tag}** (${count} 条)`)
            .join("\n");

          return {
            content: [
              {
                type: "text",
                text: `🏷️ 知识库标签 (${tags.length} 个)\n\n${tagsText}`,
              },
            ],
            details: { count: tags.length, tags: Object.fromEntries(tags) },
          };
        } catch (error) {
          const { text, details } = formatErrorResponse(error);
          return {
            content: [{ type: "text", text }],
            details,
          };
        }
      },
    }, { optional: true });

    // ==================== 按标签筛选 ====================
    api.registerTool({
      name: "knowledge_by_tag",
      label: "按标签筛选",
      description: "获取指定标签下的所有知识点。",
      parameters: Type.Object({
        tag: Type.String({ description: "标签名称" }),
        limit: Type.Optional(Type.Number({ description: "返回数量限制（默认 20）" })),
      }),
      async execute(toolCallId, params) {
        try {
          const vaultDir = getVaultDir(pluginConfig);
          const index = await loadIndex(vaultDir);
          const limit = Math.min(params.limit || 20, 100);

          // 从索引获取标签对应的知识点 ID
          let ids = index.tagsIndex?.[params.tag] || [];

          // 如果索引没有，从文件系统查找
          if (ids.length === 0) {
            const types: KnowledgeType[] = ["concept", "decision", "todo", "note", "project"];
            for (const type of types) {
              const typeDir = path.join(vaultDir, getTypeDir(type));
              try {
                const files = await fs.readdir(typeDir);
                for (const file of files) {
                  if (!file.endsWith(".md")) continue;
                  const filepath = path.join(typeDir, file);
                  const content = await fs.readFile(filepath, "utf-8");
                  const kp = parseMarkdown(content, filepath);
                  if (kp && kp.tags && kp.tags.some(t => t.toLowerCase() === params.tag.toLowerCase())) {
                    ids.push(kp.id);
                  }
                }
              } catch (err) {
                if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
                  console.error(`读取目录失败: ${typeDir}`, err);
                }
              }
            }
          }

          if (ids.length === 0) {
            return {
              content: [
                {
                  type: "text",
                  text: `🏷️ 标签 "${params.tag}" 下暂无知识点`,
                },
              ],
              details: { count: 0, tag: params.tag },
            };
          }

          // 加载知识点
          const results: KnowledgePoint[] = [];
          for (const id of ids.slice(0, limit)) {
            const result = await loadKnowledgeById(vaultDir, id);
            if (result) {
              results.push(result.kp);
            }
          }

          const resultText = results
            .map(
              (kp, i) =>
                `${i + 1}. **${kp.title}** (${kp.type})\n   ID: ${kp.id}\n   ${kp.content.slice(0, 80)}${kp.content.length > 80 ? "..." : ""}`
            )
            .join("\n\n");

          return {
            content: [
              {
                type: "text",
                text: `🏷️ 标签 "${params.tag}" 下的知识点 (${results.length}/${ids.length})\n\n${resultText}`,
              },
            ],
            details: { count: results.length, total: ids.length, tag: params.tag, results },
          };
        } catch (error) {
          const { text, details } = formatErrorResponse(error);
          return {
            content: [{ type: "text", text }],
            details,
          };
        }
      },
    }, { optional: true });

    // ==================== 重命名标签 ====================
    api.registerTool({
      name: "knowledge_rename_tag",
      label: "重命名标签",
      description: "批量重命名标签，将所有知识点中的旧标签替换为新标签。",
      parameters: Type.Object({
        oldTag: Type.String({ description: "旧标签名称" }),
        newTag: Type.String({ description: "新标签名称" }),
      }),
      async execute(toolCallId, params) {
        try {
          const vaultDir = getVaultDir(pluginConfig);
          const index = await loadIndex(vaultDir);

          // 找到使用该标签的知识点
          const ids = index.tagsIndex?.[params.oldTag] || [];

          if (ids.length === 0) {
            return {
              content: [
                { type: "text", text: `🏷️ 标签 "${params.oldTag}" 不存在` },
              ],
              details: { count: 0, oldTag: params.oldTag },
            };
          }

          let updatedCount = 0;
          for (const id of ids) {
            const result = await loadKnowledgeById(vaultDir, id);
            if (result) {
              const { kp, filepath } = result;
              // 替换标签
              kp.tags = kp.tags.map(t => t === params.oldTag ? params.newTag : t);
              kp.updated = new Date().toISOString();
              await fs.writeFile(filepath, formatMarkdown(kp), "utf-8");
              updatedCount++;
            }
          }

          // 重建索引
          const types: KnowledgeType[] = ["concept", "decision", "todo", "note", "project"];
          const newIndex: KnowledgeIndex = { version: 1, entries: [], tagsIndex: {} };

          for (const type of types) {
            const typeDir = path.join(vaultDir, getTypeDir(type));
            try {
              const files = await fs.readdir(typeDir);
              for (const file of files) {
                if (!file.endsWith(".md")) continue;
                const filepath = path.join(typeDir, file);
                const content = await fs.readFile(filepath, "utf-8");
                const kp = parseMarkdown(content, filepath);
                if (kp) {
                  newIndex.entries.push(kp);
                  for (const tag of kp.tags) {
                    if (!newIndex.tagsIndex[tag]) {
                      newIndex.tagsIndex[tag] = [];
                    }
                    newIndex.tagsIndex[tag].push(kp.id);
                  }
                }
              }
            } catch (err) {
              if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
                console.error(`读取目录失败: ${typeDir}`, err);
              }
            }
          }

          const indexPath = path.join(vaultDir, "index.json");
          await fs.writeFile(indexPath, JSON.stringify(newIndex, null, 2), "utf-8");

          return {
            content: [
              {
                type: "text",
                text: `✅ 标签已重命名\n\n"${params.oldTag}" → "${params.newTag}"\n更新了 ${updatedCount} 条知识点`,
              },
            ],
            details: { oldTag: params.oldTag, newTag: params.newTag, updatedCount },
          };
        } catch (error) {
          const { text, details } = formatErrorResponse(error);
          return {
            content: [{ type: "text", text }],
            details,
          };
        }
      },
    }, { optional: true });
  },
});