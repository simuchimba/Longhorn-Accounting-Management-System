import { defineConfig } from "nitro";

export default defineConfig({
  serverDir: "./server",
  runtimeConfig: {
    // Supabase is the datastore and the identity provider.
    //   NITRO_SUPABASE_URL           e.g. https://xxxx.supabase.co
    //   NITRO_SUPABASE_ANON_KEY      the publishable key (safe to expose, verifies tokens)
    //   NITRO_SUPABASE_SERVICE_KEY   the secret key, used only by the admin panel routes
    supabaseUrl: "",
    supabaseAnonKey: "",
    supabaseServiceKey: "",
    databaseUrl: "",
    sessionSecret: "",
  },
});
