import { FileManagerService } from './fileManager';

export const DAILY_CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;

export interface CleanupScheduler {
    dispose(): void;
}

export interface CleanupSchedulerClock {
    setInterval(handler: () => void, timeoutMs: number): unknown;
    clearInterval(handle: unknown): void;
}

export interface CleanupSchedulerOptions {
    fileManager: Pick<FileManagerService, 'cleanupOldImages'>;
    getRetentionDays: () => number;
    intervalMs?: number;
    runImmediately?: boolean;
    clock?: CleanupSchedulerClock;
}

const defaultClock: CleanupSchedulerClock = {
    setInterval: (handler, timeoutMs) => setInterval(handler, timeoutMs),
    clearInterval: (handle) => clearInterval(handle as ReturnType<typeof setInterval>)
};

export function createDailyCleanupScheduler(options: CleanupSchedulerOptions): CleanupScheduler {
    const intervalMs = options.intervalMs ?? DAILY_CLEANUP_INTERVAL_MS;
    const shouldRunImmediately = options.runImmediately ?? true;
    const clock = options.clock ?? defaultClock;

    let disposed = false;
    let cleanupInProgress = false;

    const runCleanup = async (): Promise<void> => {
        if (disposed || cleanupInProgress) {
            return;
        }

        cleanupInProgress = true;
        try {
            await options.fileManager.cleanupOldImages(options.getRetentionDays());
        } catch (error) {
            console.warn('Claudeboard scheduled cleanup failed:', error);
        } finally {
            cleanupInProgress = false;
        }
    };

    if (shouldRunImmediately) {
        void runCleanup();
    }

    const intervalHandle = clock.setInterval(() => {
        void runCleanup();
    }, intervalMs);

    return {
        dispose(): void {
            disposed = true;
            clock.clearInterval(intervalHandle);
        }
    };
}
