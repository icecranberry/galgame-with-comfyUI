import nodemon from 'nodemon';
import { watchGameFiles } from '../scripts/lib/gameDevWatch.mjs';

process.env.LINSHE_GAME_DEV = '1';
nodemon({ script: 'app.js', watch: ['src', './app.js'], ext: 'js,mjs,json' });

const stopWatching = watchGameFiles(changes => {
  if (changes.some(change => change.backend)) nodemon.restart();
});

function stop() {
  stopWatching();
  nodemon.once('exit', () => process.exit());
  nodemon.emit('quit');
}

process.once('SIGINT', stop);
process.once('SIGTERM', stop);
