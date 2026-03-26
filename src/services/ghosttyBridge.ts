import * as fs from 'fs/promises';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import { AddressInfo } from 'net';

import { ExtensionResult, Result, ValidationError, ValidationResult, failure, success } from '../common/result';

export interface GhosttyBridgeUploadRequest {
    action: 'uploadClipboardImage';
    requestId: string;
    imageData?: string;
}

export interface IdeBridgeInfo {
    extensionId: string;
    uriScheme: string;
    priority: number;
    deeplinkBase: string;
}

export interface GhosttyBridgeRegistryRecord {
    instanceId: string;
    extensionId: string;
    uriScheme: string;
    priority: number;
    deeplinkBase: string;
    port: number;
    focused: boolean;
    workspaceFolder?: string;
    updatedAt: number;
}

export interface GhosttyBridgeMetaResponse {
    ok: true;
    service: 'claudeboard';
    requestId?: string;
    bridge: GhosttyBridgeRegistryRecord;
}

export interface GhosttyBridgeUploadSuccessResponse {
    ok: true;
    requestId: string;
    remotePath: string;
    bridge: GhosttyBridgeRegistryRecord;
}

export interface GhosttyBridgeUploadFailureResponse {
    ok: false;
    requestId?: string;
    error: string;
    bridge: GhosttyBridgeRegistryRecord;
}

export interface StartGhosttyBridgeServerOptions {
    host: string;
    ideInfo: IdeBridgeInfo;
    onUpload: (imageData: Buffer) => Promise<ExtensionResult<string>>;
    onError?: (error: Error) => void;
    workspaceFolder?: string;
    focused?: boolean;
    registryDir?: string;
    instanceId?: string;
}

export interface GhosttyBridgeServer {
    readonly ideInfo: IdeBridgeInfo;
    readonly host: string;
    readonly port: number;
    readonly instanceId: string;
    readonly registryPath: string;
    updateWindowState(focused: boolean): Promise<void>;
    dispose(): void;
}

export interface PruneGhosttyBridgeRegistryOptions {
    timeoutMs?: number;
}

const DEFAULT_REGISTRY_DIR = path.join(os.homedir(), '.claudeboard', 'ghostty-bridges');

export function getDefaultGhosttyBridgeRegistryDir(): string {
    return DEFAULT_REGISTRY_DIR;
}

export function resolveIdeBridgeInfo(
    uriScheme: string,
    extensionId = 'dkodr.claudeboard'
): IdeBridgeInfo {
    const normalizedScheme = uriScheme.trim().toLowerCase();
    const finalScheme = normalizedScheme || 'vscode';

    return {
        extensionId,
        uriScheme: finalScheme,
        priority: finalScheme === 'trae-cn' ? 1 : 2,
        deeplinkBase: `${finalScheme}://${extensionId}/ghostty-upload`
    };
}

export function buildGhosttyBridgeRegistryPath(
    registryDir: string,
    ideInfo: IdeBridgeInfo,
    instanceId: string
): string {
    return path.join(registryDir, `${ideInfo.uriScheme}-${instanceId}.json`);
}

export function createGhosttyBridgeRegistryRecord(options: {
    ideInfo: IdeBridgeInfo;
    instanceId: string;
    port: number;
    focused: boolean;
    workspaceFolder?: string;
}): GhosttyBridgeRegistryRecord {
    return {
        instanceId: options.instanceId,
        extensionId: options.ideInfo.extensionId,
        uriScheme: options.ideInfo.uriScheme,
        priority: options.ideInfo.priority,
        deeplinkBase: options.ideInfo.deeplinkBase,
        port: options.port,
        focused: options.focused,
        workspaceFolder: options.workspaceFolder,
        updatedAt: Date.now()
    };
}

export async function pruneStaleGhosttyBridgeRegistryRecords(
    registryDir: string,
    options: PruneGhosttyBridgeRegistryOptions = {}
): Promise<string[]> {
    let entries: string[];

    try {
        entries = await fs.readdir(registryDir);
    } catch (error) {
        if (isMissingDirectoryError(error)) {
            return [];
        }
        throw error;
    }

    const timeoutMs = options.timeoutMs ?? 500;
    const pruneResults = await Promise.all(entries
        .filter((entry) => entry.endsWith('.json'))
        .map(async (entry) => {
            const registryPath = path.join(registryDir, entry);
            const record = await readGhosttyBridgeRegistryRecord(registryPath);

            if (!record) {
                return null;
            }

            const isLive = await probeGhosttyBridgeRecord(record, timeoutMs);
            if (isLive) {
                return null;
            }

            await fs.rm(registryPath, { force: true });
            return registryPath;
        }));

    return pruneResults
        .filter((registryPath): registryPath is string => typeof registryPath === 'string')
        .sort();
}

export function parseGhosttyBridgeUploadRequest(
    body: string
): ValidationResult<GhosttyBridgeUploadRequest> {
    let parsedBody: unknown;
    try {
        parsedBody = JSON.parse(body);
    } catch (error) {
        return failure(new ValidationError(
            'Request body must be valid JSON',
            { originalError: error }
        ));
    }

    if (!parsedBody || typeof parsedBody !== 'object') {
        return failure(new ValidationError('Request body must be a JSON object'));
    }

    const action = (parsedBody as Record<string, unknown>).action;
    if (action !== 'uploadClipboardImage') {
        return failure(new ValidationError(
            'Unsupported bridge action',
            { action }
        ));
    }

    const requestId = (parsedBody as Record<string, unknown>).requestId;
    if (typeof requestId !== 'string' || requestId.trim() === '') {
        return failure(new ValidationError('Missing required requestId'));
    }

    const imageData = (parsedBody as Record<string, unknown>).imageData;

    return success({
        action: 'uploadClipboardImage',
        requestId: requestId.trim(),
        imageData: typeof imageData === 'string' && imageData.length > 0
            ? imageData
            : undefined
    });
}

const IMAGE_MAGIC_BYTES: ReadonlyArray<{ header: ReadonlyArray<number>; name: string }> = [
    { header: [0x89, 0x50, 0x4E, 0x47], name: 'PNG' },
    { header: [0xFF, 0xD8, 0xFF], name: 'JPEG' },
    { header: [0x49, 0x49, 0x2A, 0x00], name: 'TIFF-LE' },
    { header: [0x4D, 0x4D, 0x00, 0x2A], name: 'TIFF-BE' },
];

export function isValidImageBuffer(buffer: Buffer): boolean {
    if (buffer.length < 4) {
        return false;
    }

    return IMAGE_MAGIC_BYTES.some(({ header }) =>
        header.every((byte, i) => buffer[i] === byte)
    );
}

export function isLoopbackAddress(address?: string): boolean {
    if (!address) {
        return false;
    }

    return address === '127.0.0.1'
        || address === '::1'
        || address === '::ffff:127.0.0.1'
        || address === 'localhost';
}

export async function startGhosttyBridgeServer(
    options: StartGhosttyBridgeServerOptions
): Promise<GhosttyBridgeServer> {
    let activeUpload: Promise<ExtensionResult<string>> | null = null;
    const instanceId = options.instanceId ?? String(process.pid);
    const registryDir = options.registryDir ?? getDefaultGhosttyBridgeRegistryDir();

    try {
        await pruneStaleGhosttyBridgeRegistryRecords(registryDir);
    } catch {
        // Best effort: stale registry cleanup should not block bridge startup.
    }

    let activeRecord = createGhosttyBridgeRegistryRecord({
        ideInfo: options.ideInfo,
        instanceId,
        port: 0,
        focused: options.focused ?? false,
        workspaceFolder: options.workspaceFolder
    });

    const server = http.createServer(async (request, response) => {
        try {
            if (!isLoopbackAddress(request.socket.remoteAddress)) {
                writeJson(response, 403, {
                    ok: false,
                    error: 'Bridge accepts localhost requests only',
                    bridge: activeRecord
                });
                return;
            }

            const requestUrl = new URL(
                request.url ?? '/',
                `http://${options.host}:${activeRecord.port || 0}`
            );

            if (request.method === 'GET' && requestUrl.pathname === '/meta') {
                writeJson(response, 200, {
                    ok: true,
                    service: 'claudeboard',
                    bridge: activeRecord
                } satisfies GhosttyBridgeMetaResponse);
                return;
            }

            if (request.method !== 'POST' || requestUrl.pathname !== '/ghostty-upload') {
                writeJson(response, 404, {
                    ok: false,
                    error: 'Not found',
                    bridge: activeRecord
                });
                return;
            }

            const body = await readRequestBody(request);
            const contentType = (request.headers['content-type'] || '').toLowerCase();
            const isJsonRequest = contentType.includes('application/json');

            let requestId: string;
            let imageBuffer: Buffer | undefined;

            if (isJsonRequest) {
                const parsedRequest = parseGhosttyBridgeUploadRequest(body);
                if (Result.isFailure(parsedRequest)) {
                    writeJson(response, 400, {
                        ok: false,
                        error: parsedRequest.error.message,
                        bridge: activeRecord
                    });
                    return;
                }
                requestId = parsedRequest.data.requestId;
                if (!parsedRequest.data.imageData) {
                    writeJson(response, 400, {
                        ok: false,
                        requestId,
                        error: 'Missing required image data in bridge request',
                        bridge: activeRecord
                    } satisfies GhosttyBridgeUploadFailureResponse);
                    return;
                }
                imageBuffer = Buffer.from(parsedRequest.data.imageData, 'base64');
            } else {
                const queryRequestId = requestUrl.searchParams.get('requestId')?.trim();
                if (!queryRequestId) {
                    writeJson(response, 400, {
                        ok: false,
                        error: 'Missing required requestId query parameter',
                        bridge: activeRecord
                    });
                    return;
                }
                requestId = queryRequestId;
                if (body.length === 0) {
                    writeJson(response, 400, {
                        ok: false,
                        requestId,
                        error: 'Missing required image data in bridge request',
                        bridge: activeRecord
                    } satisfies GhosttyBridgeUploadFailureResponse);
                    return;
                }
                imageBuffer = Buffer.from(body, 'base64');
            }

            if (imageBuffer && !isValidImageBuffer(imageBuffer)) {
                writeJson(response, 400, {
                    ok: false,
                    requestId,
                    error: 'Invalid image data: not a recognized image format (PNG, JPEG, TIFF)',
                    bridge: activeRecord
                } satisfies GhosttyBridgeUploadFailureResponse);
                return;
            }

            if (activeUpload) {
                writeJson(response, 409, {
                    ok: false,
                    requestId,
                    error: 'Upload already in progress',
                    bridge: activeRecord
                } satisfies GhosttyBridgeUploadFailureResponse);
                return;
            }

            activeUpload = options.onUpload(imageBuffer);
            const uploadResult = await activeUpload;
            activeUpload = null;

            if (Result.isFailure(uploadResult)) {
                writeJson(response, 400, {
                    ok: false,
                    requestId,
                    error: uploadResult.error.message,
                    bridge: activeRecord
                } satisfies GhosttyBridgeUploadFailureResponse);
                return;
            }

            writeJson(response, 200, {
                ok: true,
                requestId,
                remotePath: uploadResult.data,
                bridge: activeRecord
            } satisfies GhosttyBridgeUploadSuccessResponse);
        } catch (error) {
            activeUpload = null;
            const message = error instanceof Error ? error.message : String(error);
            writeJson(response, 500, {
                ok: false,
                error: message,
                bridge: activeRecord
            } satisfies GhosttyBridgeUploadFailureResponse);
        }
    });

    if (options.onError) {
        server.on('error', options.onError);
    }

    await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, options.host, () => {
            server.off('error', reject);
            resolve();
        });
    });

    const address = server.address();
    const port = typeof address === 'object' && address
        ? (address as AddressInfo).port
        : 0;

    activeRecord = createGhosttyBridgeRegistryRecord({
        ideInfo: options.ideInfo,
        instanceId,
        port,
        focused: options.focused ?? false,
        workspaceFolder: options.workspaceFolder
    });

    const registryPath = buildGhosttyBridgeRegistryPath(registryDir, options.ideInfo, instanceId);
    await writeRegistryRecord(registryPath, activeRecord);

    return {
        host: options.host,
        port,
        instanceId,
        registryPath,
        ideInfo: options.ideInfo,
        async updateWindowState(focused: boolean): Promise<void> {
            activeRecord = createGhosttyBridgeRegistryRecord({
                ideInfo: options.ideInfo,
                instanceId,
                port,
                focused,
                workspaceFolder: options.workspaceFolder
            });
            await writeRegistryRecord(registryPath, activeRecord);
        },
        dispose(): void {
            server.close();
            void fs.rm(registryPath, { force: true }).catch(() => {
                // Best effort cleanup
            });
        }
    };
}

async function writeRegistryRecord(
    registryPath: string,
    record: GhosttyBridgeRegistryRecord
): Promise<void> {
    await fs.mkdir(path.dirname(registryPath), { recursive: true });
    await fs.writeFile(registryPath, JSON.stringify(record, null, 2), 'utf8');
}

async function readRequestBody(request: http.IncomingMessage): Promise<string> {
    const chunks: Buffer[] = [];

    for await (const chunk of request) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }

    return Buffer.concat(chunks).toString('utf8');
}

function writeJson(
    response: http.ServerResponse,
    statusCode: number,
    payload: GhosttyBridgeMetaResponse | GhosttyBridgeUploadSuccessResponse | GhosttyBridgeUploadFailureResponse
): void {
    const body = JSON.stringify(payload);
    response.writeHead(statusCode, {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
    });
    response.end(body);
}

async function readGhosttyBridgeRegistryRecord(
    registryPath: string
): Promise<GhosttyBridgeRegistryRecord | null> {
    let body: string;

    try {
        body = await fs.readFile(registryPath, 'utf8');
    } catch (error) {
        if (isMissingDirectoryError(error)) {
            return null;
        }
        throw error;
    }

    let parsed: unknown;
    try {
        parsed = JSON.parse(body);
    } catch {
        return null;
    }

    if (!isGhosttyBridgeRegistryRecord(parsed)) {
        return null;
    }

    return parsed;
}

function isGhosttyBridgeRegistryRecord(value: unknown): value is GhosttyBridgeRegistryRecord {
    if (!value || typeof value !== 'object') {
        return false;
    }

    const record = value as Record<string, unknown>;

    return typeof record.instanceId === 'string'
        && typeof record.extensionId === 'string'
        && typeof record.uriScheme === 'string'
        && typeof record.priority === 'number'
        && typeof record.deeplinkBase === 'string'
        && typeof record.port === 'number'
        && typeof record.focused === 'boolean'
        && typeof record.updatedAt === 'number'
        && (record.workspaceFolder === undefined || typeof record.workspaceFolder === 'string');
}

async function probeGhosttyBridgeRecord(
    record: GhosttyBridgeRegistryRecord,
    timeoutMs: number
): Promise<boolean> {
    if (!Number.isInteger(record.port) || record.port <= 0) {
        return false;
    }

    return await new Promise<boolean>((resolve) => {
        const request = http.request(new URL(`http://127.0.0.1:${record.port}/meta`), {
            method: 'GET'
        }, (response) => {
            if (response.statusCode !== 200) {
                response.resume();
                resolve(false);
                return;
            }

            const chunks: Buffer[] = [];
            response.on('data', (chunk) => {
                chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
            });
            response.on('end', () => {
                const body = Buffer.concat(chunks).toString('utf8');
                resolve(isMatchingGhosttyBridgeMeta(body, record));
            });
        });

        request.setTimeout(timeoutMs, () => {
            request.destroy(new Error(`Bridge probe timed out after ${timeoutMs}ms`));
        });

        request.on('error', () => {
            resolve(false);
        });

        request.end();
    });
}

function isMatchingGhosttyBridgeMeta(
    body: string,
    record: GhosttyBridgeRegistryRecord
): boolean {
    let parsed: unknown;

    try {
        parsed = JSON.parse(body);
    } catch {
        return false;
    }

    if (!parsed || typeof parsed !== 'object') {
        return false;
    }

    const payload = parsed as Record<string, unknown>;
    if (payload.ok !== true || payload.service !== 'claudeboard') {
        return false;
    }

    const bridge = payload.bridge;
    if (!isGhosttyBridgeRegistryRecord(bridge)) {
        return false;
    }

    return bridge.instanceId === record.instanceId
        && bridge.extensionId === record.extensionId
        && bridge.uriScheme === record.uriScheme
        && bridge.port === record.port;
}

function isMissingDirectoryError(error: unknown): boolean {
    return Boolean(
        error
        && typeof error === 'object'
        && 'code' in error
        && (error as { code?: unknown }).code === 'ENOENT'
    );
}
