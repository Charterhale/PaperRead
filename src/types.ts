export type Category = '基础医学' | '生信分析' | '纳米材料' | '临床研究' | '综述 / Meta';
export interface Panel { label: string; type: string; xAxis: string; yAxis: string; explanation: string; evidence: string; question?: string; method?: string; groups?: string; readout?: string; result?: string; statistics?: string; takeaway?: string; image?: string; crop?: CropRegion; }
export interface Figure { id: string; title: string; page: number; caption: string; panels: Panel[]; source?: PdfTarget; }
export interface Section { id: string; title: string; shortTitle: string; page: number; summary: string; proves: string; markdown: string; figures: Figure[]; source?: PdfTarget; }
export interface VisualPlan { version: 1; pages: {page: number; kind: 'raster'|'vector'|'scan'|'uncertain'|'text'; reasons: string[]}[]; }
export interface AnalysisCoverage { pipelineVersion: 2; totalPages: number; expectedVisualPages: number[]; visualPages: number[]; textOnlyPages: number[]; pages: {page: number; mode: 'visual'|'text-only'; batchIds: string[]}[]; batches: {id: string; pages: number[]; imagePages: number[]; status: 'completed'}[]; planId?: string; }
export interface Analysis { title: string; subtitle: string; category: Category; overview: string; sections: Section[]; limitations: string[]; evidenceTable?: EvidenceRow[]; logic?: {nodes: LogicNode[]; edges: LogicEdge[]; mainNodeIds?: string[]}; coverage?: AnalysisCoverage; }
export interface Paper { id: string; title: string; fileName: string; category: Category; folderId: string; folderIds?: string[]; relatedPaperIds?: string[]; mergedInto?: string; mergedPaperIds?: string[]; autoTranslateTitle?: boolean; authorProfile?: {paperTitle:string;checkedAt:number;name:string;firstInstitution:string;country:"CN"|"foreign"|"unknown";direction:string;honors:string[];sources:{title:string;url:string}[];status:string;correspondenceEvidence?:string;institutionEvidence?:string}; pdfRemoved?: boolean; integrity?: {checkedAt:number;identifier:string;status:"notice"|"no-notice"|"unavailable";notices:{type:string;title:string;url:string;source:string}[]}; addedAt: number; pageCount: number; pages: string[]; outline: {title: string; page: number}[]; analysis?: Analysis; notes: string; starred: boolean; demo?: boolean; lastPage?: number; doi?: string; pmid?: string; authors?: string; titleTranslation?: {original:string;text:string;provider:'codex'|'deepseek';createdAt:number}; citationCount?: number; citationUpdatedAt?: number; issns?: string[]; journal?: string; year?: string; tags?: string[]; readingStatus?: 'unread'|'reading'|'done'; fileHash?: string; revisions?: AnalysisRevision[]; analysisEdited?: boolean; officialUrl?: string; lastReadAt?: number; highlightNoteIds?: string[]; supplements?: Supplement[]; supplementLinks?: SupplementLink[]; deletedAt?: number; }
export interface Folder { id: string; name: string; }
export interface Settings { apiKey: string; model: string; vision: boolean; provider?: 'codex'|'deepseek'; deepseekModel?: string; codexModel?:string; reasoningEffort?: 'low'|'medium'|'high'; quickReply?:boolean; }
export interface CodexModel { id:string; name:string; efforts:('low'|'medium'|'high')[]; inputModalities:string[]; isDefault:boolean; }
export interface CodexStatus { available: boolean; authenticated: boolean; billing?: string|null; message: string; }
export interface ChatMessage { role: 'user' | 'assistant'; content: string; provider?: 'codex'|'deepseek'; }
export interface PdfSelection { text: string; x: number; y: number; page: number; }
export interface PdfTarget { page:number; region?:CropRegion; text?:string; }
export interface PdfViewerHandle { revealTarget:(target:PdfTarget)=>Promise<boolean>;  goToPage: (page:number)=>void; getPageImage: (page:number)=>Promise<string>; startCrop?: (page?:number)=>void; getViewState:()=>PdfViewState; restoreViewState:(state:PdfViewState)=>void; }
export interface EvidenceRow { id: string; label: string; value: string; page?: number; }
export interface LogicNode { id: string; title: string; sectionId: string; }
export interface LogicEdge { id: string; from: string; to: string; label?: string; }
export interface AnalysisRevision { id: string; createdAt: number; label: string; analysis: Analysis; }
export interface CropRegion { x: number; y: number; width: number; height: number; }
export interface PdfCrop { page: number; dataUrl: string; region: CropRegion; }
export interface BackgroundJob { provider?: 'codex'|'deepseek'; model?: string; reasoningEffort?: 'low'|'medium'|'high'; id: string; paperId: string; title: string; status: 'preparing'|'queued'|'running'|'paused'|'completed'|'failed'|'cancelled'; progress: number; message: string; createdAt: number; updatedAt: number; error?: string; result?: Analysis; pipelineVersion?: number; preparation?: {expectedPages: number[]; receivedPages: number[]}; visualPlan?: VisualPlan; }

export interface Supplement {id:string;title:string;fileName:string;pageCount:number;pages:string[];addedAt:number;fileHash?:string;}
export interface SupplementLink {id:string;reference:string;documentId:string;page:number;}
export interface PdfViewState {page:number;scale:number;fit:boolean;rotation:number;scrollTop:number;scrollLeft:number;}
export interface PdfHighlight {id:string;page:number;text:string;rotation:number;color?:string;rectangles:CropRegion[];category?:string;comment?:string;}

export interface SmartGroup {id:string;name:string;query:string;category?:string;status?:string;yearFrom?:string;yearTo?:string;tag?:string;cas?:string;jcr?:string;}
