import { defineConfig } from 'vite';

export default defineConfig({
  define: {
    'import.meta.env.VITE_USE_EXAMPLE_ENV': JSON.stringify(process.env.VITE_USE_EXAMPLE_ENV || 'false')
  }
});
