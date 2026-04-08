/**
 * 审计日志模块
 * 记录所有知识库操作，支持合规审计
 */
export interface AuditLogEntry {
    id: string;
    timestamp: string;
    action: AuditAction;
    knowledgeId?: string;
    knowledgeTitle?: string;
    details: Record<string, unknown>;
    before?: Record<string, unknown>;
    after?: Record<string, unknown>;
    source: "conversation" | "manual" | "system";
    integrityHash: string;
    prevHash?: string;
}
export type AuditAction = "save" | "update" | "delete" | "link" | "unlink" | "export" | "rename_tag" | "system_init";
export interface AuditConfig {
    enabled: boolean;
    retentionDays: number;
    vaultDir: string;
}
export declare function getAuditDir(vaultDir: string): string;
export declare function logAudit(vaultDir: string, action: AuditAction, options: {
    knowledgeId?: string;
    knowledgeTitle?: string;
    details?: Record<string, unknown>;
    before?: Record<string, unknown>;
    after?: Record<string, unknown>;
    source?: "conversation" | "manual" | "system";
}): Promise<AuditLogEntry>;
export declare function readAuditLogs(vaultDir: string, options?: {
    startDate?: string;
    endDate?: string;
    action?: AuditAction;
    knowledgeId?: string;
    limit?: number;
}): Promise<AuditLogEntry[]>;
export declare function verifyAuditIntegrity(vaultDir: string): Promise<{
    valid: boolean;
    errors: string[];
    totalEntries: number;
}>;
export declare function cleanupAuditLogs(vaultDir: string, retentionDays?: number): Promise<{
    deletedFiles: number;
    deletedEntries: number;
}>;
export declare function getAuditStats(vaultDir: string): Promise<{
    totalEntries: number;
    totalFiles: number;
    actionsBreakdown: Record<AuditAction, number>;
    oldestEntry?: string;
    newestEntry?: string;
}>;
//# sourceMappingURL=audit.d.ts.map