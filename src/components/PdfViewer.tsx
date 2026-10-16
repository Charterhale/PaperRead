import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { TextLayer } from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
import { ArrowDown, ArrowUp, Bookmark, Check, ChevronDown, ChevronLeft, ChevronRight, Crop, Download, FileText, Hand, Highlighter, ListChecks, LoaderCircle, Maximize2, Minus, MousePointer2, Plus, Printer, RotateCw, Search, TextSelect, X } from 'lucide-react';
import { openPdf, pdfErrorMessage, renderDocumentPage } from '../lib/pdf';
import type { CropRegion, PdfCrop, PdfSelection, PdfViewerHandle, PdfHighlight, PdfViewState, PdfTarget } from '../types';
import './PdfViewer.css';
import { rotateRegion, validRegion, matchingTextRange } from '../lib/preciseNavigation';
import AnnotationsManager from './AnnotationsManager';

type Highlight = PdfHighlight;
type PageSize = { width: number; height: number };
type CropDraft = { page: number; region: CropRegion };
type ZoomAnchor = { page: number; x: number; y: number; clientX: number; clientY: number };
const highlightColors = [{ color: '#ffd735', name: '黄色' }, { color: '#69d99d', name: '绿色' }, { color: '#67b6ff', name: '蓝色' }, { color: '#bb93fa', name: '紫色' }, { color: '#ff91b4', name: '粉色' }];
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function unrotateCrop(region: CropRegion, rotation: number): CropRegion {
  const { x, y, width, height } = region;
  if (rotation === 90) return { x: y, y: 1 - x - width, width: height, height: width };
  if (rotation === 180) return { x: 1 - x - width, y: 1 - y - height, width, height };
  if (rotation === 270) return { x: 1 - y - height, y: x, width: height, height: width };
  return region;
}
type PdfViewerProps = {
  data: Uint8Array | null;
  page: number;
  onPageChange: (page: number) => void;
  onSelection?: (selection: PdfSelection) => void;
  onReady?: (count: number) => void;
  onAnnotationKey?:(key:string)=>void;
  showFigureTools?: boolean;
  onCrop?: (crop: PdfCrop) => void;
  missingPdf?:boolean;
  onCropCancel?:()=>void;
  fileName?: string;
  onBeforeNavigate?:()=>void;
  onAppendHighlights?:(items:PdfHighlight[])=>Promise<boolean>;
};

export function PdfPage({ doc, number, size, scale, rotation, root, query, highlights, crop, target, retain }: {
  doc: PDFDocumentProxy; number: number; size: PageSize; scale: number; rotation: number;
  retain: boolean; root: HTMLDivElement | null; query: string; highlights: Highlight[]; crop?: CropRegion; target?:CropRegion[];
}) {
  const shell = useRef<HTMLDivElement>(null);
  const drawing = useRef<HTMLDivElement>(null);
  const textContainer = useRef<HTMLDivElement>(null);
  const [nearby, setNearby] = useState(number === 1);
  const [painted, setPainted] = useState(false);
  const [error, setError] = useState('');
  const [renderVersion, setRenderVersion] = useState(0);
  const [textView, setTextView] = useState('');
  const [retry, setRetry] = useState(0);
  const turned = rotation % 180 !== 0;
  const width = (turned ? size.height : size.width) * scale;
  const height = (turned ? size.width : size.height) * scale;

  useEffect(() => {
    if (!shell.current || !root) return;
    const observer = new IntersectionObserver(entries => setNearby(entries[0].isIntersecting), { root, rootMargin: '1000px 0px' });
    observer.observe(shell.current);
    return () => observer.disconnect();
  }, [root]);

  useEffect(() => {
    const canvasContainer = drawing.current, textHost = textContainer.current;
    if (!canvasContainer || !textHost) return;
    const release = (canvas: HTMLCanvasElement) => { canvas.width = 0; canvas.height = 0; };
    if (!nearby) return;
    let cancelled = false;
    let renderTask: RenderTask | undefined;
    let textLayer: TextLayer | undefined;
    const canvas = window.document.createElement('canvas');
    // Keep the last complete bitmap visible while the page geometry changes.
    // Replacement graphics are prepared offscreen; text is independent.
    const textElement = window.document.createElement('div');
    textElement.className = 'pdf-text-layer textLayer';
    setError('');
    const render = async () => {
      try {
        const page = await doc.getPage(number);
        if (cancelled) return;
        const viewport = page.getViewport({ scale, rotation: (page.rotate + rotation) % 360 });
        // Bound backing-store allocation even at 500% zoom on Retina displays.
        const density = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(6_000_000 / (viewport.width * viewport.height)), 8192 / Math.max(viewport.width, viewport.height));
        canvas.width = Math.ceil(viewport.width * density);
        canvas.height = Math.ceil(viewport.height * density);
        canvas.style.width = '100%'; canvas.style.height = '100%';
        canvas.setAttribute('aria-label', `PDF 第 ${number} 页`);
        renderTask = page.render({ canvas, canvasContext: canvas.getContext('2d')!, viewport, transform: density !== 1 ? [density, 0, 0, density, 0, 0] : undefined });
        await renderTask.promise;
        if (cancelled) return;
        // Publish the bitmap immediately. A slow or broken text layer must not
        // hide an otherwise readable scan or figure page.
        const previous = Array.from(canvasContainer.querySelectorAll('canvas'));
        canvasContainer.replaceChildren(canvas); previous.forEach(release);
        setPainted(true);
        try {
          const content = await page.getTextContent();
          if (cancelled) return;
          textElement.style.setProperty('--scale-factor', String(scale));
          textElement.style.setProperty('--total-scale-factor', String(scale * viewport.userUnit));
          textLayer = new TextLayer({ textContentSource: content, container: textElement, viewport });
          await textLayer.render();
          if (cancelled) return;
          textHost.replaceChildren(textElement);
          setTextView(`${scale}/${rotation}`);
          setRenderVersion(value => value + 1);
        } catch (cause) {
          if (!cancelled) { textHost.replaceChildren(); setTextView(''); console.warn('PDF text layer unavailable', number, cause); }
        }
      } catch (cause) {
        if (!cancelled && !(cause instanceof Error && cause.name === 'RenderingCancelledException')) setError('页面未能显示');
      } finally {
        if (cancelled && !canvas.isConnected) release(canvas);
      }
    };
    // Scaling the existing bitmap is immediate; high-resolution painting only
    // starts once rapid wheel events settle, instead of restarting every tick.
    const timer = window.setTimeout(() => { void render(); }, canvasContainer.childElementCount ? 100 : 0);
    return () => {
      cancelled = true; window.clearTimeout(timer); renderTask?.cancel(); textLayer?.cancel();
    };
  }, [doc, number, scale, rotation, nearby, retry]);

  useEffect(() => {
    if (nearby || retain) return;
    drawing.current?.querySelectorAll('canvas').forEach(canvas => { canvas.width = 0; canvas.height = 0; });
    drawing.current?.replaceChildren(); textContainer.current?.replaceChildren();
    setPainted(false); setTextView('');
  }, [nearby, retain]);

  useEffect(() => {
    const canvasContainer = drawing.current;
    return () => { canvasContainer?.querySelectorAll('canvas').forEach(canvas => { canvas.width = 0; canvas.height = 0; }); };
  }, [doc, number]);

  useEffect(() => {
    const term = query.trim().toLocaleLowerCase();
    textContainer.current?.querySelectorAll('span').forEach(span => {
      span.classList.toggle('pdf-search-match', !!term && !!span.textContent?.toLocaleLowerCase().includes(term));
    });
  }, [query, renderVersion]);

  return <div className={`pdf-page-wrap ${crop ? 'pdf-crop-active' : ''}`} data-pdf-page={number} ref={shell} style={{ width, height }}>
    <div className="pdf-page-drawing" ref={drawing} />
    {nearby && !painted && !error && <div className="pdf-page-loading"><LoaderCircle size={19} className="pdf-spin" /><span>载入第 {number} 页</span></div>}
    {!nearby && !painted && <div className="pdf-page-placeholder">{number}</div>}
    {error && <div className="pdf-page-loading pdf-page-error">{error}<button className="subtle-button" onClick={() => setRetry(value => value + 1)}>重试</button></div>}
    <div className="pdf-text-holder" ref={textContainer} style={{ visibility: textView === `${scale}/${rotation}` ? 'visible' : 'hidden' }} />
    <div className="pdf-highlights" aria-hidden="true">{highlights.filter(item => item.rotation === rotation).flatMap(item => item.rectangles.map((rect, index) => <div key={`${item.id}-${index}`} className="pdf-highlight-rect" style={{ backgroundColor: item.color || '#ffd735', left: `${rect.x * 100}%`, top: `${rect.y * 100}%`, width: `${rect.width * 100}%`, height: `${rect.height * 100}%` }} />))}</div>
    {crop && <div className="pdf-crop-region" style={{ left: `${crop.x * 100}%`, top: `${crop.y * 100}%`, width: `${crop.width * 100}%`, height: `${crop.height * 100}%` }}><span>松开鼠标，精读此图</span></div>}
    {target?.map((r,i)=><div key={i} className="pdf-target-region" style={{left:r.x*100+'%',top:r.y*100+'%',width:r.width*100+'%',height:r.height*100+'%'}}/>)}
    <span className="pdf-page-corner">{number}</span>
  </div>;
}

const PdfViewer = forwardRef<PdfViewerHandle, PdfViewerProps>(function PdfViewer({ showFigureTools=true, missingPdf=false, data, page: activePage, onPageChange, onReady, onAnnotationKey, onSelection, onCrop, onCropCancel, onBeforeNavigate, onAppendHighlights, fileName = 'paper.pdf' }, ref) {
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [sizes, setSizes] = useState<PageSize[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [zoom, setZoom] = useState(1);
  const [fit, setFit] = useState(true);
  const [rotation, setRotation] = useState(0);
  const [viewportWidth, setViewportWidth] = useState(500);
  const [scrollRoot, setScrollRoot] = useState<HTMLDivElement | null>(null);
  const [pageInput, setPageInput] = useState(String(activePage));
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState<{ page: number; count: number }[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchIndex, setSearchIndex] = useState(0);
  const [highlighter, setHighlighter] = useState(false);
  const [highlightColor, setHighlightColor] = useState(() => { try { return localStorage.getItem('paperlens-highlight-color') || '#ffd735'; } catch { return '#ffd735'; } });
  const [colorsOpen, setColorsOpen] = useState(false);
  const [mode, setMode] = useState<'pointer' | 'hand' | 'text'>(()=>{try{const saved=localStorage.getItem('paperlens-pdf-mode');return saved==='hand'||saved==='text'?saved:'pointer';}catch{return 'pointer';}});
  const [spacePan, setSpacePan] = useState(false);
  const [panning, setPanning] = useState(false);
  const [cropping, setCropping] = useState(false);
  const [cropBusy, setCropBusy] = useState(false);
  const [cropDraft, setCropDraft] = useState<CropDraft | null>(null);
  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const [bookmarks, setBookmarks] = useState<number[]>([]);
  const [bookmarksOpen, setBookmarksOpen] = useState(false);
  const [annotationsOpen,setAnnotationsOpen]=useState(false);const pendingRestore=useRef<PdfViewState|null>(null);
  const [target,setTarget]=useState<{page:number;regions:CropRegion[]}|null>(null);
  const targetSequence=useRef(0),dataRef=useRef(data),annotationKeyRef=useRef(onAnnotationKey);dataRef.current=data;annotationKeyRef.current=onAnnotationKey;
  useEffect(()=>{if(!target)return;const timer=setTimeout(()=>setTarget(null),12000);return()=>clearTimeout(timer);},[target]);
  const [notice, setNotice] = useState('');
  const currentPage = useRef(activePage);
  const onReadyRef = useRef(onReady);
  const onPageChangeRef = useRef(onPageChange);
  const searchCache = useRef<string[] | null>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const zoomAnchor = useRef<ZoomAnchor | null>(null);
  const wheelFrame = useRef<number | null>(null);
  const pendingWheel = useRef<{ scale: number; anchor: ZoomAnchor | null } | null>(null);
  const wheelGesture = useRef<{ anchor: ZoomAnchor | null; x: number; y: number; time: number } | null>(null);
  const requestedScale = useRef(1);
  const displayedView = useRef({ scale: 1, fit: true });
  const panDrag = useRef<{ pointer: number; x: number; y: number; left: number; top: number } | null>(null);
  const cropDrag = useRef<{ pointer: number; page: number; element: HTMLDivElement; x: number; y: number } | null>(null);
  const cropSequence = useRef(0);
  const gestureSuppressed = useRef(false);
  onReadyRef.current = onReady;
  onPageChangeRef.current = onPageChange;
  const turned = rotation % 180 !== 0;
  const maxPageWidth = sizes.length ? Math.max(...sizes.map(size => turned ? size.height : size.width)) : 612;
  const fitScale = Math.max(0.2, (viewportWidth - 48) / maxPageWidth);
  const scale = fit ? fitScale : zoom;
  displayedView.current = { scale, fit };
  useLayoutEffect(() => { if (!pendingWheel.current) requestedScale.current = scale; }, [scale]);

  const stopWheelZoom = useCallback(() => {
    if (wheelFrame.current !== null) cancelAnimationFrame(wheelFrame.current);
    wheelFrame.current = null; pendingWheel.current = null; wheelGesture.current = null;
    zoomAnchor.current = null; requestedScale.current = displayedView.current.scale;
  }, []);

  useEffect(()=>{const sync=()=>{const mode=localStorage.getItem('paperlens-pdf-mode');if(mode==='pointer'||mode==='hand'||mode==='text')setMode(mode);};window.addEventListener('paperlens-reading-preferences',sync);return()=>window.removeEventListener('paperlens-reading-preferences',sync);},[]);
  useEffect(()=>{stopWheelZoom();try{localStorage.setItem('paperlens-pdf-mode',mode);}catch{}},[mode,stopWheelZoom]);

  useEffect(() => {
    targetSequence.current++;setTarget(null);setAnnotationsOpen(false);setBookmarksOpen(false);setDoc(null); setSizes([]); setError(''); setQuery(''); setMatches([]); setZoom(1); setFit(true); setRotation(0); setHighlights([]); setBookmarks([]); searchCache.current = null;
    if (wheelFrame.current !== null) cancelAnimationFrame(wheelFrame.current);
    wheelFrame.current = null; pendingWheel.current = null; wheelGesture.current = null; requestedScale.current = 1;
    setCropping(false); setCropDraft(null); setCropBusy(false); cropSequence.current += 1; zoomAnchor.current = null; panDrag.current = null; cropDrag.current = null; setPanning(false);
    if (!data) { setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    const task = openPdf(data);
    void (async () => {
      try {
        const document = await task.promise;
        const pageSizes: PageSize[] = new Array(document.numPages);
        let next = 1;
        await Promise.all(Array.from({ length: Math.min(4, document.numPages) }, async () => {
          while (!cancelled && next <= document.numPages) {
            const index = next++;
            const p = await document.getPage(index);
            const viewport = p.getViewport({ scale: 1 });
            pageSizes[index - 1] = { width: viewport.width, height: viewport.height };
          }
        }));
        if (cancelled) return;
        setDoc(document); setSizes(pageSizes); setLoading(false);
        // Force the controlled page effect to restore the new paper's position,
        // including page 1 when the previous paper was scrolled further down.
        currentPage.current = 0;
        const storageKey = `paperlens-pdf-${document.fingerprints[0]}`;
        annotationKeyRef.current?.(storageKey);
        try {
          const stored = JSON.parse(localStorage.getItem(storageKey) || '{}');
          setBookmarks(Array.isArray(stored.bookmarks) ? stored.bookmarks.filter((value: unknown) => typeof value === 'number' && value >= 1 && value <= document.numPages) : []);
          setHighlights(Array.isArray(stored.highlights) ? stored.highlights : []);
        } catch { /* Corrupt local annotations do not block opening the source PDF. */ }
        onReadyRef.current?.(document.numPages);
      } catch (cause) { if (!cancelled) { setError(pdfErrorMessage(cause)); setLoading(false); } }
    })();
    return () => { cancelled = true; void task.destroy().catch(() => undefined); };
  }, [data]);

  useEffect(() => {
    if (!doc) return;
    try { localStorage.setItem(`paperlens-pdf-${doc.fingerprints[0]}`, JSON.stringify({ bookmarks, highlights })); } catch { setNotice('浏览器存储已满，新的标注暂时仅保留在本次阅读中。'); }
  }, [bookmarks, highlights, doc]);

  useEffect(() => {
    if (!scrollRoot) return;
    let width=scrollRoot.clientWidth;
    const observer = new ResizeObserver(entries => {
      const next=entries[0].contentRect.width;
      if(Math.abs(next-width)>.5&&displayedView.current.fit&&!pendingRestore.current&&!pendingWheel.current){
        const box=scrollRoot.getBoundingClientRect();
        zoomAnchor.current=captureAnchor(box.left+box.width/2,box.top+Math.min(40,box.height/4));
      }
      width=next;setViewportWidth(next);
    });
    observer.observe(scrollRoot);
    return () => observer.disconnect();
  }, [scrollRoot]);

  useEffect(() => {
    try { localStorage.setItem('paperlens-highlight-color', highlightColor); } catch { /* A color preference should never interrupt reading. */ }
  }, [highlightColor]);

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { onCropCancel?.();cropSequence.current += 1; setCropping(false); setCropDraft(null); setCropBusy(false); cropDrag.current = null; setColorsOpen(false); }
      if (event.code !== 'Space' || (event.target instanceof HTMLElement && (event.target.closest('input,textarea,select,[contenteditable="true"]') || (event.target.closest('button') && !event.target.closest('.pdf-viewer'))))) return;
      event.preventDefault(); setSpacePan(true);
    };
    const clear = () => { setSpacePan(false); setPanning(false); panDrag.current = null; };
    const keyup = (event: KeyboardEvent) => { if (event.code === 'Space') clear(); };
    window.addEventListener('keydown', keydown); window.addEventListener('keyup', keyup); window.addEventListener('blur', clear);
    return () => { window.removeEventListener('keydown', keydown); window.removeEventListener('keyup', keyup); window.removeEventListener('blur', clear); };
  }, []);

  const captureAnchor = useCallback((clientX?: number, clientY?: number): ZoomAnchor | null => {
    if (!scrollRoot) return null;
    const rootBox = scrollRoot.getBoundingClientRect();
    const x = clientX ?? rootBox.left + scrollRoot.clientWidth / 2;
    const y = clientY ?? rootBox.top + scrollRoot.clientHeight / 2;
    const pages = Array.from(scrollRoot.querySelectorAll<HTMLDivElement>('[data-pdf-page]'));
    const target = pages.find(element => { const box = element.getBoundingClientRect(); return y >= box.top && y <= box.bottom; }) || pages.reduce<HTMLDivElement | null>((best, element) => !best || Math.abs(element.getBoundingClientRect().top - y) < Math.abs(best.getBoundingClientRect().top - y) ? element : best, null);
    if (!target) return null;
    const box = target.getBoundingClientRect();
    return { page: Number(target.dataset.pdfPage), x: (x - box.left) / box.width, y: (y - box.top) / box.height, clientX: x, clientY: y };
  }, [scrollRoot]);

  const zoomAt = useCallback((next: number, clientX?: number, clientY?: number, fitWidth = false, fixedAnchor?: ZoomAnchor | null) => {
    if (!scrollRoot || !doc || cropDrag.current || panDrag.current) return;
    if (wheelFrame.current !== null) cancelAnimationFrame(wheelFrame.current);
    wheelFrame.current = null; pendingWheel.current = null;
    if (fixedAnchor === undefined) wheelGesture.current = null;
    const nextScale = clamp(next, 0.2, 5);
    requestedScale.current = nextScale;
    if (Math.abs(nextScale - displayedView.current.scale) < 0.000001 && fitWidth === displayedView.current.fit) return;
    zoomAnchor.current = fixedAnchor === undefined ? captureAnchor(clientX, clientY) : fixedAnchor;
    setZoom(nextScale); setFit(fitWidth);
  }, [scrollRoot, doc, captureAnchor]);

  useLayoutEffect(() => {
    const anchor = zoomAnchor.current;
    if (!anchor || !scrollRoot) return;
    const element = scrollRoot.querySelector<HTMLDivElement>(`[data-pdf-page="${anchor.page}"]`);
    if (element) {
      const box = element.getBoundingClientRect();
      const left = scrollRoot.scrollLeft + box.left + box.width * anchor.x - anchor.clientX;
      const top = scrollRoot.scrollTop + box.top + box.height * anchor.y - anchor.clientY;
      scrollRoot.scrollLeft = left; scrollRoot.scrollTop = top;
      // At a real scroll boundary the cursor point cannot stay fixed. Rebase
      // only there, so reversing direction never springs to an old position.
      if ((left < -1 || left > scrollRoot.scrollWidth - scrollRoot.clientWidth + 1 || top < -1 || top > scrollRoot.scrollHeight - scrollRoot.clientHeight + 1) && wheelGesture.current) {
        wheelGesture.current.anchor = captureAnchor(anchor.clientX, anchor.clientY);
      }
    }
    zoomAnchor.current = null;
  }, [scale, fit, scrollRoot, captureAnchor]);

  useEffect(() => {
    if (!scrollRoot || !doc) return;
    const wheel = (event: WheelEvent) => {
      if (cropDrag.current || panDrag.current) {event.preventDefault();return;}
      if(!event.ctrlKey&&!event.metaKey&&(mode!=='hand'||cropping)){stopWheelZoom();return;}
      event.preventDefault();
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? scrollRoot.clientHeight : 1);
      if (!delta) return;
      const time = performance.now(), previous = wheelGesture.current;
      // Keep one exact PDF coordinate through a gesture. Recapturing it from
      // rounded scroll offsets at every tick accumulates visible sideways drift.
      if (!previous || time - previous.time > 180 || Math.abs(event.clientX - previous.x) > 1 || Math.abs(event.clientY - previous.y) > 1) {
        wheelGesture.current = { anchor: captureAnchor(event.clientX, event.clientY), x: event.clientX, y: event.clientY, time };
      } else previous.time = time;
      const next = clamp((pendingWheel.current?.scale ?? requestedScale.current) * Math.exp(-clamp(delta, -300, 300) * (event.ctrlKey ? 0.012 : 0.0025)), 0.2, 5);
      requestedScale.current = next;
      pendingWheel.current = { scale: next, anchor: wheelGesture.current!.anchor };
      if (wheelFrame.current === null) wheelFrame.current = requestAnimationFrame(() => {
        wheelFrame.current = null;
        const pending = pendingWheel.current;
        pendingWheel.current = null;
        if (pending) zoomAt(pending.scale, undefined, undefined, false, pending.anchor);
      });
    };
    scrollRoot.addEventListener('wheel', wheel, { passive: false });
    return () => {
      scrollRoot.removeEventListener('wheel', wheel);
      if (wheelFrame.current !== null) cancelAnimationFrame(wheelFrame.current);
      wheelFrame.current = null; pendingWheel.current = null; wheelGesture.current = null;
    };
  }, [scrollRoot, doc, zoomAt, captureAnchor, mode, cropping, stopWheelZoom]);

  useEffect(() => { setPageInput(String(activePage)); }, [activePage]);
  useEffect(() => { if (!notice) return; const timer = window.setTimeout(() => setNotice(''), 3800); return () => window.clearTimeout(timer); }, [notice]);
  useEffect(() => { if (searchOpen) searchInput.current?.focus(); }, [searchOpen]);

  const goToPage = useCallback((number: number) => {
    if (!doc || !scrollRoot) return;
    stopWheelZoom();targetSequence.current++;
    const target = Math.min(doc.numPages, Math.max(1, Math.round(number)));
    if (!Number.isFinite(target)) return;
    currentPage.current = target;
    const element = scrollRoot.querySelector<HTMLDivElement>(`[data-pdf-page="${target}"]`);
    if (element) {
      // Rectangles remain correct if the scroll container gains another wrapper;
      // offsetTop would otherwise be relative to the nearest positioned ancestor.
      const top = scrollRoot.scrollTop + element.getBoundingClientRect().top - scrollRoot.getBoundingClientRect().top - 22;
      scrollRoot.scrollTo({ top, behavior: 'auto' });
    }
    setPageInput(String(target));
    onPageChangeRef.current(target);
  }, [doc, scrollRoot, stopWheelZoom]);

  useEffect(() => { if (doc && activePage !== currentPage.current) goToPage(activePage); }, [activePage, goToPage, doc]);

  const restoreViewState=useCallback((state:PdfViewState)=>{if(!doc)return;stopWheelZoom();currentPage.current=clamp(state.page,1,doc.numPages);pendingRestore.current={...state,page:currentPage.current};setZoom(clamp(state.scale,.2,5));setFit(state.fit);setRotation([0,90,180,270].includes(state.rotation)?state.rotation:0);onPageChangeRef.current(currentPage.current);setPageInput(String(currentPage.current));requestAnimationFrame(()=>{if(pendingRestore.current&&scrollRoot){scrollRoot.scrollTop=pendingRestore.current.scrollTop;scrollRoot.scrollLeft=pendingRestore.current.scrollLeft;pendingRestore.current=null;}});},[doc,scrollRoot,stopWheelZoom]);
  useLayoutEffect(()=>{const state=pendingRestore.current;if(state&&scrollRoot){scrollRoot.scrollTop=state.scrollTop;scrollRoot.scrollLeft=state.scrollLeft;pendingRestore.current=null;}},[scale,fit,rotation,scrollRoot]);

  const startCrop = useCallback((number?: number) => {
    if (!doc || !onCrop) return;
    cropSequence.current += 1; setCropBusy(false); cropDrag.current = null;
    if (number) goToPage(number);
    window.getSelection()?.removeAllRanges();
    setCropping(true); setCropDraft(null); setHighlighter(false); setColorsOpen(false);
    setNotice('在 PDF 上拖出矩形，框选一个子图。按 Esc 取消。');
  }, [doc, onCrop, goToPage]);

  const revealTarget=useCallback(async(value:PdfTarget)=>{
    if(!doc||!scrollRoot)return false;
    goToPage(value.page);setTarget(null);
    const sequence=++targetSequence.current,source=dataRef.current;
    let regions:CropRegion[]=[];
    if(value.region&&validRegion(value.region))regions=[rotateRegion(value.region,rotation)];
    else if(value.text){
      // Wait for the lazily rendered text layer; never infer coordinates from a page number.
      for(let attempt=0;attempt<40;attempt++){
        if(sequence!==targetSequence.current||source!==dataRef.current)return false;
        const shell=scrollRoot.querySelector<HTMLElement>(`[data-pdf-page="${value.page}"]`);
        const spans=Array.from(shell?.querySelectorAll<HTMLElement>('.pdf-text-layer span')||[]);
        const indexes=matchingTextRange(spans.map(n=>n.textContent||''),value.text);
        if(indexes&&shell){const box=shell.getBoundingClientRect();regions=indexes.map(i=>{const r=spans[i].getBoundingClientRect();return {x:(r.left-box.left)/box.width,y:(r.top-box.top)/box.height,width:r.width/box.width,height:r.height/box.height};}).filter(r=>r.width>0&&r.height>0);break;}
        if(spans.length)break;
        await new Promise(resolve=>setTimeout(resolve,75));
      }
    }
    if(sequence!==targetSequence.current||source!==dataRef.current)return false;
    const shell=scrollRoot.querySelector<HTMLElement>(`[data-pdf-page="${value.page}"]`);
    if(!shell||!regions.length){setNotice('已定位到原文页面；此处暂无可匹配的文字或裁图范围。');return false;}
    setTarget({page:value.page,regions:regions.map(r=>rotateRegion(r,(360-rotation)%360))});
    const box=shell.getBoundingClientRect(),root=scrollRoot.getBoundingClientRect(),r=regions[0];
    scrollRoot.scrollTo({top:scrollRoot.scrollTop+box.top-root.top+box.height*r.y-scrollRoot.clientHeight*.24,left:scrollRoot.scrollLeft+box.left-root.left+box.width*(r.x+r.width/2)-scrollRoot.clientWidth/2,behavior:'instant'});
    return true;
  },[doc,scrollRoot,goToPage,rotation]);
  useImperativeHandle(ref, () => ({
    revealTarget,
    goToPage,
    startCrop,
    getViewState:()=>({page:currentPage.current||activePage,scale,fit,rotation,scrollTop:scrollRoot?.scrollTop||0,scrollLeft:scrollRoot?.scrollLeft||0}),
    restoreViewState,
    getPageImage: async (number: number) => {
      if (!doc) throw new Error('请先打开一篇 PDF。');
      return renderDocumentPage(doc, number);
    },
  }), [goToPage, startCrop, doc, activePage, scale, fit, rotation, scrollRoot, restoreViewState, revealTarget]);

  useEffect(() => {
    if (!doc || !query.trim()) { setMatches([]); setSearching(false); return; }
    let cancelled = false;
    setSearching(true);
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          let texts = searchCache.current;
          if (!texts) {
            texts = [];
            for (let number = 1; number <= doc.numPages; number += 1) {
              const p = await doc.getPage(number);
              const content = await p.getTextContent();
              texts.push(content.items.map(item => 'str' in item ? item.str : '').join(' ').toLocaleLowerCase());
              if (cancelled) return;
            }
            searchCache.current = texts;
          }
          const term = query.trim().toLocaleLowerCase();
          const found = texts.map((text, i) => ({ page: i + 1, count: text.split(term).length - 1 })).filter(item => item.count > 0);
          if (!cancelled) { setMatches(found); setSearchIndex(0); setSearching(false); if (found.length) goToPage(found[0].page); }
        } catch { if (!cancelled) { setSearching(false); setNotice('搜索未能完成，请重新打开这份 PDF 后再试。'); } }
      })();
    }, 280);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [doc, query, goToPage]);

  const onScroll = () => {
    if (!scrollRoot || !doc) return;
    const position = scrollRoot.getBoundingClientRect().top + Math.min(100, scrollRoot.clientHeight / 4);
    const pages = Array.from(scrollRoot.querySelectorAll<HTMLDivElement>('[data-pdf-page]'));
    // A short final page cannot always reach the top of a tall viewport.
    // At the scroll limit, keep the final page selected instead of reverting
    // to the preceding page whose bottom still crosses the reading anchor.
    const atEnd = scrollRoot.scrollTop > 0 && scrollRoot.scrollHeight - scrollRoot.clientHeight - scrollRoot.scrollTop <= 1;
    const closest = atEnd ? pages.at(-1) : pages.find(element => element.getBoundingClientRect().bottom >= position);
    const number = Number(closest?.dataset.pdfPage || 1);
    if (number !== currentPage.current) { currentPage.current = number; onPageChangeRef.current(number); }
  };

  const pointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    stopWheelZoom();
    if (!scrollRoot || !doc || cropBusy || ![0, 1].includes(event.button)) return;
    const rootBox = scrollRoot.getBoundingClientRect();
    if (event.clientX >= rootBox.left + scrollRoot.clientWidth || event.clientY >= rootBox.top + scrollRoot.clientHeight) return;
    gestureSuppressed.current = false;
    if (cropping && !spacePan && event.button === 0) {
      const element = (event.target as HTMLElement).closest<HTMLDivElement>('[data-pdf-page]');
      if (!element) return;
      event.preventDefault(); window.getSelection()?.removeAllRanges();
      const box = element.getBoundingClientRect();
      const x = clamp((event.clientX - box.left) / box.width, 0, 1), y = clamp((event.clientY - box.top) / box.height, 0, 1);
      cropDrag.current = { pointer: event.pointerId, page: Number(element.dataset.pdfPage), element, x, y };
      setCropDraft({ page: Number(element.dataset.pdfPage), region: { x, y, width: 0, height: 0 } });
      event.currentTarget.setPointerCapture(event.pointerId); gestureSuppressed.current = true;
    } else if (mode === 'hand' || spacePan || event.button === 1) {
      event.preventDefault(); window.getSelection()?.removeAllRanges();
      panDrag.current = { pointer: event.pointerId, x: event.clientX, y: event.clientY, left: scrollRoot.scrollLeft, top: scrollRoot.scrollTop };
      event.currentTarget.setPointerCapture(event.pointerId); setPanning(true); gestureSuppressed.current = true;
    }
  };
  const getCropRegion = (event: ReactPointerEvent<HTMLDivElement>, drag: NonNullable<typeof cropDrag.current>) => {
    const box = drag.element.getBoundingClientRect();
    const x = clamp((event.clientX - box.left) / box.width, 0, 1), y = clamp((event.clientY - box.top) / box.height, 0, 1);
    return { x: Math.min(x, drag.x), y: Math.min(y, drag.y), width: Math.abs(x - drag.x), height: Math.abs(y - drag.y) };
  };
  const pointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const pan = panDrag.current, crop = cropDrag.current;
    if (pan?.pointer === event.pointerId && scrollRoot) {
      scrollRoot.scrollLeft = pan.left - event.clientX + pan.x;
      scrollRoot.scrollTop = pan.top - event.clientY + pan.y;
    }
    if (crop?.pointer === event.pointerId) setCropDraft({ page: crop.page, region: getCropRegion(event, crop) });
  };
  const pointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const crop = cropDrag.current;
    panDrag.current = null; cropDrag.current = null; setPanning(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (!crop || !doc || !onCrop) return;
    const selected = getCropRegion(event, crop), box = crop.element.getBoundingClientRect();
    if (selected.width * box.width < 12 || selected.height * box.height < 12) { setCropDraft(null); setNotice('框选范围太小，请拖出包含完整子图的矩形。'); return; }
    const region = unrotateCrop(selected, rotation);
    // Guard tiny floating-point negatives at the page edges.
    region.x = Math.max(0, region.x); region.y = Math.max(0, region.y);
    const sequence = ++cropSequence.current;
    setCropBusy(true); setCropping(false);
    void renderDocumentPage(doc, crop.page, 2000, region).then(dataUrl => {
      if (sequence === cropSequence.current) onCrop({ page: crop.page, dataUrl, region });
    }).catch(() => { if (sequence === cropSequence.current) setNotice('原图暂时无法截取，请重新框选。'); }).finally(() => {
      if (sequence === cropSequence.current) { setCropBusy(false); setCropDraft(null); }
    });
  };

  const onSelect = () => {
    if (gestureSuppressed.current || cropping || spacePan || mode !== 'text') return;
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !selection.rangeCount) return;
    const text = selection.toString().trim();
    if (!text || !scrollRoot?.contains(selection.anchorNode)) return;
    const range = selection.getRangeAt(0);
    const box = range.getBoundingClientRect();
    const startElement = selection.anchorNode instanceof Element ? selection.anchorNode : selection.anchorNode?.parentElement;
    const pageElement = startElement?.closest<HTMLDivElement>('[data-pdf-page]');
    const number = Number(pageElement?.dataset.pdfPage || currentPage.current);
    onSelection?.({ text, page: number, x: box.left + box.width / 2, y: box.bottom });
    if (!highlighter || !pageElement) return;
    const pageBox = pageElement.getBoundingClientRect();
    const rectangles = Array.from(range.getClientRects()).filter(rect => rect.width > 1 && rect.height > 1 && rect.top >= pageBox.top - 1 && rect.bottom <= pageBox.bottom + 1).map(rect => ({ x: (rect.left - pageBox.left) / pageBox.width, y: (rect.top - pageBox.top) / pageBox.height, width: rect.width / pageBox.width, height: rect.height / pageBox.height }));
    if (rectangles.length) {
      setHighlights(items => [...items, { id: crypto.randomUUID(), page: number, text, rotation, rectangles, color: highlightColor }]);
      setNotice('已高亮选中文字，标注保存在本机。');
      selection.removeAllRanges();
    }
  };

  const download = () => {
    if (!data) return;
    const url = URL.createObjectURL(new Blob([data.slice().buffer as ArrayBuffer], { type: 'application/pdf' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = fileName; anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const print = () => {
    if (!data) return;
    const url = URL.createObjectURL(new Blob([data.slice().buffer as ArrayBuffer], { type: 'application/pdf' }));
    const frame = document.createElement('iframe');
    frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
    frame.src = url;
    frame.onload = () => { window.setTimeout(() => { try { frame.contentWindow?.focus(); frame.contentWindow?.print(); } catch { setNotice('请下载原文后，在系统「预览」中打印。'); } }, 400); };
    document.body.append(frame);
    window.setTimeout(() => { frame.remove(); URL.revokeObjectURL(url); }, 120_000);
  };
  const bookmark = () => setBookmarks(items => items.includes(activePage) ? items.filter(number => number !== activePage) : [...items, activePage].sort((a, b) => a - b));
  const moveSearch = (direction: number) => {
    if (!matches.length) return;
    const next = (searchIndex + direction + matches.length) % matches.length;
    onBeforeNavigate?.();setSearchIndex(next); goToPage(matches[next].page);
  };
  const changeZoom = (delta: number) => zoomAt(Number((scale + delta).toFixed(2)));
  const totalMatches = matches.reduce((sum, match) => sum + match.count, 0);

  const selectMode=(next:'pointer'|'hand'|'text')=>{onCropCancel?.();stopWheelZoom();setMode(next);setHighlighter(false);setCropping(false);setCropDraft(null);setColorsOpen(false);gestureSuppressed.current=false;window.getSelection()?.removeAllRanges();};
  return <section className="pdf-viewer" aria-label="PDF 原文阅读器" tabIndex={0}>
    
    <div className="pdf-toolbar"><div className="pdf-tool-group pdf-primary-tools"><button className="pdf-icon-button" title="搜索 PDF 文字" aria-label="搜索 PDF 文字" onClick={() => setSearchOpen(value => !value)} disabled={!doc}><Search size={16} /></button>
      <div className="pdf-tool-group"><button className="pdf-icon-button" title="上一页" aria-label="上一页" onClick={() => {onBeforeNavigate?.();goToPage(activePage - 1);}} disabled={!doc || activePage <= 1}><ChevronLeft size={15} /></button><form className="pdf-page-form" onSubmit={event => { event.preventDefault(); if(Number(pageInput)!==activePage)onBeforeNavigate?.();goToPage(Number(pageInput)); }}><input aria-label="PDF 页码" value={pageInput} onChange={event => setPageInput(event.target.value)} onBlur={() => { if (Number(pageInput) >= 1) {if(Number(pageInput)!==activePage)onBeforeNavigate?.();goToPage(Number(pageInput));} else setPageInput(String(activePage)); }} inputMode="numeric" disabled={!doc} /><span>/ {doc?.numPages || '—'}</span></form><button className="pdf-icon-button" title="下一页" aria-label="下一页" onClick={() => {onBeforeNavigate?.();goToPage(activePage + 1);}} disabled={!doc || activePage >= doc.numPages}><ChevronRight size={15} /></button></div>
      <span className="pdf-toolbar-separator" />
      <div className="pdf-tool-group"><button className="pdf-icon-button" title="缩小" aria-label="缩小 PDF" onClick={() => changeZoom(-0.15)} disabled={!doc}><Minus size={14} /></button><button className={`pdf-zoom-label ${fit ? 'active' : ''}`} title="适合页面宽度" onClick={() => zoomAt(fitScale, undefined, undefined, true)} disabled={!doc}>{doc ? `${Math.round(scale * 100)}%` : '适宽'}<ChevronDown size={10} /></button><button className="pdf-icon-button" title="放大" aria-label="放大 PDF" onClick={() => changeZoom(0.15)} disabled={!doc}><Plus size={14} /></button><button className="pdf-icon-button pdf-fit-button" title="适合页面宽度" aria-label="适合页面宽度" onClick={() => zoomAt(fitScale, undefined, undefined, true)} disabled={!doc}><Maximize2 size={13} /></button></div>
      </div>
      <div className="pdf-tool-group pdf-secondary-tools"><button className={`pdf-icon-button ${mode==='pointer'&&!cropping?'is-active':''}`} title="鼠标指针 · 上下翻页" data-help="滚轮上下滚动页面；按住 ⌘ / Ctrl 滚轮可缩放，按住空格可临时拖动。" aria-label="鼠标指针 PDF" aria-pressed={mode==='pointer'&&!cropping} onClick={()=>selectMode('pointer')} disabled={!doc}><MousePointer2 size={14}/></button><button className={`pdf-icon-button ${mode === 'hand' && !cropping ? 'is-active' : ''}`} title="手形拖动 · 按住空格也可移动" data-help="按住鼠标左键拖动页面；滚轮围绕指针缩放，适合放大看图。" aria-label="手形拖动 PDF" aria-pressed={mode === 'hand' && !cropping} onClick={() => selectMode('hand')} disabled={!doc}><Hand size={14} /></button><button className={`pdf-icon-button ${mode === 'text' && !cropping ? 'is-active' : ''}`} title="选择文字 · 划词翻译" data-help="拖动选择文字后，可翻译、提问或摘录；滚轮上下翻页。" aria-label="选择 PDF 文字" aria-pressed={mode === 'text' && !cropping} onClick={() => selectMode('text')} disabled={!doc}><TextSelect size={14} /></button>{showFigureTools&&<button className={`pdf-icon-button ${cropping ? 'is-active' : ''}`} title="框选子图精读" data-help="在原文图上拖出矩形，截取高清子图并打开精读；Esc 取消。" aria-label="框选子图精读" aria-pressed={cropping} onClick={() => {onCropCancel?.();if(cropping)setCropping(false);else startCrop();}} disabled={!doc || !onCrop || cropBusy}>{cropBusy ? <LoaderCircle size={14} className="pdf-spin" /> : <Crop size={14} />}</button>}<button className={`pdf-icon-button ${highlighter ? 'is-active' : ''}`} title="划选文字进行高亮" data-help="开启后拖动选择文字进行标注；旁边的颜色按钮可选预设或自选颜色。" aria-label="高亮选中文字" aria-pressed={highlighter} onClick={() => { setHighlighter(value => !value); setMode('text'); setCropping(false); gestureSuppressed.current = false; if (!highlighter) setNotice('高亮已开启，拖动选择 PDF 中的文字即可标注。'); }} disabled={!doc}><Highlighter size={14} /></button><div className="pdf-color-control"><button className="pdf-icon-button pdf-color-button" title="选择高亮颜色" data-help="为新高亮选择颜色；已有标注可在阅读标记里改色。" aria-label="选择高亮颜色" aria-expanded={colorsOpen} onClick={() => setColorsOpen(value => !value)} disabled={!doc}><span style={{ backgroundColor: highlightColor }} /><ChevronDown size={9} /></button>{colorsOpen && <div className="pdf-colors-popover"><strong>高亮颜色</strong><div className="pdf-color-swatches">{highlightColors.map(item => <button key={item.color} aria-label={`${item.name}高亮`} aria-pressed={highlightColor === item.color} title={item.name} style={{ backgroundColor: item.color }} onClick={() => { setHighlightColor(item.color); setColorsOpen(false); }}>{highlightColor === item.color && <Check size={13} />}</button>)}</div><label>自选颜色<input type="color" aria-label="自选高亮颜色" value={highlightColor} onChange={event => setHighlightColor(event.target.value)} /></label><small>新标注使用选定颜色</small></div>}</div><button className={`pdf-icon-button ${bookmarks.includes(activePage) ? 'is-active' : ''}`} title="收藏当前页" data-help="添加或移除这页书签，随后可从阅读标记快速返回。" aria-label="收藏当前页" aria-pressed={bookmarks.includes(activePage)} onClick={bookmark} disabled={!doc}><Bookmark size={14} fill={bookmarks.includes(activePage) ? 'currentColor' : 'none'} /></button><button className="pdf-icon-button" title="阅读标记" aria-label="阅读标记" data-help="查看书签、高亮与评论" aria-expanded={bookmarksOpen} onClick={()=>setBookmarksOpen(value=>!value)} disabled={!doc}><ListChecks size={14}/></button><button className="pdf-icon-button" title="旋转页面" data-help="顺时针旋转 90°，便于阅读横向图表。" aria-label="旋转 PDF" onClick={() => { stopWheelZoom(); setRotation(value => (value + 90) % 360); }} disabled={!doc}><RotateCw size={14} /></button><button className="pdf-icon-button" title="下载原始 PDF" data-help="保存当前文献的原始 PDF 文件。" aria-label="下载原始 PDF" onClick={download} disabled={!doc}><Download size={14} /></button><button className="pdf-icon-button" title="打印原文" data-help="打开 PDF 打印窗口，选择页码和打印设置。" aria-label="打印 PDF" onClick={print} disabled={!doc}><Printer size={14} /></button></div>
    </div>
    {searchOpen && <div className="pdf-searchbar"><Search size={14} /><input ref={searchInput} placeholder="搜索原文关键词…" aria-label="搜索 PDF 原文" value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') moveSearch(event.shiftKey ? -1 : 1); if (event.key === 'Escape') setSearchOpen(false); }} /><span className="pdf-search-count">{searching ? '搜索中' : query ? `${totalMatches} 处 · ${matches.length} 页` : ''}</span><button className="pdf-icon-button" aria-label="上一个匹配页" title="上一个匹配页" disabled={!matches.length} onClick={() => moveSearch(-1)}><ArrowUp size={13} /></button><button className="pdf-icon-button" aria-label="下一个匹配页" title="下一个匹配页" disabled={!matches.length} onClick={() => moveSearch(1)}><ArrowDown size={13} /></button><button className="pdf-icon-button" aria-label="关闭 PDF 搜索" title="关闭 PDF 搜索" onClick={() => { setSearchOpen(false); setQuery(''); }}><X size={13} /></button></div>}
    <div className={`pdf-scroll ${highlighter ? 'pdf-highlight-mode' : ''} ${cropping ? 'pdf-crop-mode' : mode === 'hand' || spacePan ? 'pdf-hand-mode' : mode==='pointer'?'pdf-pointer-mode':''} ${panning ? 'pdf-panning' : ''}`} ref={setScrollRoot} onScroll={onScroll} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={() => { cropDrag.current = null; panDrag.current = null; setPanning(false); setCropDraft(null); }} onMouseUp={event => { if (gestureSuppressed.current || cropping || mode !== 'text' || spacePan) event.stopPropagation(); else onSelect(); }}>
      {cropping && <div className="pdf-crop-hint">拖动框选子图 <button onClick={() => { setCropping(false); setCropDraft(null); }}>取消 · Esc</button></div>}
      {loading && <div className="pdf-empty"><LoaderCircle size={28} className="pdf-spin" /><h3>正在打开原文</h3><p>提取页面与可选择的文字…</p></div>}
      {error && <div className="pdf-empty pdf-error"><FileText size={32} /><h3>暂时无法打开</h3><p>{error}</p></div>}
      {!data && !loading && <div className="pdf-empty"><div className="pdf-empty-icon"><FileText size={34} strokeWidth={1.3} /></div><h3>{missingPdf?'本地 PDF 已删除':'从一篇文献开始'}</h3><p>{missingPdf?'解析与笔记仍可阅读，PDF 可从完整备份恢复。':<>上传或拖入 PDF<br />原文与解析将在这里同步展开</>}</p><span className="pdf-empty-hint">PDF · 可选择文字 · 页码联动</span></div>}
      {doc && <div className="pdf-pages" style={{ minWidth: fit ? 0 : maxPageWidth * scale + 48 }}>{sizes.map((size, index) => <PdfPage key={index} doc={doc} retain={Math.abs(index + 1 - activePage) <= 2} number={index + 1} size={size} scale={scale} rotation={rotation} root={scrollRoot} query={query} highlights={highlights.filter(item => item.page === index + 1)} crop={cropDraft?.page === index + 1 ? cropDraft.region : undefined} target={target?.page===index+1?target.regions.map(r=>rotateRegion(r,rotation)):undefined} />)}</div>}
    </div>
    {notice && <div className="pdf-notice" role="status"><Check size={13} />{notice}</div>}
    {bookmarksOpen && <div className="pdf-bookmarks-popover"><div className="pdf-bookmarks-title"><strong>阅读标记</strong><button className="subtle-button" onClick={()=>{setBookmarksOpen(false);setAnnotationsOpen(true);}}>高亮与评论</button><button className="pdf-icon-button" aria-label="关闭阅读标记" onClick={() => setBookmarksOpen(false)}><X size={14} /></button></div>{!bookmarks.length && !highlights.length && <p>点击工具栏书签收藏页面，或划选文字添加高亮。</p>}{bookmarks.map(number => <div className="pdf-mark-row" key={`page-${number}`}><button onClick={() => { onBeforeNavigate?.();goToPage(number); setBookmarksOpen(false); }}><Bookmark size={13} />第 {number} 页</button><button className="pdf-icon-button" title="删除书签" aria-label={`删除第 ${number} 页书签`} onClick={() => setBookmarks(items => items.filter(item => item !== number))}><X size={12} /></button></div>)}{highlights.map(item => <div className="pdf-mark-row pdf-highlight-row" key={item.id}><button onClick={() => { onBeforeNavigate?.();if (rotation !== item.rotation) setRotation(item.rotation); goToPage(item.page); setBookmarksOpen(false); }}><Highlighter size={13} style={{ color: item.color || '#d5a923' }} /><span><small>第 {item.page} 页</small>{item.text}</span></button><input type="color" className="pdf-annotation-color" title="修改此标注颜色" aria-label="修改此标注颜色" value={item.color || '#ffd735'} onChange={event => setHighlights(items => items.map(other => other.id === item.id ? { ...other, color: event.target.value } : other))} /><button className="pdf-icon-button" title="删除高亮" aria-label="删除高亮" onClick={() => setHighlights(items => items.filter(other => other.id !== item.id))}><X size={12} /></button></div>)}</div>}
    {annotationsOpen&&<AnnotationsManager items={highlights} onChange={setHighlights} onGo={item=>{onBeforeNavigate?.();setRotation(item.rotation);goToPage(item.page);setAnnotationsOpen(false);}} onAppend={onAppendHighlights} onClose={()=>setAnnotationsOpen(false)}/>}

  </section>;
});

export default PdfViewer;
