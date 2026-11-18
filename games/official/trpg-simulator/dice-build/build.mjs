import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

// Source revision published as @drdreo/dice-box-threejs@1.1.0. Compiling from
// source shares one copy of Three.js between DiceBox and RoomEnvironment.
const revision = '84e497ae03e70b97c7fb96fa728872d908cf120b';
const here = fileURLToPath(new URL('.', import.meta.url));
const temp = await mkdtemp(join(tmpdir(), 'linshe-dice-'));
try {
  const archive = join(temp, 'dice-box.tar.gz');
  const response = await fetch(`https://codeload.github.com/drdreo/dice-box-threejs/tar.gz/${revision}`);
  if (!response.ok) throw new Error(`DiceBox source download failed (${response.status})`);
  await writeFile(archive, Buffer.from(await response.arrayBuffer()));
  execFileSync('tar', ['-xzf', archive, '-C', temp]);

  const upstream = join(temp, `dice-box-threejs-${revision}`);
  const output = join(here, '../web/vendor');
  await mkdir(output, { recursive: true });
  const { outputFiles: [bundle] } = await build({
    entryPoints: [join(here, 'dice-3d.js')],
    outfile: join(output, 'dice-3d.js'),
    nodePaths: [join(here, 'node_modules')],
    alias: { '@drdreo/dice-box-threejs': join(upstream, 'src/index.js') },
    bundle: true,
    write: false,
    minify: true,
    format: 'iife',
    target: 'es2022',
    legalComments: 'none',
    banner: { js: '/*! TRPG 3D dice. Rebuild with npm ci && npm run build in dice-build. See dice-3d.LICENSE.txt. */' }
  });
  await writeFile(bundle.path, bundle.text.replace(/[ \t]+$/gm, ''));
  const licenses = await Promise.all([
    readFile(join(upstream, 'LICENSE'), 'utf8'),
    readFile(join(here, 'node_modules/three/LICENSE'), 'utf8'),
    readFile(join(here, 'node_modules/cannon-es/LICENSE'), 'utf8')
  ]);
  const names = ['@drdreo/dice-box-threejs 1.1.0', 'Three.js 0.176.0', 'cannon-es 0.20.0'];
  await writeFile(join(output, 'dice-3d.LICENSE.txt'), licenses.map((license, i) => `${names[i]}\n\n${license.trim()}\n`).join('\n'));
} finally {
  await rm(temp, { recursive: true, force: true });
}
