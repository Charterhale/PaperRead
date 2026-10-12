import { useLayoutEffect, useRef, type TextareaHTMLAttributes } from 'react';

/** Text remains fully visible; the surrounding reader supplies the scrollbar. */
export default function AutoGrowTextarea(props:TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const ref=useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(()=>{
    const element=ref.current;if(!element)return;
    let width=0;
    const grow=()=>{
      if(!element.getBoundingClientRect().width)return;
      element.style.height='auto';
      const border=element.offsetHeight-element.clientHeight;
      element.style.height=Math.ceil(element.scrollHeight+border)+'px';
    };
    grow();
    const observer=new ResizeObserver(()=>{const next=element.getBoundingClientRect().width;if(next&&next!==width){width=next;grow();}});
    observer.observe(element);
    return()=>observer.disconnect();
  },[props.value]);
  return <textarea {...props} ref={ref} rows={props.rows||1} className={['auto-grow-textarea',props.className].filter(Boolean).join(' ')} style={{...props.style,overflow:'hidden',resize:'none'}}/>;
}
