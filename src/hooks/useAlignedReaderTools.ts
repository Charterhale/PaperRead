import {useLayoutEffect,type RefObject} from 'react';

// Keep wrapped PDF tools and analysis tools on the same baseline after resizing.
export function useAlignedReaderTools(root:RefObject<HTMLDivElement|null>,enabled:boolean,tab:string){
 useLayoutEffect(()=>{
  const host=root.current;if(!enabled||!host)return;
  const bars=Array.from(host.querySelectorAll<HTMLElement>('.pdf-toolbar,.reader-section-switcher'));
  if(bars.length!==2)return;
  let frame=0;
  const sync=()=>{
   const heights=bars.map(bar=>{
    const bounds=Array.from(bar.children).map(child=>child.getBoundingClientRect()).filter(r=>r.height>0),style=getComputedStyle(bar);
    return bounds.length?Math.max(...bounds.map(r=>r.bottom))-Math.min(...bounds.map(r=>r.top))+parseFloat(style.paddingTop)+parseFloat(style.paddingBottom)+parseFloat(style.borderTopWidth)+parseFloat(style.borderBottomWidth):0;
   });
   const height=Math.ceil(Math.max(48,...heights))+'px';
   if(host.style.getPropertyValue('--reader-tools-height')!==height)host.style.setProperty('--reader-tools-height',height);
  };
  const observer=new ResizeObserver(()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(sync);});
  observer.observe(host);for(const bar of bars){observer.observe(bar);for(const child of bar.children)observer.observe(child);}
  sync();return()=>{cancelAnimationFrame(frame);observer.disconnect();host.style.removeProperty('--reader-tools-height');};
 },[enabled,root,tab]);
}
