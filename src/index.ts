import { createApp } from "@/server/http/app";
import { handleNotifyQueue, runJobs } from "@/server/services/app/jobs";
import type { AppEnv } from "@/server/types/env";

const app = createApp();

export default {
  fetch(request: Request, env: AppEnv, ctx: ExecutionContext) {
    return app.fetch(request, env, ctx);
  },
  async scheduled(controller: ScheduledController, env: AppEnv, ctx: ExecutionContext) {
    ctx.waitUntil(runJobs(env, new Date(controller.scheduledTime)));
  },
  async queue(batch: MessageBatch<unknown>, env: AppEnv) {
    await handleNotifyQueue(batch, env);
  },
} satisfies ExportedHandler<AppEnv>;
