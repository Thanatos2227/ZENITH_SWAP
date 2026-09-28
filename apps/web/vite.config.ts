import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
export default defineConfig({
    plugins: [react()],
    resolve: {
        alias: {
            '@zenith/types': path.resolve(__dirname, '../../packages/types/src'),
            '@zenith/chains': path.resolve(__dirname, '../../packages/chains/src'),
            '@zenith/contracts': path.resolve(__dirname, '../../packages/contracts/src'),
            '@zenith/tokens': path.resolve(__dirname, '../../packages/tokens/src'),
            '@zenith/security': path.resolve(__dirname, '../../packages/security/src'),
            '@zenith/routing': path.resolve(__dirname, '../../packages/routing/src'),
            '@zenith/execution': path.resolve(__dirname, '../../packages/execution/src'),
            '@zenith/ui': path.resolve(__dirname, '../../packages/ui/src'),
            '@': path.resolve(__dirname, './src')
        }
    },
    server: {
        port: 3000,
        host: true
    }
});
