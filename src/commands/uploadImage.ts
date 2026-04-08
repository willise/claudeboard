import * as vscode from 'vscode';
import { ClipboardService, ImageData } from '../services/clipboard';
import { FileManagerService } from '../services/fileManager';
import { ProgressReporter, ProgressService, ProgressSteps } from '../services/progress';
import { ConfigurationService } from '../services/configuration';
import { hasRemoteContext } from '../services/remoteContext';
import { Result, success, failure, ExtensionResult, ClipboardError, FileSystemError } from '../common/result';

export type InsertDestination = 'editor' | 'terminal';

export interface LockedInsertTarget {
    terminal?: vscode.Terminal;
    editor?: {
        editor: vscode.TextEditor;
        position: vscode.Position;
    };
}

export interface ExecuteUploadCommandOptions {
    lockedInsertTarget?: LockedInsertTarget;
}

export interface UploadImageCommand {
    execute(
        destination: InsertDestination,
        options?: ExecuteUploadCommandOptions
    ): Promise<ExtensionResult<string>>;
}

export interface CommandDependencies {
    clipboard: ClipboardService;
    fileManager: FileManagerService;
    progress: ProgressService;
    config: ConfigurationService;
}

export interface UploadClipboardImageOptions {
    progressTitle?: string;
    executionMode?: UploadExecutionMode;
}

export interface FinalizeUploadOptions {
    showSuccessMessage?: boolean;
}

export type UploadExecutionMode = 'interactive' | 'background';

class ClaudeboardUploadCommand implements UploadImageCommand {
    constructor(private readonly deps: CommandDependencies) {}

    async execute(
        destination: InsertDestination,
        options: ExecuteUploadCommandOptions = {}
    ): Promise<ExtensionResult<string>> {
        const uploadResult = await uploadClipboardImage(this.deps, {
            progressTitle: 'Uploading image to Server...'
        });

        if (Result.isFailure(uploadResult)) {
            return uploadResult;
        }

        const imageUrl = uploadResult.data;
        const insertResult = await insertImageUrl(imageUrl, destination, options.lockedInsertTarget);
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
    const workspaceFolderSchemes = (vscode.workspace.workspaceFolders ?? [])
        .map((folder) => folder.uri.scheme);

    if (!hasRemoteContext({
        remoteName: vscode.env.remoteName,
        workspaceFolderSchemes
    })) {
        return failure(new ClipboardError(
            'No remote connection detected. Please connect to a server using Remote-SSH to upload images.',
            {
                remoteName: vscode.env.remoteName,
                workspaceFolderSchemes
            }
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

export async function uploadImageFromBuffer(
    deps: CommandDependencies,
    imageBuffer: Buffer,
    options: UploadClipboardImageOptions = {}
): Promise<ExtensionResult<string>> {
    const remoteCheck = validateRemoteConnection();
    if (Result.isFailure(remoteCheck)) {
        return remoteCheck;
    }

    return await runUploadWithMode(
        deps,
        options,
        async (reporter) => {
            try {
                reporter.report(ProgressSteps.preparing());
                const retentionDays = deps.config.getRetentionDays();
                await deps.fileManager.cleanupOldImages(retentionDays);

                reporter.report(ProgressSteps.uploading());
                const imageFile = await deps.fileManager.createImageFile(imageBuffer, 'png');
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

export async function uploadClipboardImage(
    deps: CommandDependencies,
    options: UploadClipboardImageOptions = {}
): Promise<ExtensionResult<string>> {
    const remoteCheck = validateRemoteConnection();
    if (Result.isFailure(remoteCheck)) {
        return remoteCheck;
    }

    return await runUploadWithMode(
        deps,
        options,
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
    destination: InsertDestination,
    lockedInsertTarget?: LockedInsertTarget
): Promise<ExtensionResult<void>> {
    try {
        if (destination === 'editor') {
            const targetEditor = lockedInsertTarget?.editor?.editor ?? vscode.window.activeTextEditor;
            if (!targetEditor) {
                return failure(new FileSystemError('No active editor available'));
            }

            const position = lockedInsertTarget?.editor?.position ?? targetEditor.selection.active;
            await targetEditor.edit(editBuilder => {
                editBuilder.insert(position, url);
            });
        } else {
            const targetTerminal = lockedInsertTarget?.terminal ?? vscode.window.activeTerminal;
            if (!targetTerminal) {
                return failure(new FileSystemError('No active terminal available'));
            }

            targetTerminal.sendText(url, false);
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

export function captureLockedInsertTarget(destination: InsertDestination): LockedInsertTarget {
    if (destination === 'terminal') {
        const terminal = vscode.window.activeTerminal;
        return terminal ? { terminal } : {};
    }

    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        return {};
    }

    const activePosition = editor.selection.active;
    return {
        editor: {
            editor,
            position: new vscode.Position(activePosition.line, activePosition.character)
        }
    };
}

const silentProgressReporter: ProgressReporter = {
    report() {}
};

async function runUploadWithMode(
    deps: CommandDependencies,
    options: UploadClipboardImageOptions,
    task: (reporter: ProgressReporter) => Promise<ExtensionResult<string>>
): Promise<ExtensionResult<string>> {
    if ((options.executionMode ?? 'interactive') === 'background') {
        return await task(silentProgressReporter);
    }

    return await deps.progress.withProgress(
        options.progressTitle ?? 'Uploading image...',
        async (reporter) => await task(reporter)
    );
}

export async function handleUploadCommand(
    destination: InsertDestination,
    deps: CommandDependencies
): Promise<void> {
    const command = createUploadImageCommand(deps);
    const result = await command.execute(destination, {
        lockedInsertTarget: captureLockedInsertTarget(destination)
    });

    if (Result.isFailure(result)) {
        vscode.window.showErrorMessage(`Upload error: ${result.error.message}`);
    }
}
