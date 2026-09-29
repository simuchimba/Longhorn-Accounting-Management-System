import { defineConfig } from "nitro";

export default defineConfig({
  serverDir: "./server",
  runtimeConfig: {
    databaseUrl: "",
    sessionSecret: "",
  },
});
