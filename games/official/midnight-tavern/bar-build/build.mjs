import { build } from 'esbuild';
import { copyFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
await mkdir(new URL('../web/vendor/', import.meta.url), { recursive: true });
await build({
  absWorkingDir: here,
  entryPoints: ['bar-audio.js'],
  outfile: '../web/vendor/bar-audio.js',
  bundle: true,
  format: 'iife',
  globalName: 'TavernAudio',
  loader: { '.mp3': 'binary' },
  minify: true,
  target: 'es2022',
});
await build({
  absWorkingDir: here,
  entryPoints: ['bar-scene.js'],
  outfile: '../web/vendor/bar-scene.js',
  format: 'iife',
  bundle: true,
  loader: { '.webp': 'dataurl' },
  minify: true,
  target: 'es2022',
  legalComments: 'inline',
  banner: { js: '/*! Midnight Tavern • Three.js r176 • see three.LICENSE.txt */' },
});
await build({
  absWorkingDir: here,
  stdin: {
    contents: "export { BASE_VOLUME, DROP_VOLUME, MAX_DROPS, BASE_TIPSY, cocktailLook, primaryPotions, compoundPotions, intoxication, predictTipsy, canServeDrink, drinkEffects, recipeEffects, recipeName, potionDose, potionAttributes, garnishes } from '../server/index.mjs';",
    resolveDir: here,
  },
  // The host requires a single-file backend. Share the pure recipe data and appearance logic with the browser.
  plugins: [{
    name: 'omit-server-builtins',
    setup(build) {
      build.onResolve({filter:/^node:crypto$/}, ({path})=>({path,external:true,sideEffects:false}));
    },
  }],
  outfile: '../web/vendor/cocktail-look.js',
  format: 'iife',
  globalName: 'TavernAppearance',
  bundle: true,
  minify: true,
  target: 'es2022',
});
await copyFile(
  new URL('node_modules/three/LICENSE', import.meta.url),
  new URL('../web/vendor/three.LICENSE.txt', import.meta.url),
);
