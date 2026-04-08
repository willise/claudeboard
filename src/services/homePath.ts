export function inferHomeDirectoryFromWorkspacePath(workspacePath: string): string | undefined {
    const normalized = normalizePath(workspacePath);
    if (!normalized.startsWith('/')) {
        return undefined;
    }

    const rootHomeMatch = normalized.match(/^\/root(?:\/|$)/);
    if (rootHomeMatch) {
        return '/root';
    }

    const userHomeMatch = normalized.match(/^\/(home|Users|var\/home)\/([^/]+)(?:\/|$)/);
    if (!userHomeMatch) {
        return undefined;
    }

    return `/${userHomeMatch[1]}/${userHomeMatch[2]}`;
}

function normalizePath(value: string): string {
    return value.replace(/\\/g, '/').trim();
}
