import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

import { postExternalUploadResult } from '../src/services/callbackClient';

test('posts a success payload to a localhost callback', async () => {
    let body = '';

    const server = http.createServer((req, res) => {
        req.setEncoding('utf8');
        req.on('data', chunk => {
            body += chunk;
        });
        req.on('end', () => {
            res.writeHead(204);
            res.end();
        });
    });

    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));

    try {
        const address = server.address();
        if (!address || typeof address === 'string') {
            throw new Error('expected a TCP address');
        }

        await postExternalUploadResult({
            callbackUrl: `http://127.0.0.1:${address.port}/done`,
            payload: {
                requestId: 'req-123',
                ok: true,
                remotePath: '/workspace/.claude/claude-code-chat-images/image_123.png'
            }
        });

        assert.deepEqual(JSON.parse(body), {
            requestId: 'req-123',
            ok: true,
            remotePath: '/workspace/.claude/claude-code-chat-images/image_123.png'
        });
    } finally {
        await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
});

test('posts a failure payload to a localhost callback', async () => {
    let body = '';

    const server = http.createServer((req, res) => {
        req.setEncoding('utf8');
        req.on('data', chunk => {
            body += chunk;
        });
        req.on('end', () => {
            res.writeHead(204);
            res.end();
        });
    });

    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));

    try {
        const address = server.address();
        if (!address || typeof address === 'string') {
            throw new Error('expected a TCP address');
        }

        await postExternalUploadResult({
            callbackUrl: `http://127.0.0.1:${address.port}/done`,
            payload: {
                requestId: 'req-123',
                ok: false,
                error: 'No image found in clipboard'
            }
        });

        assert.deepEqual(JSON.parse(body), {
            requestId: 'req-123',
            ok: false,
            error: 'No image found in clipboard'
        });
    } finally {
        await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
});
