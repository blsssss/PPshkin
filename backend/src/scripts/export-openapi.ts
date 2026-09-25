import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { OPENAPI_FILE, renderOpenApiYaml } from '../http/openapi-document.ts';

await writeFile(OPENAPI_FILE, await renderOpenApiYaml());
process.stdout.write(`written ${fileURLToPath(OPENAPI_FILE)}\n`);
