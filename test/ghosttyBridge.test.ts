import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';
import { AddressInfo } from 'node:net';

import {
    GhosttyBridgeRegistryRecord,
    resolveIdeBridgeInfo,
    parseGhosttyBridgeUploadRequest,
    isLoopbackAddress,
    buildGhosttyBridgeRegistryPath,
    createGhosttyBridgeRegistryRecord,
    pruneStaleGhosttyBridgeRegistryRecords,
    startGhosttyBridgeServer
} from '../src/services/ghosttyBridge';
import { success } from '../src/common/result';

test('prefers Trae over VS Code without hard-coding a shared bridge port', () => {
    const ideInfo = resolveIdeBridgeInfo('trae-cn');

    assert.equal(ideInfo.uriScheme, 'trae-cn');
    assert.equal(ideInfo.priority, 1);
    assert.equal('port' in ideInfo, false);
});

test('maps VS Code to lower bridge priority', () => {
    const ideInfo = resolveIdeBridgeInfo('vscode');

    assert.equal(ideInfo.uriScheme, 'vscode');
    assert.equal(ideInfo.priority, 2);
    assert.equal('port' in ideInfo, false);
});

test('builds a per-instance registry path', () => {
    const ideInfo = resolveIdeBridgeInfo('trae-cn');
    const registryPath = buildGhosttyBridgeRegistryPath('/tmp/claudeboard', ideInfo, 'instance-123');

    assert.equal(registryPath, '/tmp/claudeboard/trae-cn-instance-123.json');
});

test('creates a registry record for an individual bridge instance', () => {
    const ideInfo = resolveIdeBridgeInfo('vscode');
    const record = createGhosttyBridgeRegistryRecord({
        ideInfo,
        instanceId: 'instance-123',
        port: 34567,
        focused: true,
        workspaceFolder: '/workspace/project'
    });

    assert.equal(record.uriScheme, 'vscode');
    assert.equal(record.instanceId, 'instance-123');
    assert.equal(record.port, 34567);
    assert.equal(record.focused, true);
    assert.equal(record.workspaceFolder, '/workspace/project');
    assert.ok(record.updatedAt > 0);
});

test('parses a valid localhost bridge upload request with a request id', () => {
    const parsed = parseGhosttyBridgeUploadRequest(JSON.stringify({
        action: 'uploadClipboardImage',
        requestId: 'req-123'
    }));

    assert.equal(parsed.success, true);
    if (!parsed.success) {
        return;
    }

    assert.equal(parsed.data.action, 'uploadClipboardImage');
    assert.equal(parsed.data.requestId, 'req-123');
});

test('rejects upload requests without a request id', () => {
    const parsed = parseGhosttyBridgeUploadRequest(JSON.stringify({
        action: 'uploadClipboardImage'
    }));

    assert.equal(parsed.success, false);
    if (parsed.success) {
        return;
    }

    assert.match(parsed.error.message, /requestId/i);
});

test('rejects malformed localhost bridge request bodies', () => {
    const parsed = parseGhosttyBridgeUploadRequest('not-json');

    assert.equal(parsed.success, false);
    if (parsed.success) {
        return;
    }

    assert.match(parsed.error.message, /json/i);
});

test('accepts common loopback address variants', () => {
    assert.equal(isLoopbackAddress('127.0.0.1'), true);
    assert.equal(isLoopbackAddress('::1'), true);
    assert.equal(isLoopbackAddress('::ffff:127.0.0.1'), true);
});

test('rejects non-loopback client addresses', () => {
    assert.equal(isLoopbackAddress('192.168.1.8'), false);
    assert.equal(isLoopbackAddress(undefined), false);
});

test('prunes registry files whose bridge no longer responds', async (t) => {
    const ideInfo = resolveIdeBridgeInfo('vscode');
    const registryDir = await fs.mkdtemp(path.join(os.tmpdir(), 'claudeboard-ghostty-'));
    const registryPath = buildGhosttyBridgeRegistryPath(registryDir, ideInfo, 'dead-bridge');
    const port = await reserveClosedLoopbackPort();

    t.after(async () => {
        await fs.rm(registryDir, { recursive: true, force: true });
    });

    await fs.writeFile(registryPath, JSON.stringify(createGhosttyBridgeRegistryRecord({
        ideInfo,
        instanceId: 'dead-bridge',
        port,
        focused: false
    }), null, 2), 'utf8');

    const prunedPaths = await pruneStaleGhosttyBridgeRegistryRecords(registryDir, {
        timeoutMs: 100
    });

    assert.deepEqual(prunedPaths, [registryPath]);
    await assert.rejects(fs.stat(registryPath));
});

test('keeps registry files whose bridge /meta probe matches the record', async (t) => {
    const ideInfo = resolveIdeBridgeInfo('vscode');
    const registryDir = await fs.mkdtemp(path.join(os.tmpdir(), 'claudeboard-ghostty-live-'));
    const server = http.createServer();

    t.after(async () => {
        server.close();
        await fs.rm(registryDir, { recursive: true, force: true });
    });

    await listen(server);
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    const port = (address as AddressInfo).port;

    const record = createGhosttyBridgeRegistryRecord({
        ideInfo,
        instanceId: 'live-bridge',
        port,
        focused: false
    });
    const registryPath = buildGhosttyBridgeRegistryPath(registryDir, ideInfo, 'live-bridge');

    server.removeAllListeners('request');
    server.on('request', (_request, response) => {
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({
            ok: true,
            service: 'claudeboard',
            bridge: record
        }));
    });

    await fs.writeFile(registryPath, JSON.stringify(record, null, 2), 'utf8');

    const prunedPaths = await pruneStaleGhosttyBridgeRegistryRecords(registryDir, {
        timeoutMs: 100
    });

    assert.deepEqual(prunedPaths, []);
    await fs.stat(registryPath);
});

test('rejects ghostty bridge uploads that do not include inline image data', async (t) => {
    const ideInfo = resolveIdeBridgeInfo('vscode');
    const registryDir = await fs.mkdtemp(path.join(os.tmpdir(), 'claudeboard-ghostty-bridge-'));
    let uploadCalls = 0;

    const bridge = await startGhosttyBridgeServer({
        host: '127.0.0.1',
        ideInfo,
        registryDir,
        onUpload: async () => {
            uploadCalls += 1;
            return success('/remote/image.png');
        }
    });

    t.after(async () => {
        bridge.dispose();
        await fs.rm(registryDir, { recursive: true, force: true });
    });

    const response = await httpRequest({
        hostname: '127.0.0.1',
        port: bridge.port,
        path: '/ghostty-upload?requestId=req-1',
        method: 'POST',
        headers: {
            'Content-Type': 'text/plain',
            'Content-Length': '0'
        }
    });

    assert.equal(response.statusCode, 400);
    assert.match(response.body, /image data/i);
    assert.equal(uploadCalls, 0);
});

async function listen(server: http.Server): Promise<void> {
    await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
            server.off('error', reject);
            resolve();
        });
    });
}

async function reserveClosedLoopbackPort(): Promise<number> {
    const server = http.createServer();
    await listen(server);

    const address = server.address();
    assert.ok(address && typeof address === 'object');
    const port = (address as AddressInfo).port;

    await new Promise<void>((resolve, reject) => {
        server.close((error) => {
            if (error) {
                reject(error);
                return;
            }
            resolve();
        });
    });

    return port;
}

async function httpRequest(options: http.RequestOptions, body?: string): Promise<{
    statusCode: number;
    body: string;
}> {
    return await new Promise((resolve, reject) => {
        const request = http.request(options, (response) => {
            const chunks: Buffer[] = [];

            response.on('data', (chunk) => {
                chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
            });
            response.on('end', () => {
                resolve({
                    statusCode: response.statusCode ?? 0,
                    body: Buffer.concat(chunks).toString('utf8')
                });
            });
        });

        request.on('error', reject);

        if (body) {
            request.write(body);
        }

        request.end();
    });
}
