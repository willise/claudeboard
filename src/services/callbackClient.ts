import * as http from 'http';
import * as https from 'https';

import { validateLoopbackCallbackUrl } from './externalUri';

export interface ExternalUploadCallbackPayload {
    requestId: string;
    ok: boolean;
    remotePath?: string;
    error?: string;
}

export interface PostExternalUploadResultOptions {
    callbackUrl: string;
    payload: ExternalUploadCallbackPayload;
    timeoutMs?: number;
}

export async function postExternalUploadResult(
    options: PostExternalUploadResultOptions
): Promise<void> {
    const callbackValidation = validateLoopbackCallbackUrl(options.callbackUrl);
    if (!callbackValidation.success) {
        throw callbackValidation.error;
    }

    const parsedUrl = new URL(callbackValidation.data);
    const client = parsedUrl.protocol === 'https:' ? https : http;
    const body = JSON.stringify(options.payload);
    const timeoutMs = options.timeoutMs ?? 10_000;

    await new Promise<void>((resolve, reject) => {
        const request = client.request(parsedUrl, {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                'content-length': Buffer.byteLength(body)
            }
        }, (response) => {
            response.resume();

            if (response.statusCode && response.statusCode >= 200 && response.statusCode < 300) {
                resolve();
                return;
            }

            reject(new Error(`Callback request failed with status ${response.statusCode ?? 'unknown'}`));
        });

        request.setTimeout(timeoutMs, () => {
            request.destroy(new Error(`Callback request timed out after ${timeoutMs}ms`));
        });

        request.on('error', reject);
        request.write(body);
        request.end();
    });
}
