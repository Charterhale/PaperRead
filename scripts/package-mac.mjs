import { cp, mkdir, readFile, writeFile, rm, access } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { packager } from '@electron/packager';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const stage=path.join(root,'.package-stage');
await rm(stage,{recursive:true,force:true});await mkdir(stage,{recursive:true});
for(const folder of ['dist','server','electron'])await cp(path.join(root,folder),path.join(stage,folder),{recursive:true});
await mkdir(path.join(stage,'public'));await cp(path.join(root,'public/app-icon.png'),path.join(stage,'public/app-icon.png'));
const pkg=JSON.parse(await readFile(path.join(root,'package.json'),'utf8'));
await writeFile(path.join(stage,'package.json'),JSON.stringify({name:pkg.name,productName:'PaperRead',version:pkg.version,description:pkg.description,main:'electron/main.cjs',type:'module',dependencies:{express:pkg.dependencies.express}},null,2));
const visited=new Set();
async function copyDependency(name,from){
 const require=createRequire(path.join(from,'package.json'));let dir,info;
 for(const base of require.resolve.paths(name)||[]){try{const candidate=path.join(base,name);const data=JSON.parse(await readFile(path.join(candidate,'package.json'),'utf8'));if(data.name===name){dir=candidate;info=data;break;}}catch{}}
 if(!dir)throw new Error('Cannot locate '+name+' from '+from);
 if(visited.has(dir))return;visited.add(dir);const rel=path.relative(root,dir);if(!rel.startsWith('node_modules/'))throw new Error('Unexpected dependency path '+dir);
 await cp(dir,path.join(stage,rel),{recursive:true});for(const dep of Object.keys(info.dependencies||{}))await copyDependency(dep,dir);
}
await copyDependency('express',root);
const electronVersion=JSON.parse(await readFile(path.join(root,'node_modules/electron/package.json'),'utf8')).version;
let electronZipDir;try{await access(path.join(root,'.electron-download',`electron-v${electronVersion}-darwin-arm64.zip`));electronZipDir=path.join(root,'.electron-download');}catch{}
const outputs=await packager({dir:stage,name:'PaperRead',platform:'darwin',arch:'arm64',electronVersion,electronZipDir,appBundleId:'com.paperlens.reader',appCategoryType:'public.app-category.productivity',icon:path.join(root,'public/icon.icns'),asar:true,prune:false,out:path.join(root,'release'),overwrite:true});
for(const output of outputs)console.log(output);
