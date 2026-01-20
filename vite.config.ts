import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  base: "./",
  server: {
    host: "::",
    port: 8080,
    // Headers for SharedArrayBuffer support (needed by ONNX Runtime Web for multi-threading)
    // Using 'credentialless' instead of 'require-corp' to allow loading external images
    // Note: On mobile, we also configure ONNX to use single-threaded mode as a fallback
    headers: {
      "Cross-Origin-Embedder-Policy": "credentialless",
      "Cross-Origin-Opener-Policy": "same-origin",
    },
  },
  // Also add headers for preview server (production build testing)
  preview: {
    headers: {
      "Cross-Origin-Embedder-Policy": "credentialless",
      "Cross-Origin-Opener-Policy": "same-origin",
    },
  },
  plugins: [react(), mode === "development" && componentTagger()].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  // Optimize ONNX Runtime Web for better mobile support
  optimizeDeps: {
    exclude: ["onnxruntime-web"],
  },
}));
