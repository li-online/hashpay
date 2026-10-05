import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppEnv } from "@/server/types/env";

const mocks = vi.hoisted(() => ({
  all: vi.fn(),
  checkChannels: vi.fn(),
  checkPendingPayments: vi.fn(),
  deliverNotify: vi.fn(),
  migrateD1: vi.fn(),
  now: vi.fn(),
  run: vi.fn(),
  syncMarketRates: vi.fn(),
}));

vi.mock("@/server/db", () => ({
  all: mocks.all,
  now: mocks.now,
  run: mocks.run,
}));

vi.mock("@/server/db/migrations", () => ({
  migrateD1: mocks.migrateD1,
}));

vi.mock("@/server/payments/channels", () => ({
  checkChannels: mocks.checkChannels,
}));

vi.mock("@/server/services/orders/checkout", () => ({
  checkPendingPayments: mocks.checkPendingPayments,
}));

vi.mock("@/server/services/orders/notifications", () => ({
  deliverNotify: mocks.deliverNotify,
}));

vi.mock("@/server/services/app/settings", () => ({
  syncMarketRates: mocks.syncMarketRates,
}));

import { handleNotifyQueue, runJobs } from "@/server/services/app/jobs";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.all.mockResolvedValue([]);
  mocks.checkChannels.mockResolvedValue(undefined);
  mocks.checkPendingPayments.mockResolvedValue(undefined);
  mocks.deliverNotify.mockResolvedValue(undefined);
  mocks.migrateD1.mockResolvedValue(undefined);
  mocks.now.mockReturnValue(1234);
  mocks.run.mockResolvedValue({});
  mocks.syncMarketRates.mockResolvedValue(undefined);
});

describe("scheduled jobs", () => {
  it("runs every-minute jobs and enqueues due notify rows", async () => {
    const env = envWithQueue();
    mocks.all.mockResolvedValue([{ id: 11 }, { id: 12 }]);

    await runJobs(env, new Date("2026-07-04T08:01:00Z"));

    expect(mocks.migrateD1).toHaveBeenCalledTimes(1);
    expect(mocks.syncMarketRates).not.toHaveBeenCalled();
    expect(mocks.run).toHaveBeenCalledWith(env, expect.stringContaining("UPDATE orders SET status = 'expired'"), 1234, 1234);
    expect(mocks.checkChannels).toHaveBeenCalledWith(env, "error");
    expect(mocks.checkPendingPayments).toHaveBeenCalledWith(env);
    expect(mocks.all).toHaveBeenCalledWith(env, expect.stringContaining("SELECT id FROM notify"), 1234);
    expect(env.QUEUE_NOTIFY?.send).toHaveBeenCalledTimes(2);
    expect(env.QUEUE_NOTIFY?.send).toHaveBeenNthCalledWith(1, { notifyId: 11 });
    expect(env.QUEUE_NOTIFY?.send).toHaveBeenNthCalledWith(2, { notifyId: 12 });
  });

  it("runs hourly rate sync without blocking the rest of the schedule", async () => {
    const env = envWithQueue();
    mocks.syncMarketRates.mockRejectedValue(new Error("rate api down"));

    await runJobs(env, new Date("2026-07-04T08:00:00Z"));

    expect(mocks.syncMarketRates).toHaveBeenCalledWith(env);
    expect(mocks.run).toHaveBeenCalledWith(env, expect.stringContaining("UPDATE orders SET status = 'expired'"), 1234, 1234);
    expect(mocks.checkChannels).toHaveBeenCalledWith(env, "error");
    expect(mocks.checkPendingPayments).toHaveBeenCalledWith(env);
    expect(mocks.all).toHaveBeenCalledWith(env, expect.stringContaining("SELECT id FROM notify"), 1234);
  });

  it("acks queue messages after notify retry state is written in D1", async () => {
    const env = envWithQueue();
    const message = queueMessage({ notifyId: 42 });
    mocks.deliverNotify.mockRejectedValue(new Error("notify remains retryable in D1"));

    await handleNotifyQueue({ messages: [message] } as never, env);

    expect(mocks.deliverNotify).toHaveBeenCalledWith(env, 42);
    expect(message.ack).toHaveBeenCalledTimes(1);
    expect(message.retry).not.toHaveBeenCalled();
  });

  it("acks invalid queue messages without delivery", async () => {
    const env = envWithQueue();
    const message = queueMessage({ notifyId: "nope" });

    await handleNotifyQueue({ messages: [message] } as never, env);

    expect(mocks.deliverNotify).not.toHaveBeenCalled();
    expect(message.ack).toHaveBeenCalledTimes(1);
    expect(message.retry).not.toHaveBeenCalled();
  });
});

function envWithQueue() {
  return {
    QUEUE_NOTIFY: {
      send: vi.fn().mockResolvedValue(undefined),
    },
  } as unknown as AppEnv;
}

function queueMessage(body: unknown) {
  return {
    ack: vi.fn(),
    body,
    retry: vi.fn(),
  };
}
