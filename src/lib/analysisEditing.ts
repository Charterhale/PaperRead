import type { Analysis, Category, EvidenceRow, Paper, Panel } from '../types';
export function revisePaper(paper:Paper,analysis:Analysis,label:string):Paper{return {...paper,analysis,analysisEdited:true,revisions:paper.analysis?[...(paper.revisions||[]),{id:crypto.randomUUID(),createdAt:Date.now(),label,analysis:structuredClone(paper.analysis)}].slice(-12):paper.revisions};}
export const panelFields:[keyof Panel,string][]=[['question','这张小图要回答什么'],['method','实验 / 分析方法'],['groups','分组、颜色与图例'],['xAxis','X 轴 / 横向维度'],['yAxis','Y 轴 / 纵向维度'],['readout','如何读这张图'],['result','观察到的具体结果'],['statistics','样本量与统计'],['takeaway','这一小图说明什么']];
const templates:Record<Category,string[]>={
 '基础医学':['研究问题与假设','动物 / 细胞 / 人体模型','分组与对照','干预剂量与时间','独立生物学重复','检测方法与主要指标','关键实验结果','机制验证与救援实验'],
 '生信分析':['数据库与数据编号','样本、供体与分组','数据预处理与质控','批次与混杂处理','核心分析流程','差异阈值与多重检验','训练 / 验证数据划分','独立验证与代码'],
 '纳米材料':['材料组成与制备','粒径 / PDI / 电位','形貌与结构表征','载药量与包封率','释放条件与动力学','靶向 / 摄取 / 分布','剂量与治疗效果','安全性与清除'],
 '临床研究':['研究设计与注册','人群与纳排标准','样本量与分组','干预与对照','主要终点与随访','效应量与置信区间','调整变量与缺失值','不良事件'],
 '综述 / Meta':['综述类型与研究问题','检索库、检索式与日期','纳入排除标准','纳入研究与人群','主要主题 / 合并结局','效应模型与异质性','亚组与敏感性分析','质量评价与发表偏倚']
};
export function evidenceRows(category:Category,rows?:EvidenceRow[]):EvidenceRow[]{const existing=rows||[];return [...existing,...templates[category].filter(label=>!existing.some(r=>r.label===label)).map((label,i)=>({id:'template-'+i,label,value:''}))];}
// Old generated boilerplate is hidden in reading/export; the editable source stays intact.
export function readingText(text='') {
 const label='(?:证据性质|证据边界|带着边界理解结论|原文定位|PDF\\s*原文位置)';
 const tagged=new RegExp('^\\s*(?:[-*+]\\s+)?(?:\\*\\*)?'+label+'(?:\\*\\*)?\\s*(?:[:：]|$)');
 const output:string[]=[];let hiddenLevel=0,inline=false,pendingParagraph=false,fenced=false;
 for(const line of text.split('\n')) {
  if(/^\s*(?:```|~~~)/.test(line)&&!hiddenLevel&&!inline){fenced=!fenced;output.push(line);continue;}
  if(fenced){output.push(line);continue;}
  const heading=/^\s*(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
  if(heading){
   if(hiddenLevel&&heading[1].length>hiddenLevel)continue;
   hiddenLevel=0;inline=false;pendingParagraph=false;
   if(tagged.test(heading[2])){hiddenLevel=heading[1].length;continue;}
   output.push(line);continue;
  }
  if(hiddenLevel)continue;
  if(tagged.test(line)){
   inline=true;
   const plain=line.replace(/\*/g,'').replace(/^\s*[-+]\s+/,'').trim();
   pendingParagraph=new RegExp('^'+label+'\\s*[:：]?\\s*$').test(plain);continue;
  }
  if(inline){if(!line.trim()){if(!pendingParagraph)inline=false;}else pendingParagraph=false;continue;}
  output.push(line);
 }
 return output.join('\n').replace(/\n{3,}/g,'\n\n').trim().replace(/\s*[(（](?:原文\s*)?(?:p\.\s*\d+(?:[–-]\d+)?|第\s*\d+\s*页)[)）]/g,'');
}
