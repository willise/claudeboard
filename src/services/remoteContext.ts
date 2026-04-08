export interface RemoteContextSnapshot {
    remoteName?: string | null;
    workspaceFolderSchemes?: ReadonlyArray<string>;
}

export function hasRemoteContext(snapshot: RemoteContextSnapshot): boolean {
    const normalizedRemoteName = normalize(snapshot.remoteName);
    if (normalizedRemoteName.length > 0) {
        return true;
    }

    const schemes = snapshot.workspaceFolderSchemes ?? [];
    return schemes.some((scheme) => isRemoteWorkspaceScheme(scheme));
}

export function isRemoteWorkspaceScheme(scheme: string): boolean {
    const normalized = normalize(scheme);
    return normalized === 'vscode-remote'
        || normalized.endsWith('-remote');
}

function normalize(value: string | null | undefined): string {
    return (value ?? '').trim().toLowerCase();
}
