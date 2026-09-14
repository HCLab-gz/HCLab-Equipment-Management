import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

function excludeDemoFromProduction(): Plugin {
  let dataMode = 'demo';
  return {
    name: 'exclude-demo-from-production',
    configResolved(config) {
      dataMode = config.env.VITE_DATA_MODE ?? 'demo';
    },
    generateBundle(_options, bundle) {
      if (dataMode === 'demo') return;
      for (const output of Object.values(bundle)) {
        if (
          output.type === 'chunk' &&
          output.moduleIds.some((id) =>
            ['/src/lib/demo.ts', '/src/data/seed.ts', '/src/data/questions.ts'].some((path) =>
              id.endsWith(path),
            ),
          )
        )
          this.error('正式构建不能包含演示数据、演示账号或前端答案题库');
      }
    },
  };
}

export default defineConfig({ plugins: [react(), excludeDemoFromProduction()], base: './' });
