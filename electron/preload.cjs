const {contextBridge,ipcRenderer}=require('electron');
// No filesystem paths or generic IPC primitives are exposed to web content.
contextBridge.exposeInMainWorld('paperReadDesktop',Object.freeze({
 getCacheStatus:()=>ipcRenderer.invoke('paperread:cache-status'),
 clearCache:()=>ipcRenderer.invoke('paperread:cache-clear'),
 setCacheInterval:days=>ipcRenderer.invoke('paperread:cache-interval',days),
 onCacheChanged:callback=>{if(typeof callback!=='function')return()=>{};const listener=()=>callback();ipcRenderer.on('paperread:cache-changed',listener);return()=>ipcRenderer.removeListener('paperread:cache-changed',listener);},
 setTheme:theme=>ipcRenderer.invoke('paperread:set-theme',theme),
 takePdf:()=>ipcRenderer.invoke('paperread:take-pdf'),
 deferPdf:id=>ipcRenderer.invoke('paperread:defer-pdf',id),
 acknowledgePdf:id=>ipcRenderer.invoke('paperread:ack-pdf',id),
 onPdfAvailable:callback=>{if(typeof callback!=='function')return()=>{};const listener=()=>callback();ipcRenderer.on('paperread:pdf-available',listener);return()=>ipcRenderer.removeListener('paperread:pdf-available',listener);},
}));
