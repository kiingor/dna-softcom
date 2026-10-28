import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '../..');
export default defineConfig({ root, plugins: [{ name: 'qa-feedback-hooks', enforce: 'pre', resolveId(source) { if (source.endsWith('/hooks/use-feedbacks') || source.endsWith('/hooks/use-feedback-settings') || source.endsWith('/hooks/usePermissions')) return path.resolve(root, 'tests/feedback-preview/hooks.ts'); } }, react()], resolve: { alias: { '@': path.resolve(root, 'src') } }, optimizeDeps: { entries: ['tests/feedback-preview/index.html'] }, server: { host: '127.0.0.1', port: 5490, strictPort: true } });
