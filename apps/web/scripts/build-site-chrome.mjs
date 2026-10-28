import { build } from "vite";

await build({
  configFile: false,
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
    __SITE_ORIGIN__: JSON.stringify("https://getbb.app"),
  },
  build: {
    outDir: "src/generated",
    minify: true,
    copyPublicDir: false,
    lib: {
      entry: "src/landing/site-chrome-client.tsx",
      formats: ["iife"],
      name: "SiteChrome",
      fileName: () => "site-chrome.js",
    },
  },
});
