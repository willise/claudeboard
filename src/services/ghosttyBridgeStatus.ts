export type GhosttyBridgeState = 'starting' | 'running' | 'failed';

export interface GhosttyBridgeStatusSnapshot {
    state: GhosttyBridgeState;
    ideScheme: string;
    workspaceFolder?: string;
    registryDir: string;
    registryPath?: string;
    port?: number;
    error?: string;
}

export function formatGhosttyBridgeStatus(
    status: GhosttyBridgeStatusSnapshot
): string {
    const lines = [
        `Claudeboard Ghostty bridge is ${status.state}.`,
        `IDE scheme: ${status.ideScheme}`,
        `Registry dir: ${status.registryDir}`
    ];

    if (status.workspaceFolder) {
        lines.push(`Workspace: ${status.workspaceFolder}`);
    }

    if (status.port) {
        lines.push(`Port: ${status.port}`);
    }

    if (status.registryPath) {
        lines.push(`Registry file: ${status.registryPath}`);
    }

    if (status.error) {
        lines.push(`Last error: ${status.error}`);
    }

    return lines.join('\n');
}
