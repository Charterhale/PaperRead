import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import './TooltipLayer.css';

export default function TooltipLayer(){
  const id=useId(),tip=useRef<HTMLDivElement>(null);
  const [hint,setHint]=useState<{label:string;detail:string;rect:DOMRect}|null>(null),[position,setPosition]=useState<{left:number;top:number}|null>(null);
  useEffect(()=>{
    let active:HTMLElement|null=null,timer:number|undefined,previous:string|null=null;
    const clear=()=>{window.clearTimeout(timer);if(active){if(previous===null)active.removeAttribute('aria-describedby');else active.setAttribute('aria-describedby',previous);}active=null;previous=null;setHint(null);setPosition(null);};
    const show=(target:EventTarget|null)=>{
      const button=target instanceof Element?target.closest<HTMLElement>('button[title],button[aria-label],a[title],input[title]'):null;
      if(!button||!button.closest('.app,.pdf-viewer')){clear();return;}
      if(button===active)return;
      clear();active=button;const label=button.dataset.tooltip||button.getAttribute('title')||button.getAttribute('aria-label');if(!label)return;
      timer=window.setTimeout(()=>{if(active!==button||!button.isConnected)return;previous=button.getAttribute('aria-describedby');button.setAttribute('aria-describedby',[previous,id].filter(Boolean).join(' '));setHint({label,detail:button.dataset.help||'',rect:button.getBoundingClientRect()});},220);
    };
    const enter=(e:Event)=>show(e.target);
    const leave=(e:PointerEvent)=>{if(active&&e.relatedTarget instanceof Node&&active.contains(e.relatedTarget))return;clear();};
    const keyboard=(e:KeyboardEvent)=>{if(e.key==='Escape')clear();};
    document.addEventListener('pointerover',enter);document.addEventListener('pointerout',leave);document.addEventListener('focusin',enter);document.addEventListener('focusout',clear);document.addEventListener('pointerdown',clear,true);document.addEventListener('scroll',clear,true);window.addEventListener('resize',clear);window.addEventListener('keydown',keyboard);
    return()=>{clear();document.removeEventListener('pointerover',enter);document.removeEventListener('pointerout',leave);document.removeEventListener('focusin',enter);document.removeEventListener('focusout',clear);document.removeEventListener('pointerdown',clear,true);document.removeEventListener('scroll',clear,true);window.removeEventListener('resize',clear);window.removeEventListener('keydown',keyboard);};
  },[id]);
  useLayoutEffect(()=>{if(!hint||!tip.current)return;const {width,height}=tip.current.getBoundingClientRect();setPosition({left:Math.max(8,Math.min(window.innerWidth-width-8,hint.rect.left+hint.rect.width/2-width/2)),top:hint.rect.bottom+height+12<window.innerHeight?hint.rect.bottom+8:Math.max(8,hint.rect.top-height-8)});},[hint]);
  return hint?createPortal(<div ref={tip} id={id} role="tooltip" className="tool-hover-hint" style={{left:position?.left||0,top:position?.top||0,visibility:position?'visible':'hidden'}}><strong>{hint.label}</strong>{hint.detail&&<span>{hint.detail}</span>}</div>,document.body):null;
}
