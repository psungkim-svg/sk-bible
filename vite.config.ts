import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import fs from 'node:fs';

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const BUILD_TIME = new Date().toISOString();

/*
  모든 파일이 폴더 없이 한 곳에 있어도 동작하도록,
  성경 본문(nkrv.json)과 아이콘(png)을 빌드 결과(dist)의 data/, icons/ 폴더로 복사합니다.
*/
const ASSETS: Record<string, string> = {
  'data/nkrv.json': 'nkrv.json',
  'icons/icon-192.png': 'icon-192.png',
  'icons/icon-512.png': 'icon-512.png',
  'icons/maskable-512.png': 'maskable-512.png',
  'icons/apple-touch-icon.png': 'apple-touch-icon.png',
  'icons/favicon.png': 'favicon.png',
};
// 원어 자료 (필요할 때만 내려받음)
for (let i = 1; i <= 9; i++) ASSETS[`data/orig-${i}.json`] = `orig-${i}.json`;

function flatAssets(): Plugin {
  return {
    name: 'sk-flat-assets',
    // 개발 서버용
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = (req.url || '').split('?')[0].replace(/^\//, '');
        const file = ASSETS[url];
        if (!file) return next();
        res.setHeader('Content-Type', file.endsWith('.json') ? 'application/json' : 'image/png');
        fs.createReadStream(file).pipe(res);
      });
    },
    // 빌드용
    generateBundle() {
      for (const [out, src] of Object.entries(ASSETS)) {
        this.emitFile({ type: 'asset', fileName: out, source: fs.readFileSync(src) });
      }
      // 설정 화면에서 "최신 버전"을 확인할 때 쓰는 파일
      this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ version: pkg.version, buildTime: BUILD_TIME }) });
    },
  };
}

export default defineConfig({
  publicDir: false,
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_TIME__: JSON.stringify(BUILD_TIME),
  },
  server: { host: '0.0.0.0', allowedHosts: true },
  preview: { host: '0.0.0.0', allowedHosts: true },
  plugins: [
    react(),
    flatAssets(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        id: '/',
        name: 'SK-성경',
        short_name: 'SK-성경',
        description: 'SK-성경 · 개역개정 개인용 성경 (오프라인)',
        lang: 'ko',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#faf6ee',
        theme_color: '#7a2e2e',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,svg,json}'],
        globIgnores: ['version.json', 'data/orig-*.json'],
        runtimeCaching: [
          {
            // 원어 자료: 한 번 받으면 폰에 저장해 두고 인터넷 없이 사용
            urlPattern: ({ url }) => url.pathname.startsWith('/data/orig-'),
            handler: 'CacheFirst',
            options: { cacheName: 'sk-orig', expiration: { maxEntries: 12 } },
          },
        ],
        navigateFallbackDenylist: [/^\/api\//],
        cleanupOutdatedCaches: true,
        maximumFileSizeToCacheInBytes: 10 * 1024 * 1024,
        navigateFallback: '/index.html'
      }
    })
  ]
});
