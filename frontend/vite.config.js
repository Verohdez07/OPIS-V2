import { defineConfig } from "vite"

export default defineConfig({
  // En produccion (Docker) el frontend esta en la raiz del servidor
  base: "/",

  server: {
    // Proxy en desarrollo: las llamadas a /upload, /traces, etc.
    // se reenvian automaticamente al backend FastAPI en 8000
    proxy: {
      "/upload":          "http://localhost:8000",
      "/traces":          "http://localhost:8000",
      "/picks":           "http://localhost:8000",
      "/remove_response": "http://localhost:8000",
      "/calcular_epicentro": "http://localhost:8000",
    },
  },

  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
})
