/**
 * 版本历史模块
 * 记录知识点的版本变更，支持版本回滚
 */
export interface VersionRecord {
    id: string;
    knowledgeId: string;
    versionNumber: number;
    timestamp: string;
    content: string;
    metadata: {
        title: string;
        tags: string[];
        links: string[];
    };
    checksum: string;
    source: "conversation" | "manual" | "rollback";
}
export interface VersionConfig {
    enabled: boolean;
    maxVersions: number;
    retentionDays: number;
}
export declare function getVersionDir(vaultDir: string, knowledgeId: string): string;
export declare function saveVersion(vaultDir: string, knowledgeId: string, content: string, metadata: {
    title: string;
    tags: string[];
    links: string[];
}, source?: "conversation" | "manual" | "rollback"): Promise<VersionRecord>;
export declare function listVersions(vaultDir: string, knowledgeId: string): Promise<VersionRecord[]>;
export declare function getVersion(vaultDir: string, knowledgeId: string, versionNumber: number): Promise<VersionRecord | null>;
export declare function getLatestVersion(vaultDir: string, knowledgeId: string): Promise<VersionRecord | null>;
export declare function cleanupExpiredVersions(vaultDir: string, retentionDays?: number): Promise<{
    knowledgeIds: number;
    versionsDeleted: number;
}>;
export declare function getVersionStats(vaultDir: string): Promise<{
    totalKnowledgeIds: number;
    totalVersions: number;
    avgVersions: number;
    maxVersions: number;
}>;
export declare function verifyVersionIntegrity(vaultDir: string, knowledgeId: string): Promise<{
    valid: boolean;
    errors: string[];
}>;
export declare function compareVersions(vaultDir: string, knowledgeId: string, version1: number, version2: number): Promise<{
    version1: VersionRecord | null;
    version2: VersionRecord | null;
    changes: {
        titleChanged: boolean;
        tagsAdded: string[];
        tagsRemoved: string[];
        linksAdded: string[];
        linksRemoved: string[];
        contentChanged: boolean;
    };
}>;
//# sourceMappingURL=version.d.ts.map