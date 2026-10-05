import { Hono } from "hono";
import admin from "@/server/http/routes/admin";
import auth from "@/server/http/routes/auth";
import ezfp from "@/server/http/routes/ezfp";
import publicRoutes from "@/server/http/routes/public";
import type { HonoEnv } from "@/server/types/env";

const app = new Hono<HonoEnv>();

app.route("/", ezfp);
app.route("/", publicRoutes);
app.route("/api", auth);
app.route("/api/admin", admin);

export default app;
