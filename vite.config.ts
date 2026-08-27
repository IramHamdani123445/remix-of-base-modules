import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 3000,
  },
  plugins: [
    react(),
    mode === 'development' && componentTagger(),
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // Mirror mode: point every backend import at the target project client.
      // Active only for `vite --mode mirror`; normal builds are unaffected.
      ...(mode === 'mirror'
        ? {
            "@/integrations/supabase/client": path.resolve(
              __dirname,
              "./src/integrations/supabase/mirrorClient.ts",
            ),
          }
        : {}),
    },
  },
  build: {
    chunkSizeWarningLimit: 2000,
  },
}));
