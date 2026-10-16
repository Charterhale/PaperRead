import {readdir,rm,readFile,lstat} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
/** Operates only on the generated package stage, never the development runtime. */
export async function compactRuntime(stage){
 const runtime=path.join(stage,'server/runtime/python');let removedBytes=0,deduplicated=0;
 async function bytes(target){try{const s=await lstat(target);if(s.isSymbolicLink())return 0;if(!s.isDirectory())return s.size;return (await Promise.all((await readdir(target)).map(n=>bytes(path.join(target,n))))).reduce((a,b)=>a+b,0);}catch(e){if(e.code==='ENOENT')return 0;throw e;}}
 async function remove(relative){const target=path.join(runtime,relative);removedBytes+=await bytes(target);await rm(target,{recursive:true,force:true});}
 // Build/install tooling is not used by PaperRead's packaged PDF/MD workflows.
 for(const rel of ['include','share','lib/pkgconfig','lib/python3.12/config-3.12-darwin','lib/python3.12/ensurepip','lib/python3.12/idlelib','lib/python3.12/turtledemo','lib/python3.12/site-packages/pip','bin/2to3','bin/2to3-3.12','bin/idle3','bin/idle3.12','bin/pip','bin/pip3','bin/pip3.12','bin/pydoc3','bin/pydoc3.12','bin/python3-config','bin/python3.12-config'])await remove(rel);
 const hash=buffer=>createHash('sha256').update(buffer).digest('hex'),canonical=path.join(runtime,'bin/python3.12'),digest=hash(await readFile(canonical));
 for(const name of ['python','python3']){const target=path.join(runtime,'bin',name);if(!(await lstat(target)).isSymbolicLink()&&hash(await readFile(target))===digest){removedBytes+=(await lstat(target)).size;await rm(target);deduplicated++;}}
 async function clean(dir){for(const entry of await readdir(dir,{withFileTypes:true})){const target=path.join(dir,entry.name);if(entry.isSymbolicLink())continue;if(entry.name==='__pycache__'||entry.name.endsWith('.pyc')||entry.name==='.DS_Store'){removedBytes+=await bytes(target);await rm(target,{recursive:true,force:true});}else if(entry.isDirectory())await clean(target);}}
 await clean(runtime);return {removedBytes,deduplicated};
}
