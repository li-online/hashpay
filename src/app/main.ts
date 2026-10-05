import { createApp } from "vue";
import naive from "naive-ui";
import { createRouter, createWebHistory } from "vue-router";
import App from "@/app/App.vue";
import NSegmented from "@/app/components/NSegmented.vue";
import { initTelegram } from "@/app/utils/telegram";
import "@/app/styles.scss";

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { component: () => import("@/app/pages/Setup.vue"), path: "/setup" },
    { path: "/admin", redirect: "/admin/overview" },
    { component: () => import("@/app/pages/Admin.vue"), meta: { back: "/admin/merchants" }, path: "/admin/merchants/new" },
    { component: () => import("@/app/pages/Admin.vue"), meta: { back: "/admin/merchants" }, path: "/admin/merchants/:id/edit" },
    { component: () => import("@/app/pages/Admin.vue"), meta: { back: "/admin/help" }, path: "/admin/help/:topic(telegram)" },
    { component: () => import("@/app/pages/Admin.vue"), path: "/admin/:tab(overview|orders|payments|merchants|help|settings)" },
    { component: () => import("@/app/pages/Pay.vue"), path: "/pay/:id" },
    { component: () => import("@/app/pages/Home.vue"), path: "/" },
  ],
});

initTelegram(router);

createApp(App).use(naive).component("NSegmented", NSegmented).use(router).mount("#app");
