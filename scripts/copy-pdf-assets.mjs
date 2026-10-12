import { cp, mkdir, access } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const packageRoot = dirname(require.resolve('pdfjs-dist/package.json'));
const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const destination = join(projectRoot, 'public', 'pdfjs');

// Keep Chinese character maps, fallback fonts and image decoders local so
// reading PDFs never relies on a public CDN or network connection.
await mkdir(destination, { recursive: true });
for (const directory of ['cmaps', 'standard_fonts', 'wasm']) {
  const source = join(packageRoot, directory);
  await access(source);
  await cp(source, join(destination, directory), { recursive: true, force: true });
}
await cp(join(packageRoot, 'LICENSE'), join(destination, 'LICENSE'), { force: true });
console.log('PDF 字符映射、字体与图像解码资源已准备就绪。');
