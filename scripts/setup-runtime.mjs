import {cp,mkdir,access,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const source=process.argv[2];
if(!source)throw Error('用法：node scripts/setup-runtime.mjs /绝对路径/standalone-python（Python 3.12，macOS arm64）');
const dest=path.join(root,'server/runtime/python');
await access(path.join(source,'bin/python3.12'));await access(path.join(source,'lib/python3.12'));
try{await access(dest);throw Error('运行环境已存在，请保留或手动更名后再准备；此脚本不会覆盖。');}catch(e){if(e.code!=='ENOENT')throw e;}
await mkdir(path.dirname(dest),{recursive:true});await cp(path.resolve(source),dest,{recursive:true,dereference:true});
execFileSync(path.join(dest,'bin/python3.12'),['-m','pip','install','--requirement',path.join(root,'scripts/markitdown-requirements.txt')],{stdio:'inherit',env:{...process.env,PYTHONNOUSERSITE:'1'}});
await cp(path.join(root,'server/pdf_to_md.py'),path.join(root,'server/runtime/pdf_to_md.py'));
await mkdir(path.join(root,'server/data'),{recursive:true});try{await access(path.join(root,'server/data/journals.json'));}catch{await writeFile(path.join(root,'server/data/journals.json'),JSON.stringify({source:{kind:'local',note:'使用者自行提供期刊资料'},journals:[]}));}
console.log('本地 PDF 转 Markdown 环境已准备。macOS OCR 会在桌面打包时编译。');
