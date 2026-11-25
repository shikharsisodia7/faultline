import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * Standalone build for Vercel.
 *
 * DeepSpace auth is same-origin by design (the browser trades its session
 * cookie for a JWT at /api/auth/token on the app's own origin), so a frontend
 * hosted on vercel.app cannot sign in to the DeepSpace backend. This build
 * ships the same UI and the same engines with clearly labeled synthetic data
 * and browser-local persistence, and links to the canonical DeepSpace app.
 */
export default defineConfig({
  root: fileURLToPath(new URL('./src/vercel', import.meta.url)),
  publicDir: fileURLToPath(new URL('./public', import.meta.url)),
  plugins: [react()],
  define: {
    __FAULTLINE_TARGET__: JSON.stringify('vercel'),
    __DEEPSPACE_APP_ID__: JSON.stringify('vercel-standalone'),
  },
  resolve: {
    alias: {
      '@faultline/engine': fileURLToPath(new URL('./packages/engine/src/index.ts', import.meta.url)),
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    outDir: fileURLToPath(new URL('./dist-vercel', import.meta.url)),
    emptyOutDir: true,
  },
  server: { port: 5190, strictPort: true },
})
