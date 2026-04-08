/**
 * 审计日志模块
 * 记录所有知识库操作，支持合规审计
 */

import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import * as crypto from "crypto";

// 审计日志条目
export interface AuditLogEntry {
  id: string;           // 日志条目 ID
  timestamp: string;    // ISO 时间戳
  action: AuditAction;  // 操作类型
  knowledgeId?: string; // 操作的知识点 ID
  knowledgeTitle?: string; // 知识点标题（便于查看）
  details: Record<string, unknown>; // 操作详情
  before?: Record<string, unknown>; // 操作前状态（用于 rollback）
  after?: Record<string, unknown>;  // 操作后状态
  source: "conversation" | "manual" | "system";
  integrityHash: string; // 完整性哈希（防篡改）
  prevHash?: string;     // 前一条日志的哈希（链式结构）
}

// 审计操作类型
export type AuditAction =
  | "save"
  | "update"
  | "delete"
  | "link"
  | "unlink"
  | "export"
  | "rename_tag"
  | "system_init";

// 审计日志配置
export interface AuditConfig {
  enabled: boolean;
  retentionDays: number;  // 保留天数
  vaultDir: string;
}

// 默认配置
const DEFAULT_CONFIG: AuditConfig = {
  enabled: true,
  retentionDays: 90,
  vaultDir: "",
};

// 生成审计日志 ID
function generateAuditId(): string {
  const timestamp = Date.now().toString(36);
  const rand = crypto.randomBytes(4).toString("hex");
  return `audit-${timestamp}-${rand}`;
}

// 计算完整性哈希
function computeIntegrityHash(entry: AuditLogEntry, prevHash?: string): string {
  const data = JSON.stringify({
    id: entry.id,
    timestamp: entry.timestamp,
    action: entry.action,
    knowledgeId: entry.knowledgeId,
    details: entry.details,
    prevHash: prevHash || "",
  });
  return crypto.createHash("sha256").update(data).digest("hex");
}

// 获取审计日志目录
export function getAuditDir(vaultDir: string): string {
  return path.join(vaultDir, ".audit");
}

// 确保审计目录存在
async function ensureAuditDir(vaultDir: string): Promise<string> {
  const auditDir = getAuditDir(vaultDir);
  await fs.mkdir(auditDir, { recursive: true });
  return auditDir;
}

// 获取当前日志文件路径（按日期分文件）
function getCurrentLogFile(vaultDir: string): string {
  const date = new Date().toISOString().slice(0, 10);
  const auditDir = getAuditDir(vaultDir);
  return path.join(auditDir, `audit-${date}.jsonl`);
}

// 获取最后一条日志的哈希
async function getLastHash(vaultDir: string): Promise<string | undefined> {
  const auditDir = getAuditDir(vaultDir);
  try {
    const files = await fs.readdir(auditDir);
    const auditFiles = files
      .filter(f => f.startsWith("audit-") && f.endsWith(".jsonl"))
      .sort()
      .reverse();

    if (auditFiles.length === 0) return undefined;

    // 读取最后一个文件的最后一行
    const lastFile = path.join(auditDir, auditFiles[0]);
    const content = await fs.readFile(lastFile, "utf-8");
    const lines = content.trim().split("\n");
    if (lines.length === 0) return undefined;

    const lastEntry = JSON.parse(lines[lines.length - 1]) as AuditLogEntry;
    return lastEntry.integrityHash;
  } catch {
    return undefined;
  }
}

// 记录审计日志（核心函数）
export async function logAudit(
  vaultDir: string,
  action: AuditAction,
  options: {
    knowledgeId?: string;
    knowledgeTitle?: string;
    details?: Record<string, unknown>;
    before?: Record<string, unknown>;
    after?: Record<string, unknown>;
    source?: "conversation" | "manual" | "system";
  }
): Promise<AuditLogEntry> {
  await ensureAuditDir(vaultDir);

  const prevHash = await getLastHash(vaultDir);

  const entry: AuditLogEntry = {
    id: generateAuditId(),
    timestamp: new Date().toISOString(),
    action,
    knowledgeId: options.knowledgeId,
    knowledgeTitle: options.knowledgeTitle,
    details: options.details || {},
    before: options.before,
    after: options.after,
    source: options.source || "system",
    integrityHash: "", // 先留空，后面计算
    prevHash,
  };

  // 计算完整性哈希
  entry.integrityHash = computeIntegrityHash(entry, prevHash);

  // 写入日志文件（JSONL 格式，追加写入）
  const logFile = getCurrentLogFile(vaultDir);
  const line = JSON.stringify(entry) + "\n";

  // 原子写入：使用追加模式
  await fs.appendFile(logFile, line, "utf-8");

  return entry;
}

// 读取审计日志
export async function readAuditLogs(
  vaultDir: string,
  options?: {
    startDate?: string;
    endDate?: string;
    action?: AuditAction;
    knowledgeId?: string;
    limit?: number;
  }
): Promise<AuditLogEntry[]> {
  const auditDir = getAuditDir(vaultDir);
  const results: AuditLogEntry[] = [];
  const limit = options?.limit || 100;

  try {
    const files = await fs.readdir(auditDir);
    const auditFiles = files
      .filter(f => f.startsWith("audit-") && f.endsWith(".jsonl"))
      .sort()
      .reverse(); // 从最新开始

    for (const file of auditFiles) {
      // 检查日期范围
      const fileDate = file.replace("audit-", "").replace(".jsonl", "");
      if (options?.startDate && fileDate < options.startDate) continue;
      if (options?.endDate && fileDate > options.endDate) continue;

      const filepath = path.join(auditDir, file);
      const content = await fs.readFile(filepath, "utf-8");
      const lines = content.trim().split("\n");

      for (const line of lines.reverse()) { // 从最新开始
        try {
          const entry = JSON.parse(line) as AuditLogEntry;

          // 过滤条件
          if (options?.action && entry.action !== options.action) continue;
          if (options?.knowledgeId && entry.knowledgeId !== options.knowledgeId) continue;

          results.push(entry);
          if (results.length >= limit) break;
        } catch {
          // 解析失败，跳过
        }
      }

      if (results.length >= limit) break;
    }
  } catch {
    // 目录不存在或读取失败
  }

  return results;
}

// 验证审计日志完整性
export async function verifyAuditIntegrity(vaultDir: string): Promise<{
  valid: boolean;
  errors: string[];
  totalEntries: number;
}> {
  const auditDir = getAuditDir(vaultDir);
  const errors: string[] = [];
  let totalEntries = 0;
  let prevHash: string | undefined;

  try {
    const files = await fs.readdir(auditDir);
    const auditFiles = files
      .filter(f => f.startsWith("audit-") && f.endsWith(".jsonl"))
      .sort();

    for (const file of auditFiles) {
      const filepath = path.join(auditDir, file);
      const content = await fs.readFile(filepath, "utf-8");
      const lines = content.trim().split("\n");

      for (const line of lines) {
        try {
          const entry = JSON.parse(line) as AuditLogEntry;
          totalEntries++;

          // 验证哈希链
          if (prevHash && entry.prevHash !== prevHash) {
            errors.push(`哈希链断裂: ${entry.id}, expected ${prevHash}, got ${entry.prevHash}`);
          }

          // 验证完整性哈希
          const computedHash = computeIntegrityHash(entry, entry.prevHash);
          if (entry.integrityHash !== computedHash) {
            errors.push(`完整性哈希不匹配: ${entry.id}`);
          }

          prevHash = entry.integrityHash;
        } catch {
          errors.push(`解析失败: ${file}`);
        }
      }
    }
  } catch {
    errors.push("无法读取审计目录");
  }

  return {
    valid: errors.length === 0,
    errors,
    totalEntries,
  };
}

// 清理过期审计日志
export async function cleanupAuditLogs(
  vaultDir: string,
  retentionDays: number = 90
): Promise<{ deletedFiles: number; deletedEntries: number }> {
  const auditDir = getAuditDir(vaultDir);
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - retentionDays);
  const cutoffStr = cutoffDate.toISOString().slice(0, 10);

  let deletedFiles = 0;
  let deletedEntries = 0;

  try {
    const files = await fs.readdir(auditDir);
    const auditFiles = files.filter(f => f.startsWith("audit-") && f.endsWith(".jsonl"));

    for (const file of auditFiles) {
      const fileDate = file.replace("audit-", "").replace(".jsonl", "");
      if (fileDate < cutoffStr) {
        const filepath = path.join(auditDir, file);
        // 计算条目数
        const content = await fs.readFile(filepath, "utf-8");
        const lines = content.trim().split("\n");
        deletedEntries += lines.length;
        // 删除文件
        await fs.unlink(filepath);
        deletedFiles++;
      }
    }
  } catch {
    // 目录不存在
  }

  return { deletedFiles, deletedEntries };
}

// 获取审计统计
export async function getAuditStats(vaultDir: string): Promise<{
  totalEntries: number;
  totalFiles: number;
  actionsBreakdown: Record<AuditAction, number>;
  oldestEntry?: string;
  newestEntry?: string;
}> {
  const auditDir = getAuditDir(vaultDir);
  let totalEntries = 0;
  let totalFiles = 0;
  const actionsBreakdown: Record<AuditAction, number> = {
    save: 0,
    update: 0,
    delete: 0,
    link: 0,
    unlink: 0,
    export: 0,
    rename_tag: 0,
    system_init: 0,
  };
  let oldestEntry: string | undefined;
  let newestEntry: string | undefined;

  try {
    const files = await fs.readdir(auditDir);
    const auditFiles = files.filter(f => f.startsWith("audit-") && f.endsWith(".jsonl")).sort();

    totalFiles = auditFiles.length;

    for (const file of auditFiles) {
      const filepath = path.join(auditDir, file);
      const content = await fs.readFile(filepath, "utf-8");
      const lines = content.trim().split("\n");

      for (const line of lines) {
        try {
          const entry = JSON.parse(line) as AuditLogEntry;
          totalEntries++;
          actionsBreakdown[entry.action]++;

          if (!oldestEntry || entry.timestamp < oldestEntry) {
            oldestEntry = entry.timestamp;
          }
          if (!newestEntry || entry.timestamp > newestEntry) {
            newestEntry = entry.timestamp;
          }
        } catch {
          // 解析失败
        }
      }
    }
  } catch {
    // 目录不存在
  }

  return { totalEntries, totalFiles, actionsBreakdown, oldestEntry, newestEntry };
}