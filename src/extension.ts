import * as vscode from 'vscode';
import { createClipboardService } from './services/clipboard';
import { createFileManager } from './services/fileManager';
import { createProgressService } from './services/progress';
import { createConfigurationService } from './services/configuration';
import {
    handleUploadCommand,
    CommandDependencies,
    InsertDestination,
    uploadClipboardImage,
    finalizeUploadedImage
} from './commands/uploadImage';
import { postExternalUploadResult } from './services/callbackClient';
import { parseExternalUploadUri, validateLoopbackCallbackUrl } from './services/externalUri';
import { Result } from './common/result';

// Main extension entry point
export function activate(context: vscode.ExtensionContext): void {
    // Initialize services
    const clipboard = createClipboardService();
    const fileManager = createFileManager();
    const progress = createProgressService();
    const config = createConfigurationService();

    const dependencies: CommandDependencies = {
        clipboard,
        fileManager,
        progress,
        config
    };

    // Register commands
    const commands = [
        {
            id: 'imageUploader.uploadFromClipboard.editor',
            destination: 'editor' as InsertDestination
        },
        {
            id: 'imageUploader.uploadFromClipboard.terminal',
            destination: 'terminal' as InsertDestination
        }
    ];

    const disposables = commands.map(({ id, destination }) =>
        vscode.commands.registerCommand(id, () => 
            handleUploadCommand(destination, dependencies)
        )
    );

    const uriHandlerDisposable = vscode.window.registerUriHandler({
        handleUri: async (uri) => {
            await handleExternalUploadUri(uri, dependencies);
        }
    });

    // Register configuration change handler
    const configDisposable = config.onConfigurationChanged((newConfig) => {
        console.log('Extension configuration updated:', newConfig);
        // Here you could update services that depend on configuration
    });

    // Add all disposables to context
    context.subscriptions.push(...disposables, configDisposable, uriHandlerDisposable);

    // Warm up clipboard service for better first-use experience
    clipboard.warmUp().catch(() => {
        // Silently fail - warming up is best effort
    });

    console.log('Claudeboard extension activated');
}

export function deactivate(): void {
    console.log('Claudeboard extension deactivated');
}

async function handleExternalUploadUri(
    uri: vscode.Uri,
    deps: CommandDependencies
): Promise<void> {
    const searchParams = new URLSearchParams(uri.query);
    const parsedRequest = parseExternalUploadUri(uri.path, searchParams);

    if (Result.isFailure(parsedRequest)) {
        await notifyExternalUploadErrorFromUri(searchParams, parsedRequest.error.message);
        vscode.window.showErrorMessage(`External upload error: ${parsedRequest.error.message}`);
        return;
    }

    const uploadResult = await uploadClipboardImage(deps, {
        progressTitle: 'Uploading image for Ghostty...'
    });

    if (Result.isFailure(uploadResult)) {
        try {
            await postExternalUploadResult({
                callbackUrl: parsedRequest.data.callbackUrl,
                payload: {
                    requestId: parsedRequest.data.requestId,
                    ok: false,
                    error: uploadResult.error.message
                }
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`External upload callback failed: ${message}`);
        }
        return;
    }

    try {
        await postExternalUploadResult({
            callbackUrl: parsedRequest.data.callbackUrl,
            payload: {
                requestId: parsedRequest.data.requestId,
                ok: true,
                remotePath: uploadResult.data
            }
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        vscode.window.showErrorMessage(`External upload callback failed: ${message}`);
        return;
    }

    await finalizeUploadedImage(deps, uploadResult.data);
}

async function notifyExternalUploadErrorFromUri(
    searchParams: URLSearchParams,
    errorMessage: string
): Promise<void> {
    const requestId = searchParams.get('requestId')?.trim();
    const callbackUrl = searchParams.get('callback')?.trim();

    if (!requestId || !callbackUrl) {
        return;
    }

    const callbackValidation = validateLoopbackCallbackUrl(callbackUrl);
    if (Result.isFailure(callbackValidation)) {
        return;
    }

    try {
        await postExternalUploadResult({
            callbackUrl: callbackValidation.data,
            payload: {
                requestId,
                ok: false,
                error: errorMessage
            }
        });
    } catch {
        // Best effort: if we cannot notify the callback, the helper will time out.
    }
}
