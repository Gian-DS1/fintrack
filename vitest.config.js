import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.{js,jsx}', 'api/**/*.test.js'],
    // Los stores importan src/lib/supabase.js, que crea el cliente al cargar el
    // módulo y lanza si la URL está vacía. En tests no hay .env (ni debe haberlo:
    // el repo no versiona credenciales), así que inyectamos un proyecto ficticio.
    // Ninguna prueba hace red: son puras sobre los stores y los cálculos.
    env: {
      VITE_SUPABASE_URL: 'http://localhost:54321',
      VITE_SUPABASE_ANON_KEY: 'test-anon-key',
    },
  },
});
