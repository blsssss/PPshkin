import { appendFile, readFile } from 'node:fs/promises';
import { createMaxApi } from '../integrations/max/api.ts';
import { createRecognition } from '../recognition/index.ts';
import { systemClock } from '../shared/clock.ts';
import { runSmokeCli } from '../smoke/cli.ts';

process.exitCode = await runSmokeCli(process.argv.slice(2), process.env, {
  fetch: (input, init) => fetch(input, init),
  createMaxApi,
  createRecognition,
  readFile: (file) => readFile(file),
  clock: systemClock,
  appendFile: (path, text) => appendFile(path, text),
  stdout: process.stdout,
  stderr: process.stderr,
});
