import test from 'node:test';
import assert from 'node:assert/strict';

import { formatGhosttyBridgeStatus } from '../src/services/ghosttyBridgeStatus';

test('formats a running bridge status with port and registry path', () => {
    const message = formatGhosttyBridgeStatus({
        state: 'running',
        ideScheme: 'vscode',
        workspaceFolder: '/workspace/project',
        registryDir: '/Users/me/.claudeboard/ghostty-bridges',
        registryPath: '/Users/me/.claudeboard/ghostty-bridges/vscode-123.json',
        port: 35123
    });

    assert.match(message, /running/i);
    assert.match(message, /vscode/i);
    assert.match(message, /35123/);
    assert.match(message, /ghostty-bridges/);
});

test('formats a failed bridge status with the last error', () => {
    const message = formatGhosttyBridgeStatus({
        state: 'failed',
        ideScheme: 'trae-cn',
        workspaceFolder: '/workspace/project',
        registryDir: '/Users/me/.claudeboard/ghostty-bridges',
        error: 'listen EADDRINUSE'
    });

    assert.match(message, /failed/i);
    assert.match(message, /trae-cn/i);
    assert.match(message, /EADDRINUSE/);
});
