import { ValidationResult, success, failure, ValidationError } from '../common/result';

const SUPPORTED_PATH = '/ghostty-upload';
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
const GHOSTTY_URI_DEPRECATION_MESSAGE =
    'The vscode:// Ghostty upload flow is deprecated. Replace your Hammerspoon config with the bridge-based script from examples/hammerspoon/init.lua.';

export function parseExternalUploadUri(
    path: string,
    searchParams: URLSearchParams
): ValidationResult<never> {
    if (path !== SUPPORTED_PATH) {
        return failure(new ValidationError(
            `Unsupported external upload path: ${path}`,
            { path }
        ));
    }

    const requestId = searchParams.get('requestId')?.trim();
    if (!requestId) {
        return failure(new ValidationError(
            'Missing required requestId parameter',
            { path }
        ));
    }

    const callbackUrl = searchParams.get('callback')?.trim();
    if (!callbackUrl) {
        return failure(new ValidationError(
            'Missing required callback parameter',
            { path, requestId }
        ));
    }

    const callbackValidation = validateLoopbackCallbackUrl(callbackUrl);
    if (!callbackValidation.success) {
        return callbackValidation;
    }

    return failure(new ValidationError(
        GHOSTTY_URI_DEPRECATION_MESSAGE,
        {
            path,
            requestId,
            callbackUrl: callbackValidation.data
        }
    ));
}

export function validateLoopbackCallbackUrl(callbackUrl: string): ValidationResult<string> {
    let parsedUrl: URL;
    try {
        parsedUrl = new URL(callbackUrl);
    } catch (error) {
        return failure(new ValidationError(
            'Callback must be a valid URL',
            { callbackUrl, originalError: error }
        ));
    }

    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
        return failure(new ValidationError(
            'Callback must use http or https',
            { callbackUrl }
        ));
    }

    if (!LOOPBACK_HOSTS.has(parsedUrl.hostname)) {
        return failure(new ValidationError(
            'Callback host must be localhost or another loopback address',
            { callbackUrl, host: parsedUrl.hostname }
        ));
    }

    return success(parsedUrl.toString());
}
