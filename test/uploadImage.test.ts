import test from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';

import { success } from '../src/common/result';

type UploadImageModule = typeof import('../src/commands/uploadImage');

function createMockVscode(options: {
    remoteName?: string | null;
    workspaceFolderSchemes?: string[];
}) {
    return {
        env: {
            remoteName: options.remoteName ?? null,
        },
        workspace: {
            workspaceFolders: (options.workspaceFolderSchemes ?? []).map((scheme, index) => ({
                uri: {
                    scheme,
                    fsPath: `/workspace-${index}`
                }
            }))
        },
        window: {}
    };
}

async function withUploadImageModule(
    mockVscode: unknown,
    run: (module: UploadImageModule) => Promise<void>
): Promise<void> {
    const patchedModule = Module as typeof Module & {
        _load: (request: string, parent: NodeModule | null, isMain: boolean) => unknown;
    };
    const originalLoad = patchedModule._load;
    const modulePath = require.resolve('../src/commands/uploadImage');

    delete require.cache[modulePath];

    patchedModule._load = function patchedLoad(request: string, parent: NodeModule | null, isMain: boolean) {
        if (request === 'vscode') {
            return mockVscode;
        }

        return originalLoad.call(this, request, parent, isMain);
    };

    try {
        const uploadImageModule = require('../src/commands/uploadImage') as UploadImageModule;
        await run(uploadImageModule);
    } finally {
        patchedModule._load = originalLoad;
        delete require.cache[modulePath];
    }
}

test('background buffer upload bypasses notification progress for ghostty bridge', async () => {
    await withUploadImageModule(createMockVscode({
        remoteName: 'ssh-remote+box'
    }), async ({ uploadImageFromBuffer }) => {
        let progressCalls = 0;
        let cleanupCalls = 0;
        let createFileCalls = 0;

        const result = await uploadImageFromBuffer({
            clipboard: {} as never,
            fileManager: {
                async createImageFile() {
                    createFileCalls += 1;
                    return {
                        getUri() {
                            throw new Error('not needed');
                        },
                        getPath() {
                            return '/remote/.claude/claude-code-chat-images/image_1.png';
                        },
                        async exists() {
                            return true;
                        },
                        dispose() {}
                    };
                },
                async cleanupOldImages() {
                    cleanupCalls += 1;
                },
                async ensureDirectoryExists() {}
            },
            progress: {
                async withProgress<T>(_title: string, task: (reporter: { report(step: { message: string; increment?: number }): void }) => Promise<T>) {
                    progressCalls += 1;
                    return await task({
                        report() {}
                    });
                },
                async withSequentialProgress() {
                    throw new Error('not needed');
                }
            },
            config: {
                getConfig() {
                    return {
                        keybinding: 'ctrl+alt+v' as const,
                        retentionDays: 30,
                        timeouts: {
                            clipboard: 10000,
                            upload: 30000,
                            cleanup: 5000
                        }
                    };
                },
                getRetentionDays() {
                    return 30;
                },
                getTimeouts() {
                    return {
                        clipboard: 10000,
                        upload: 30000,
                        cleanup: 5000
                    };
                },
                getClearClipboardAfterUpload() {
                    return false;
                },
                onConfigurationChanged() {
                    return { dispose() {} };
                },
                getKeybinding() {
                    return 'ctrl+alt+v';
                }
            }
        }, Buffer.from([0x89, 0x50, 0x4E, 0x47]), {
            executionMode: 'background'
        } as any);

        assert.equal(result.success, true);
        assert.equal(progressCalls, 0);
        assert.equal(cleanupCalls, 1);
        assert.equal(createFileCalls, 1);
    });
});

test('interactive buffer upload still uses notification progress', async () => {
    await withUploadImageModule(createMockVscode({
        remoteName: 'ssh-remote+box'
    }), async ({ uploadImageFromBuffer }) => {
        let progressCalls = 0;

        const result = await uploadImageFromBuffer({
            clipboard: {} as never,
            fileManager: {
                async createImageFile() {
                    return {
                        getUri() {
                            throw new Error('not needed');
                        },
                        getPath() {
                            return '/remote/.claude/claude-code-chat-images/image_2.png';
                        },
                        async exists() {
                            return true;
                        },
                        dispose() {}
                    };
                },
                async cleanupOldImages() {},
                async ensureDirectoryExists() {}
            },
            progress: {
                async withProgress<T>(_title: string, task: (reporter: { report(step: { message: string; increment?: number }): void }) => Promise<T>) {
                    progressCalls += 1;
                    return await task({
                        report() {}
                    });
                },
                async withSequentialProgress() {
                    throw new Error('not needed');
                }
            },
            config: {
                getConfig() {
                    return {
                        keybinding: 'ctrl+alt+v' as const,
                        retentionDays: 30,
                        timeouts: {
                            clipboard: 10000,
                            upload: 30000,
                            cleanup: 5000
                        }
                    };
                },
                getRetentionDays() {
                    return 30;
                },
                getTimeouts() {
                    return {
                        clipboard: 10000,
                        upload: 30000,
                        cleanup: 5000
                    };
                },
                getClearClipboardAfterUpload() {
                    return false;
                },
                onConfigurationChanged() {
                    return { dispose() {} };
                },
                getKeybinding() {
                    return 'ctrl+alt+v';
                }
            }
        }, Buffer.from([0x89, 0x50, 0x4E, 0x47]));

        assert.equal(result.success, true);
        assert.equal(progressCalls, 1);
    });
});
