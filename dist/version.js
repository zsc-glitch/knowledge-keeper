/**
 * 版本历史模块
 * 记录知识点的版本变更，支持版本回滚
 */
import * as fs from "fs/promises";
import * as path from "path";
import * as crypto from "crypto";
// 默认配置
const DEFAULT_CONFIG = {
    enabled: true,
    maxVersions: 50,
    retentionDays: 30,
};
// 生成版本 ID
function generateVersionId() {
    const timestamp = Date.now().toString(36);
    const rand = crypto.randomBytes(4).toString("hex");
    return `ver-${timestamp}-${rand}`;
}
// 计算内容校验和
function computeChecksum(content) {
    return crypto.createHash("md5").update(content).digest("hex");
}
// 获取版本历史目录
export function getVersionDir(vaultDir, knowledgeId) {
    return path.join(vaultDir, ".versions", knowledgeId);
}
// 确保版本目录存在
async function ensureVersionDir(vaultDir, knowledgeId) {
    const versionDir = getVersionDir(vaultDir, knowledgeId);
    await fs.mkdir(versionDir, { recursive: true });
    return versionDir;
}
// 保存新版本
export async function saveVersion(vaultDir, knowledgeId, content, metadata, source = "conversation") {
    const versionDir = await ensureVersionDir(vaultDir, knowledgeId);
    // 获取当前最大版本号
    const versions = await listVersions(vaultDir, knowledgeId);
    const maxVersion = versions.length > 0 ? Math.max(...versions.map(v => v.versionNumber)) : 0;
    const version = {
        id: generateVersionId(),
        knowledgeId,
        versionNumber: maxVersion + 1,
        timestamp: new Date().toISOString(),
        content,
        metadata,
        checksum: computeChecksum(content),
        source,
    };
    // 写入版本文件（JSONL 格式）
    const versionFile = path.join(versionDir, "versions.jsonl");
    await fs.appendFile(versionFile, JSON.stringify(version) + "\n", "utf-8");
    // 更新索引
    await updateVersionIndex(vaultDir, knowledgeId, version);
    // 清理旧版本（超过限制）
    await cleanupOldVersions(vaultDir, knowledgeId, DEFAULT_CONFIG.maxVersions);
    return version;
}
// 列出所有版本
export async function listVersions(vaultDir, knowledgeId) {
    const versionDir = getVersionDir(vaultDir, knowledgeId);
    const versions = [];
    try {
        const versionFile = path.join(versionDir, "versions.jsonl");
        const content = await fs.readFile(versionFile, "utf-8");
        const lines = content.trim().split("\n");
        for (const line of lines) {
            try {
                const version = JSON.parse(line);
                versions.push(version);
            }
            catch {
                // 解析失败，跳过
            }
        }
    }
    catch {
        // 文件不存在
    }
    return versions.sort((a, b) => b.versionNumber - a.versionNumber); // 最新在前
}
// 获取指定版本
export async function getVersion(vaultDir, knowledgeId, versionNumber) {
    const versions = await listVersions(vaultDir, knowledgeId);
    return versions.find(v => v.versionNumber === versionNumber) || null;
}
// 获取最新版本
export async function getLatestVersion(vaultDir, knowledgeId) {
    const versions = await listVersions(vaultDir, knowledgeId);
    return versions.length > 0 ? versions[0] : null;
}
// 更新版本索引
async function updateVersionIndex(vaultDir, knowledgeId, version) {
    const indexDir = path.join(vaultDir, ".versions");
    await fs.mkdir(indexDir, { recursive: true });
    const indexPath = path.join(indexDir, "index.json");
    let index = {};
    try {
        const content = await fs.readFile(indexPath, "utf-8");
        index = JSON.parse(content);
    }
    catch {
        // 索引不存在
    }
    index[knowledgeId] = {
        knowledgeId,
        totalVersions: version.versionNumber,
        latestVersion: version.versionNumber,
        latestChecksum: version.checksum,
        updatedAt: version.timestamp,
    };
    await fs.writeFile(indexPath, JSON.stringify(index, null, 2), "utf-8");
}
// 清理旧版本
async function cleanupOldVersions(vaultDir, knowledgeId, maxVersions) {
    const versions = await listVersions(vaultDir, knowledgeId);
    if (versions.length <= maxVersions) {
        return { deleted: 0 };
    }
    // 删除超出限制的旧版本
    const toDelete = versions.slice(maxVersions);
    const versionDir = getVersionDir(vaultDir, knowledgeId);
    const versionFile = path.join(versionDir, "versions.jsonl");
    // 保留的版本
    const toKeep = versions.slice(0, maxVersions);
    // 重写文件（只保留需要的版本）
    await fs.writeFile(versionFile, toKeep.map(v => JSON.stringify(v)).join("\n") + "\n", "utf-8");
    // 更新索引
    const latest = toKeep[0];
    if (latest) {
        await updateVersionIndex(vaultDir, knowledgeId, latest);
    }
    return { deleted: toDelete.length };
}
// 批量清理过期版本
export async function cleanupExpiredVersions(vaultDir, retentionDays = 30) {
    const indexDir = path.join(vaultDir, ".versions");
    const indexPath = path.join(indexDir, "index.json");
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);
    let knowledgeIds = 0;
    let versionsDeleted = 0;
    try {
        const content = await fs.readFile(indexPath, "utf-8");
        const index = JSON.parse(content);
        for (const [knowledgeId, info] of Object.entries(index)) {
            // 检查是否有版本在保留期内
            const versions = await listVersions(vaultDir, knowledgeId);
            const recentVersions = versions.filter(v => new Date(v.timestamp) >= cutoffDate);
            if (recentVersions.length === 0 && versions.length > 0) {
                // 全部版本都过期，删除整个目录
                const versionDir = getVersionDir(vaultDir, knowledgeId);
                await fs.rm(versionDir, { recursive: true, force: true });
                delete index[knowledgeId];
                knowledgeIds++;
                versionsDeleted += versions.length;
            }
            else if (recentVersions.length < versions.length) {
                // 部分版本过期，只清理过期的
                const versionDir = getVersionDir(vaultDir, knowledgeId);
                const versionFile = path.join(versionDir, "versions.jsonl");
                await fs.writeFile(versionFile, recentVersions.map(v => JSON.stringify(v)).join("\n") + "\n", "utf-8");
                versionsDeleted += versions.length - recentVersions.length;
            }
        }
        // 更新索引文件
        await fs.writeFile(indexPath, JSON.stringify(index, null, 2), "utf-8");
    }
    catch {
        // 索引不存在
    }
    return { knowledgeIds, versionsDeleted };
}
// 获取版本统计
export async function getVersionStats(vaultDir) {
    const indexDir = path.join(vaultDir, ".versions");
    const indexPath = path.join(indexDir, "index.json");
    try {
        const content = await fs.readFile(indexPath, "utf-8");
        const index = JSON.parse(content);
        const entries = Object.values(index);
        const totalVersions = entries.reduce((sum, e) => sum + e.totalVersions, 0);
        const maxVersions = entries.length > 0 ? Math.max(...entries.map(e => e.totalVersions)) : 0;
        return {
            totalKnowledgeIds: entries.length,
            totalVersions,
            avgVersions: entries.length > 0 ? totalVersions / entries.length : 0,
            maxVersions,
        };
    }
    catch {
        return {
            totalKnowledgeIds: 0,
            totalVersions: 0,
            avgVersions: 0,
            maxVersions: 0,
        };
    }
}
// 验证版本完整性
export async function verifyVersionIntegrity(vaultDir, knowledgeId) {
    const versions = await listVersions(vaultDir, knowledgeId);
    const errors = [];
    for (const version of versions) {
        const computedChecksum = computeChecksum(version.content);
        if (version.checksum !== computedChecksum) {
            errors.push(`版本 ${version.versionNumber} 校验和不匹配`);
        }
    }
    // 检查版本号连续性
    const versionNumbers = versions.map(v => v.versionNumber).sort((a, b) => a - b);
    for (let i = 1; i < versionNumbers.length; i++) {
        if (versionNumbers[i] !== versionNumbers[i - 1] + 1) {
            errors.push(`版本号不连续: 缺少 ${versionNumbers[i - 1] + 1}`);
        }
    }
    return { valid: errors.length === 0, errors };
}
// 比较两个版本
export async function compareVersions(vaultDir, knowledgeId, version1, version2) {
    const v1 = await getVersion(vaultDir, knowledgeId, version1);
    const v2 = await getVersion(vaultDir, knowledgeId, version2);
    const changes = {
        titleChanged: v1?.metadata.title !== v2?.metadata.title,
        tagsAdded: v2 ? v2.metadata.tags.filter(t => !v1?.metadata.tags.includes(t)) : [],
        tagsRemoved: v1 ? v1.metadata.tags.filter(t => !v2?.metadata.tags.includes(t)) : [],
        linksAdded: v2 ? v2.metadata.links.filter(l => !v1?.metadata.links.includes(l)) : [],
        linksRemoved: v1 ? v1.metadata.links.filter(l => !v2?.metadata.links.includes(l)) : [],
        contentChanged: v1?.content !== v2?.content,
    };
    return { version1: v1, version2: v2, changes };
}
//# sourceMappingURL=version.js.map