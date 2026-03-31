#!/usr/bin/env node
/**
 * Knowledge Keeper CLI
 * 独立命令行工具，用于测试知识管理功能
 */

import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { createInterface } from "readline";

// 配置
const VAULT_DIR = path.join(os.homedir(), ".knowledge-vault");
const TYPE_DIRS = {
  concept: "concepts",
  decision: "decisions",
  todo: "todos",
  note: "notes",
  project: "projects",
};

// 工具函数
function generateId() {
  const date = new Date();
  const dateStr = date.toISOString().slice(0, 10).replace(/-/g, "");
  const rand = Math.random().toString(36).slice(2, 5);
  return `kp-${dateStr}-${rand}`;
}

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

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

function parseMarkdown(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return null;

  const [, frontmatter, body] = match;
  const lines = frontmatter.split("\n");
  const meta = {};

  for (const line of lines) {
    const [key, ...valueParts] = line.split(":");
    if (key && valueParts.length > 0) {
      meta[key.trim()] = valueParts.join(":").trim();
    }
  }

  const titleMatch = body.match(/^#\s+(.+)$/m);
  const title = titleMatch ? titleMatch[1] : "Untitled";
  const contentWithoutTitle = body.replace(/^#\s+.+\n/, "").trim();

  const tagsMatch = meta.tags?.match(/\[([^\]]*)\]/);
  const tags = tagsMatch ? tagsMatch[1].split(",").map(t => t.trim()).filter(Boolean) : [];

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

// 命令处理
async function saveKnowledge(type, title, content, tags = []) {
  await ensureDir(VAULT_DIR);
  const typeDir = path.join(VAULT_DIR, TYPE_DIRS[type]);
  await ensureDir(typeDir);

  const kp = {
    id: generateId(),
    type,
    title,
    content,
    tags,
    created: new Date().toISOString(),
    updated: new Date().toISOString(),
    source: "manual",
  };

  const filepath = path.join(typeDir, `${kp.id}.md`);
  await fs.writeFile(filepath, formatMarkdown(kp), "utf-8");

  console.log(`\n✅ 已保存: ${kp.title}`);
  console.log(`   类型: ${kp.type}`);
  console.log(`   ID: ${kp.id}`);
  console.log(`   路径: ${filepath}\n`);

  return kp;
}

async function searchKnowledge(query, type = null) {
  const results = [];
  const types = type ? [type] : Object.keys(TYPE_DIRS);

  for (const t of types) {
    const typeDir = path.join(VAULT_DIR, TYPE_DIRS[t]);
    try {
      const files = await fs.readdir(typeDir);
      for (const file of files) {
        if (!file.endsWith(".md")) continue;
        const content = await fs.readFile(path.join(typeDir, file), "utf-8");
        const kp = parseMarkdown(content);
        if (kp && (kp.title.toLowerCase().includes(query.toLowerCase()) ||
                   kp.content.toLowerCase().includes(query.toLowerCase()))) {
          results.push(kp);
        }
      }
    } catch {}
  }

  if (results.length === 0) {
    console.log(`\n🔍 未找到匹配: "${query}"\n`);
  } else {
    console.log(`\n🔍 找到 ${results.length} 条结果:\n`);
    results.forEach((kp, i) => {
      console.log(`${i + 1}. ${kp.title} (${kp.type})`);
      console.log(`   ${kp.content.slice(0, 80)}...`);
      console.log(`   标签: ${kp.tags.join(", ") || "无"}\n`);
    });
  }

  return results;
}

async function reviewKnowledge(period = "week") {
  const now = new Date();
  let startDate;
  switch (period) {
    case "today": startDate = new Date(now.setHours(0, 0, 0, 0)); break;
    case "week": startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000); break;
    case "month": startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000); break;
    default: startDate = new Date(0);
  }

  const results = [];
  const stats = { concept: 0, decision: 0, todo: 0, note: 0, project: 0 };

  for (const type of Object.keys(TYPE_DIRS)) {
    const typeDir = path.join(VAULT_DIR, TYPE_DIRS[type]);
    try {
      const files = await fs.readdir(typeDir);
      for (const file of files) {
        if (!file.endsWith(".md")) continue;
        const content = await fs.readFile(path.join(typeDir, file), "utf-8");
        const kp = parseMarkdown(content);
        if (kp && new Date(kp.created) >= startDate) {
          results.push(kp);
          stats[kp.type]++;
        }
      }
    } catch {}
  }

  results.sort((a, b) => new Date(b.created) - new Date(a.created));

  console.log(`\n📊 知识库回顾 (${period})\n`);
  console.log(`共 ${results.length} 条知识点\n`);
  console.log("统计:");
  console.log(`  概念: ${stats.concept}`);
  console.log(`  决策: ${stats.decision}`);
  console.log(`  待办: ${stats.todo}`);
  console.log(`  笔记: ${stats.note}`);
  console.log(`  项目: ${stats.project}\n`);

  if (results.length > 0) {
    console.log("最近的知识点:\n");
    results.slice(0, 5).forEach((kp, i) => {
      console.log(`${i + 1}. ${kp.title} (${kp.type})`);
      console.log(`   ${new Date(kp.created).toLocaleDateString("zh-CN")}\n`);
    });
  }

  return results;
}

async function listAll() {
  const all = [];
  for (const type of Object.keys(TYPE_DIRS)) {
    const typeDir = path.join(VAULT_DIR, TYPE_DIRS[type]);
    try {
      const files = await fs.readdir(typeDir);
      for (const file of files) {
        if (!file.endsWith(".md")) continue;
        const content = await fs.readFile(path.join(typeDir, file), "utf-8");
        const kp = parseMarkdown(content);
        if (kp) all.push(kp);
      }
    } catch {}
  }
  return all;
}

// REPL 交互模式
async function interactive() {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const question = (prompt) => new Promise(resolve => rl.question(prompt, resolve));

  console.log("\n🧠 Knowledge Keeper CLI");
  console.log("命令: save | search | review | list | exit\n");

  while (true) {
    const cmd = await question("> ");
    const parts = cmd.trim().split(" ");
    const action = parts[0].toLowerCase();

    try {
      switch (action) {
        case "save":
        case "s":
          const type = await question("类型 (concept/decision/todo/note/project): ");
          const title = await question("标题: ");
          const content = await question("内容: ");
          const tagsInput = await question("标签 (逗号分隔): ");
          const tags = tagsInput ? tagsInput.split(",").map(t => t.trim()).filter(Boolean) : [];
          await saveKnowledge(type, title, content, tags);
          break;

        case "search":
        case "find":
          const query = parts.slice(1).join(" ") || await question("搜索关键词: ");
          await searchKnowledge(query);
          break;

        case "review":
        case "r":
          const period = parts[1] || "week";
          await reviewKnowledge(period);
          break;

        case "list":
        case "ls":
          const all = await listAll();
          console.log(`\n📚 共 ${all.length} 条知识点\n`);
          all.forEach((kp, i) => {
            console.log(`${i + 1}. ${kp.title} (${kp.type})`);
          });
          console.log();
          break;

        case "exit":
        case "quit":
        case "q":
          console.log("\n👋 再见!\n");
          rl.close();
          return;

        case "help":
        case "h":
          console.log("\n命令:");
          console.log("  save    - 保存新知识点");
          console.log("  search  - 搜索知识");
          console.log("  review  - 回顾知识库");
          console.log("  list    - 列出所有知识点");
          console.log("  exit    - 退出\n");
          break;

        default:
          if (cmd.trim()) {
            console.log("未知命令，输入 'help' 查看帮助\n");
          }
      }
    } catch (error) {
      console.log(`❌ 错误: ${error.message}\n`);
    }
  }
}

// 主入口
const args = process.argv.slice(2);

if (args.length === 0) {
  interactive();
} else {
  const cmd = args[0];

  switch (cmd) {
    case "save":
      saveKnowledge(args[1], args[2], args[3], args[4]?.split(","));
      break;
    case "search":
      searchKnowledge(args.slice(1).join(" "));
      break;
    case "review":
      reviewKnowledge(args[1] || "week");
      break;
    case "list":
      listAll().then(all => {
        console.log(`\n📚 共 ${all.length} 条知识点\n`);
        all.forEach((kp, i) => console.log(`${i + 1}. ${kp.title} (${kp.type})`));
        console.log();
      });
      break;
    default:
      console.log("\n用法:");
      console.log("  kk                    进入交互模式");
      console.log("  kk save <type> <title> <content> [tags]");
      console.log("  kk search <query>");
      console.log("  kk review [period]");
      console.log("  kk list\n");
  }
}