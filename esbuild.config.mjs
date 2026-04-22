import * as esbuild from 'esbuild';

const watch = process.argv.includes('--watch');
const prod = process.env.NODE_ENV === 'production';

const ctx = await esbuild.context({
  entryPoints: ['src/extension.ts'],
  bundle: true,
  outfile: 'dist/extension.js',
  external: ['vscode'],
  platform: 'node',
  target: 'node18',
  format: 'cjs',
  sourcemap: !prod,
  minify: prod,
});

if (watch) {
  await ctx.watch();
  console.log('[esbuild] watching...');
} else {
  await ctx.rebuild();
  await ctx.dispose();
  console.log('[esbuild] built dist/extension.js');
}
