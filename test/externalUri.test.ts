import test from 'node:test';
import assert from 'node:assert/strict';

import { parseExternalUploadUri } from '../src/services/externalUri';

test('rejects the deprecated ghostty vscode uri flow', () => {
    const parsed = parseExternalUploadUri('/ghostty-upload', new URLSearchParams({
        requestId: 'req-123',
        callback: 'http://127.0.0.1:47831/done'
    }));

    assert.equal(parsed.success, false);
    if (parsed.success) {
        return;
    }

    assert.match(parsed.error.message, /deprecated|hammerspoon|bridge/i);
});

test('rejects unsupported uri paths', () => {
    const parsed = parseExternalUploadUri('/not-supported', new URLSearchParams({
        requestId: 'req-123',
        callback: 'http://127.0.0.1:47831/done'
    }));

    assert.equal(parsed.success, false);
    if (parsed.success) {
        return;
    }

    assert.equal(parsed.error.code, 'VALIDATION_ERROR');
});

test('rejects missing request ids', () => {
    const parsed = parseExternalUploadUri('/ghostty-upload', new URLSearchParams({
        callback: 'http://127.0.0.1:47831/done'
    }));

    assert.equal(parsed.success, false);
    if (parsed.success) {
        return;
    }

    assert.match(parsed.error.message, /requestId/i);
});

test('rejects non-loopback callback hosts', () => {
    const parsed = parseExternalUploadUri('/ghostty-upload', new URLSearchParams({
        requestId: 'req-123',
        callback: 'https://example.com/done'
    }));

    assert.equal(parsed.success, false);
    if (parsed.success) {
        return;
    }

    assert.match(parsed.error.message, /localhost|loopback/i);
});
