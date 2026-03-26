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
    uploadImageFromBuffer,
    finalizeUploadedImage
} from './commands/uploadImage';
import { postExternalUploadResult } from './services/callbackClient';
import { parseExternalUploadUri, validateLoopbackCallbackUrl } from './services/externalUri';
import { Result } from './common/result';
import {
    getDefaultGhosttyBridgeRegistryDir,
    resolveIdeBridgeInfo,
    startGhosttyBridgeServer
} from './services/ghosttyBridge';
import {
    GhosttyBridgeStatusSnapshot,
    formatGhosttyBridgeStatus
} from './services/ghosttyBridgeStatus';

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

    const ideBridgeInfo = resolveIdeBridgeInfo(vscode.env.uriScheme, context.extension.id);
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const registryDir = getDefaultGhosttyBridgeRegistryDir();
    const bridgeStatus: GhosttyBridgeStatusSnapshot = {
        state: 'starting',
        ideScheme: ideBridgeInfo.uriScheme,
        workspaceFolder,
        registryDir
    };

    void startGhosttyBridgeServer({
        host: '127.0.0.1',
        ideInfo: ideBridgeInfo,
        workspaceFolder,
        focused: vscode.window.state.focused,
        onUpload: async (imageData: Buffer) => {
            const uploadResult = await uploadImageFromBuffer(dependencies, imageData, {
                progressTitle: 'Uploading image for Ghostty...'
            });

            if (Result.isSuccess(uploadResult)) {
                await finalizeUploadedImage(dependencies, uploadResult.data);
            }

            return uploadResult;
        },
        onError: (error) => {
            bridgeStatus.state = 'failed';
            bridgeStatus.error = error.message;
            console.warn('Claudeboard Ghostty bridge error:', error);
        }
    }).then((ghosttyBridgeServer) => {
        bridgeStatus.state = 'running';
        bridgeStatus.port = ghosttyBridgeServer.port;
        bridgeStatus.registryPath = ghosttyBridgeServer.registryPath;
        bridgeStatus.error = undefined;

        const windowStateDisposable = vscode.window.onDidChangeWindowState((windowState) => {
            void ghosttyBridgeServer.updateWindowState(windowState.focused).catch((error) => {
                const message = error instanceof Error ? error.message : String(error);
                bridgeStatus.state = 'failed';
                bridgeStatus.error = message;
                console.warn(`Failed to update Claudeboard Ghostty bridge state: ${message}`);
            });
        });

        context.subscriptions.push(ghosttyBridgeServer, windowStateDisposable);
        console.log(
            `Claudeboard Ghostty bridge listening on 127.0.0.1:${ghosttyBridgeServer.port} for ${ghosttyBridgeServer.ideInfo.uriScheme}`
        );
    }).catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        bridgeStatus.state = 'failed';
        bridgeStatus.error = message;
        console.warn(`Failed to start Claudeboard Ghostty bridge: ${message}`);
    });

    const showBridgeStatusDisposable = vscode.commands.registerCommand(
        'imageUploader.showGhosttyBridgeStatus',
        () => {
            const message = formatGhosttyBridgeStatus(bridgeStatus);

            if (bridgeStatus.state === 'failed') {
                void vscode.window.showErrorMessage(message);
                return;
            }

            if (bridgeStatus.state === 'starting') {
                void vscode.window.showWarningMessage(message);
                return;
            }

            void vscode.window.showInformationMessage(message);
        }
    );

    // Register configuration change handler
    const configDisposable = config.onConfigurationChanged((newConfig) => {
        console.log('Extension configuration updated:', newConfig);
        // Here you could update services that depend on configuration
    });

    // Add all disposables to context
    context.subscriptions.push(...disposables, configDisposable, uriHandlerDisposable, showBridgeStatusDisposable);

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
