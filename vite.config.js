import { defineConfig } from 'vite'
import tailwindcss from '@tailwindcss/vite'

// Genera public/version.json con un ID único por build. main.js lo consulta
// con fetch(..., {cache:'no-store'}) para detectar si el navegador quedó con
// una versión vieja de la página guardada en caché (típico en el browser
// interno de WhatsApp) y forzar una recarga real — ver src/main.js.
function versionFile() {
  return {
    name: 'version-file',
    buildStart() {
      this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ v: String(Date.now()) }) })
    },
  }
}

export default defineConfig({
  plugins: [tailwindcss(), versionFile()],
  // host: true expone el server en la red local (celular / otra laptop).
  server: { host: true, port: 5173 },
  preview: { host: true, port: 4173 },
  build: {
    rollupOptions: {
      input: {
        main: 'index.html',
        admin: 'admin.html'
      }
    }
  }
})
