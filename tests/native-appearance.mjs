import {_electron as electron,expect} from '@playwright/test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
const version=process.env.PAPERREAD_EXPECT_VERSION||'0.9.3';
const profile=await mkdtemp(path.join(tmpdir(),'paperread-appearance-'));
const application=await electron.launch({executablePath:'release/PaperRead-darwin-arm64/PaperRead.app/Contents/MacOS/PaperRead',args:['--user-data-dir='+profile],timeout:30000});
try{
 assert.equal(await realpath(await application.evaluate(({app})=>app.getPath('userData'))),await realpath(profile));
 assert.equal(await application.evaluate(({app})=>app.getVersion()),version);
 const page=await application.firstWindow();await page.waitForSelector('.library-home');
 const samples=[];
 for(const theme of ['dark','light','dark']){
  const current=await page.locator('html').getAttribute('data-theme');
  if(current!==theme)await page.locator('.home-sidebar-bottom').getByRole('button',{name:'切换明暗主题',exact:true}).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme',theme);
  await expect.poll(()=>application.evaluate(({nativeTheme})=>nativeTheme.themeSource)).toBe(theme);
  const native=await application.evaluate(({nativeTheme})=>({theme:nativeTheme.themeSource,dark:nativeTheme.shouldUseDarkColors}));
  assert.equal(native.dark,theme==='dark');samples.push(native);
 }
 const rejection=await page.evaluate(async()=>{try{await window.paperReadDesktop.setTheme('invalid');return false;}catch{return true;}});
 assert.equal(rejection,true);assert.equal(await application.evaluate(({nativeTheme})=>nativeTheme.themeSource),'dark');
 const flags=await application.evaluate(({BrowserWindow})=>{const p=BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences();return {sandbox:p.sandbox,contextIsolation:p.contextIsolation,nodeIntegration:p.nodeIntegration};});
 assert.deepEqual(flags,{sandbox:true,contextIsolation:true,nodeIntegration:false});
 await page.screenshot({path:'artifacts/v'+version+'-native-dark.png'});
 await writeFile('artifacts/v'+version+'-native-appearance.json',JSON.stringify({version,isolated:true,samples,invalidThemeRejected:true,flags},null,2));
 const exited=new Promise(resolve=>application.process().once('exit',resolve));
 await application.evaluate(({app})=>setImmediate(()=>app.quit()));
 let timer;await Promise.race([exited,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('App quit timeout')),8000);})]);clearTimeout(timer);
 console.log('Native appearance follows the selected app theme; invalid values rejected; secure isolated window preserved.');
}finally{await application.close();await rm(profile,{recursive:true,force:true});}
