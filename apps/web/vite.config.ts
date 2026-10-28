import { fileURLToPath } from "node:url";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { defineConfig } from "vite";
import {
  cloudflare,
  type PluginConfig,
  type WorkerConfig,
} from "@cloudflare/vite-plugin";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { unstable_readConfig } from "wrangler";
import { resolveCloudDevViteSettings } from "./src/server/cloud-dev-vite.js";
import { resolveSiteOrigin } from "./src/server/site-origin.js";

export default defineConfig(({ command }) => {
  const cloudDev = resolveCloudDevViteSettings(command, process.env);
  const siteOrigin = resolveSiteOrigin(
    cloudDev?.vars.APP_URL ??
      unstable_readConfig({
        config: fileURLToPath(new URL("./wrangler.jsonc", import.meta.url)),
        env: process.env.CLOUDFLARE_ENV,
      }).vars.APP_URL,
  );
  const cloudflareConfig: PluginConfig = {
    viteEnvironment: { name: "ssr" },
    ...(cloudDev
      ? {
          persistState: { path: cloudDev.persistStatePath },
          config: (config: WorkerConfig) => ({
            vars: {
              ...config.vars,
              ...cloudDev.vars,
            },
          }),
        }
      : {}),
  };

  return {
    define: { __SITE_ORIGIN__: JSON.stringify(siteOrigin) },
    resolve: {
      alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
      dedupe: ["react", "react-dom"],
    },
    server: {
      allowedHosts: [".localhost", ".ts.net"],
    },
    plugins: [
      {
        name: "ssr-static-assets",
        async writeBundle(_options, bundle) {
          if (this.environment.name !== "ssr") return;
          const clientDir = fileURLToPath(
            new URL("./dist/client", import.meta.url),
          );
          await Promise.all(
            Object.values(bundle).map(async (output) => {
              if (
                output.type !== "asset" ||
                !output.fileName.startsWith("assets/")
              )
                return;
              const path = resolve(clientDir, output.fileName);
              await mkdir(dirname(path), { recursive: true });
              await writeFile(path, output.source);
            }),
          );
        },
      },
      cloudflare(cloudflareConfig),
      tailwindcss(),
      tanstackStart({
        server: { entry: "server-entry.ts" },
        router: {
          quoteStyle: "double",
          semicolons: true,
          routeTreeFileHeader: [
            "/* oxlint-disable */",
            "// @ts-nocheck",
            "// noinspection JSUnusedGlobalSymbols",
          ],
        },
      }),
      viteReact(),
    ],
  };
});
