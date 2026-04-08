import test from 'node:test';
import assert from 'node:assert/strict';
import {
    createDailyCleanupScheduler,
    CleanupSchedulerClock
} from '../src/services/cleanupScheduler';

test('runs cleanup immediately and on each interval tick', async () => {
    const calls: number[] = [];
    const clock = new FakeClock();
    const scheduler = createDailyCleanupScheduler({
        fileManager: {
            cleanupOldImages: async (retentionDays: number) => {
                calls.push(retentionDays);
            }
        },
        getRetentionDays: () => 30,
        intervalMs: 1000,
        clock
    });

    await flushAsync();
    assert.deepEqual(calls, [30]);

    clock.tick();
    await flushAsync();
    assert.deepEqual(calls, [30, 30]);

    scheduler.dispose();
});

test('reads retention days dynamically on each scheduled run', async () => {
    const calls: number[] = [];
    const clock = new FakeClock();
    let retentionDays = 30;
    const scheduler = createDailyCleanupScheduler({
        fileManager: {
            cleanupOldImages: async (value: number) => {
                calls.push(value);
            }
        },
        getRetentionDays: () => retentionDays,
        intervalMs: 1000,
        clock
    });

    await flushAsync();
    assert.deepEqual(calls, [30]);

    retentionDays = 7;
    clock.tick();
    await flushAsync();
    assert.deepEqual(calls, [30, 7]);

    scheduler.dispose();
});

test('stops scheduling after dispose', async () => {
    const calls: number[] = [];
    const clock = new FakeClock();
    const scheduler = createDailyCleanupScheduler({
        fileManager: {
            cleanupOldImages: async (value: number) => {
                calls.push(value);
            }
        },
        getRetentionDays: () => 30,
        intervalMs: 1000,
        clock
    });

    await flushAsync();
    assert.deepEqual(calls, [30]);

    scheduler.dispose();
    clock.tick();
    await flushAsync();
    assert.deepEqual(calls, [30]);
});

class FakeClock implements CleanupSchedulerClock {
    private readonly handlers = new Map<number, () => void>();
    private nextId = 1;

    setInterval(handler: () => void): unknown {
        const id = this.nextId;
        this.nextId += 1;
        this.handlers.set(id, handler);
        return id;
    }

    clearInterval(handle: unknown): void {
        if (typeof handle !== 'number') {
            return;
        }

        this.handlers.delete(handle);
    }

    tick(): void {
        for (const handler of this.handlers.values()) {
            handler();
        }
    }
}

async function flushAsync(): Promise<void> {
    await new Promise<void>((resolve) => {
        setImmediate(() => resolve());
    });
}
