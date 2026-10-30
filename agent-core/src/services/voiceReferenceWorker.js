import { parentPort, workerData } from 'node:worker_threads';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { RubberBandInterface } from 'rubberband-wasm';
import { VoiceSampleEngine } from './voiceSampleEngine.js';
import { decodeReferenceWav, encodeReferenceWav, equalizeReference } from './voiceReferenceDsp.js';

try {
  const { samples, rate } = decodeReferenceWav(await readFile(workerData.file));
  const outputRate = 48000, parameters = workerData.parameters;
  const module = await WebAssembly.compile(await readFile(createRequire(import.meta.url).resolve('rubberband-wasm/dist/rubberband.wasm')));
  // Silence beyond the utterance prevents audition's loop from bleeding the
  // beginning into the end of a finite reference export.
  const padded = new Float32Array(samples.length + rate); padded.set(samples);
  const engine = new VoiceSampleEngine(await RubberBandInterface.initialize(module), outputRate, padded, rate, parameters);
  const output = new Float32Array(Math.round(samples.length / rate / parameters.speed * outputRate));
  try {
    engine.warmup();
    for (let at = 0; at < output.length; at += 128) engine.render(output.subarray(at, at + 128));
  } finally { engine.dispose(); }
  equalizeReference(output, outputRate, parameters);
  const wav = encodeReferenceWav(output, outputRate);
  parentPort.postMessage({ wav, duration: output.length / outputRate }, [wav.buffer]);
} catch (error) { parentPort.postMessage({ error: error.message }); }
