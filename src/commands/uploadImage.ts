import * as vscode from 'vscode';
import { ClipboardService, ImageData } from '../services/clipboard';
import { FileManagerService } from '../services/fileManager';
import { ProgressService, ProgressSteps } from '../services/progress';
import { ConfigurationService } from '../services/configuration';
import { Result, success, failure, ExtensionResult, ClipboardError, FileSystemError } from '../common/result';

export type InsertDestination = 'editor' | 'terminal';

export interface UploadImageCommand {
    execute(destination: InsertDestination): Promise<ExtensionResult<string>>;
}

export interface CommandDependencies {
    clipboard: ClipboardService;
    fileManager: FileManagerService;
    progress: ProgressService;
    config: ConfigurationService;
}

export interface UploadClipboardImageOptions {
    progressTitle?: string;
}

export interface FinalizeUploadOptions {
    showSuccessMessage?: boolean;
}

class ClaudeboardUploadCommand implements UploadImageCommand {
    constructor(private readonly deps: CommandDependencies) {}

    async execute(destination: InsertDestination): Promise<ExtensionResult<string>> {
        const uploadResult = await uploadClipboardImage(this.deps, {
            progressTitle: 'Uploading image to Server...'
        });

        if (Result.isFailure(uploadResult)) {
            return uploadResult;
        }

        const imageUrl = uploadResult.data;
        const insertResult = await insertImageUrl(imageUrl, destination);
        if (Result.isFailure(insertResult)) {
            return insertResult;
        }

        await finalizeUploadedImage(this.deps, imageUrl, {
            showSuccessMessage: true
        });

        return success(imageUrl);
    }
}

export function validateRemoteConnection(): ExtensionResult<void> {
    if (!vscode.env.remoteName) {
        return failure(new ClipboardError(
            'No remote connection detected. Please connect to a server using Remote-SSH to upload images.',
            { remoteName: vscode.env.remoteName }
        ));
    }

    return success(undefined);
}

export async function checkClipboard(
    clipboard: ClipboardService
): Promise<ExtensionResult<ImageData>> {
    try {
        const imageData = await clipboard.getImage();

        if (!imageData) {
            return failure(new ClipboardError('No image found in clipboard'));
        }

        return success(imageData);
    } catch (error) {
        return failure(new ClipboardError(
            'Failed to access clipboard',
            { originalError: error }
        ));
    }
}

export async function uploadClipboardImage(
    deps: CommandDependencies,
    options: UploadClipboardImageOptions = {}
): Promise<ExtensionResult<string>> {
    const remoteCheck = validateRemoteConnection();
    if (Result.isFailure(remoteCheck)) {
        return remoteCheck;
    }

    return await deps.progress.withProgress(
        options.progressTitle ?? 'Uploading image...',
        async (reporter) => {
            reporter.report(ProgressSteps.custom('Checking clipboard...', 10));

            const clipboardResult = await checkClipboard(deps.clipboard);
            if (Result.isFailure(clipboardResult)) {
                return clipboardResult;
            }

            try {
                reporter.report(ProgressSteps.preparing());

                const retentionDays = deps.config.getRetentionDays();
                await deps.fileManager.cleanupOldImages(retentionDays);

                reporter.report(ProgressSteps.uploading());

                const imageFile = await deps.fileManager.createImageFile(
                    clipboardResult.data.buffer,
                    clipboardResult.data.format
                );

                return success(imageFile.getPath());
            } catch (error) {
                return failure(new FileSystemError(
                    'Failed to upload image',
                    { originalError: error }
                ));
            }
        }
    );
}

export async function finalizeUploadedImage(
    deps: CommandDependencies,
    imageUrl: string,
    options: FinalizeUploadOptions = {}
): Promise<void> {
    if (deps.config.getClearClipboardAfterUpload()) {
        await deps.clipboard.clear();
    }

    if (options.showSuccessMessage) {
        vscode.window.showInformationMessage(`Image uploaded: ${imageUrl}`);
    }
}

export async function insertImageUrl(
    url: string,
    destination: InsertDestination
): Promise<ExtensionResult<void>> {
    try {
        if (destination === 'editor') {
            const activeEditor = vscode.window.activeTextEditor;
            if (!activeEditor) {
                return failure(new FileSystemError('No active editor available'));
            }

            const position = activeEditor.selection.active;
            await activeEditor.edit(editBuilder => {
                editBuilder.insert(position, url);
            });
        } else {
            const activeTerminal = vscode.window.activeTerminal;
            if (!activeTerminal) {
                return failure(new FileSystemError('No active terminal available'));
            }

            activeTerminal.sendText(url, false);
        }

        return success(undefined);
    } catch (error) {
        return failure(new FileSystemError(
            `Failed to insert image URL into ${destination}`,
            { originalError: error, destination, url }
        ));
    }
}

export function createUploadImageCommand(deps: CommandDependencies): UploadImageCommand {
    return new ClaudeboardUploadCommand(deps);
}

export async function handleUploadCommand(
    destination: InsertDestination,
    deps: CommandDependencies
): Promise<void> {
    const command = createUploadImageCommand(deps);
    const result = await command.execute(destination);

    if (Result.isFailure(result)) {
        vscode.window.showErrorMessage(`Upload error: ${result.error.message}`);
    }
}
