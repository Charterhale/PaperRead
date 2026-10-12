import { PDFDocument, StandardFonts, rgb, degrees } from 'pdf-lib';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

// Original teaching material. All content and values below are intentionally synthetic.
const doc = await PDFDocument.create();
const regular = await doc.embedFont(StandardFonts.Helvetica);
const bold = await doc.embedFont(StandardFonts.HelveticaBold);
const serif = await doc.embedFont(StandardFonts.TimesRoman);
const italic = await doc.embedFont(StandardFonts.TimesRomanItalic);
const c = {
  ink: rgb(.11,.16,.22), muted: rgb(.40,.45,.51), line: rgb(.86,.89,.91),
  blue: rgb(.22,.39,.78), teal: rgb(.13,.57,.52), lavender: rgb(.57,.47,.76),
  pale: rgb(.95,.97,.98), mint: rgb(.90,.96,.94), amber: rgb(.58,.35,.09),
  paper: rgb(1,1,1), orange: rgb(.84,.56,.30), lightBlue: rgb(.92,.95,.99),
};
const W=612, H=792, M=48;
function text(p, value, x, y, size=10, color=c.ink, font=regular, opts={}) {
  p.drawText(String(value), { x, y, size, color, font, ...opts });
}
function line(p,x1,y1,x2,y2,color=c.line,width=1,opts={}) {
  p.drawLine({start:{x:x1,y:y1},end:{x:x2,y:y2},color,thickness:width,...opts});
}
function rect(p,x,y,w,h,fill=c.pale,stroke) {
  p.drawRectangle({x,y,width:w,height:h,color:fill,...(stroke?{borderColor:stroke,borderWidth:.7}:{})});
}
function para(p, value, x, y, width, size=10, color=c.muted, font=regular, leading=15) {
  let cy=y;
  for(const paragraph of value.split('\n')) {
    let current='';
    for(const word of paragraph.split(' ')) {
      const next=current?`${current} ${word}`:word;
      if(font.widthOfTextAtSize(next,size)>width && current) { text(p,current,x,cy,size,color,font);cy-=leading;current=word; }
      else current=next;
    }
    if(current) text(p,current,x,cy,size,color,font);
    cy-=leading;
  }
  return cy;
}
function center(p,value,x,y,width,size=10,color=c.ink,font=regular) {
  text(p,value,x+(width-font.widthOfTextAtSize(value,size))/2,y,size,color,font);
}
function page(number, eyebrow, title, subtitle) {
  const p=doc.addPage([W,H]);
  text(p,'PAPERLENS',M,752,9,c.blue,bold);
  text(p,'READING LAB',M+78,752,9,c.muted);
  text(p,'SYNTHETIC EDUCATIONAL DEMO',343,752,8,c.amber,bold);
  line(p,M,737,W-M,737);
  text(p,eyebrow.toUpperCase(),M,704,9,c.teal,bold);
  text(p,title,M,668,27,c.ink,serif);
  para(p,subtitle,M,645,510,10.5,c.muted,regular,16);
  line(p,M,54,W-M,54);
  text(p,'Invented document, samples and figures. Not a real paper or dataset.',M,36,7.5,c.muted);
  text(p,`${String(number).padStart(2,'0')} / 06`,526,36,8,c.muted);
  return p;
}
function panelTitle(p,label,title,x,y) {
  text(p,label,x,y,12,c.ink,bold);text(p,title,x+20,y,10,c.ink,bold);
}
function arrow(p,x1,y,x2,color=c.muted) {
  line(p,x1,y,x2,y,color,1.2);line(p,x2-5,y+3,x2,y,color,1.2);line(p,x2-5,y-3,x2,y,color,1.2);
}
function box(p,title,x,y,w,h,fill=c.lightBlue,subtitle='') {
  rect(p,x,y,w,h,fill);
  center(p,title,x,y+h/2+(subtitle?4:-3),w,9,c.ink,bold);
  if(subtitle) center(p,subtitle,x,y+h/2-11,w,8,c.muted);
}
function axis(p,x,y,w,h,xLabel,yLabel,yTicks,maxY,xTicks=[]) {
  line(p,x,y,x+w,y,c.muted,.7);line(p,x,y,x,y+h,c.muted,.7);
  for(const tick of yTicks) {
    const ty=y+tick/maxY*h;
    line(p,x,ty,x+w,ty,c.line,.5);
    text(p,tick.toString(),x-22,ty-3,7.5,c.muted);
  }
  for(const {value,label} of xTicks) center(p,label,x+value*w-20,y-15,40,7.5,c.muted);
  center(p,xLabel,x,y-35,w,8,c.muted);
  text(p,yLabel,x-38,y+10,8,c.muted,regular,{rotate:degrees(90)});
}
function dot(p,x,y,r,color) {p.drawCircle({x,y,size:r,color,opacity:.85});}
function note(p,title,body,y=144,fill=c.mint) {
  rect(p,M,y,516,80,fill);text(p,title,M+16,y+58,10,c.teal,bold);para(p,body,M+16,y+40,480,9,c.muted,regular,14);
}

// 1 — Article-like introduction, clearly marked as an original teaching example.
{
  const p=page(1,'A guided exercise in reading evidence','Mapping the ageing stromal niche','An original teaching example for connecting scientific questions, figure panels and evidence.');
  rect(p,M,552,516,53,c.mint);
  text(p,'THE QUESTION',M+15,586,8,c.teal,bold);
  para(p,'Does an inflammatory stromal state accompany ageing, and what would it take to test its function?',M+15,570,482,11,c.ink,serif,14);
  text(p,'Abstract',M,520,15,c.ink,serif);
  para(p,'Tissue ageing can be described in terms of cell composition, within-cell state and functional interactions. These are related but distinct questions. In this fictional case, a single-cell atlas motivates an association analysis and a subsequent intervention. The aim is to practise matching the strength of each claim to the experiment that supports it.',M,499,516,10.5,c.muted,regular,16);
  text(p,'A six-step reading route',M,393,15,c.ink,serif);
  const labels=['Question','Design','Atlas','Association','Perturbation','Boundaries'];
  labels.forEach((label,i)=>{box(p,label,M+i*87,335,78,35,i%2?c.lightBlue:c.mint);if(i<5)arrow(p,M+i*87+80,352,M+i*87+85,c.muted);text(p,`0${i+1}`,M+i*87+31,322,7.5,c.muted);});
  text(p,'What to look for',M,278,15,c.ink,serif);
  const lines=[['Experimental unit','Patients, donors or animals provide biological replication.'],['Axes and units','Identify what each number represents before interpreting a trend.'],['Evidence boundary','Distinguish a descriptive pattern from a causal intervention.']];
  lines.forEach(([a,b],i)=>{text(p,a,M,249-i*35,9,c.ink,bold);text(p,b,M+118,249-i*35,9,c.muted);});
  note(p,'A DEMONSTRATION, NOT A SCIENTIFIC FINDING','All samples, values, figure panels and conclusions in this document are invented. No study was performed. Do not cite this material as biological evidence.',75,c.lightBlue);
}

// 2 — Study design + sample-level cell recovery.
{
  const p=page(2,'01 / Study design','A sample is not a cell','Before following the results, locate the biological replicates and examine what is being compared.');
  panelTitle(p,'A','Two cohorts, one sample-level comparison',M,586);
  box(p,'Young',M,510,93,50,c.mint,'6 fictional donors');
  box(p,'Old',M,447,93,50,c.lightBlue,'6 fictional donors');
  line(p,142,535,161,535,c.muted);line(p,142,472,161,472,c.muted);line(p,161,472,161,535,c.muted);arrow(p,161,504,180);
  box(p,'Tissue collection',182,479,112,50,c.pale);
  arrow(p,297,504,321);box(p,'Single-cell profiling',323,479,112,50,c.pale);
  arrow(p,438,504,460);box(p,'Donor analysis',462,479,102,50,c.lightBlue);
  panelTitle(p,'B','Recovered cells by donor',M,409);
  const x=91,y=237,w=442,h=134;axis(p,x,y,w,h,'Donor ID','Recovered cells',[0,2000,4000,6000],6000);
  const values=[3900,4200,3700,4600,4050,4400,3800,4100,3550,4300,3950,4200];
  values.forEach((value,i)=>{const dx=x+18+i*(w-36)/11;dot(p,dx,y+value/6000*h,4.2,i<6?c.teal:c.blue);center(p,(i<6?'Y':'O')+(i%6+1),dx-12,y-14,24,7,c.muted);});
  dot(p,380,413,3,c.teal);text(p,'Young',389,410,8,c.muted);dot(p,449,413,3,c.blue);text(p,'Old',458,410,8,c.muted);
  note(p,'HOW TO READ FIGURE 1','Each point in B is one fictional donor. Similar cell recovery does not establish similar viability, absence of batch effects, or equal cell-type abundance.',105);
  text(p,'Figure 1 | Study design and sample-level quality control. All values are synthetic.',M,82,8,c.muted,italic);
}

// 3 — UMAP, donor scores, marker heatmap.
{
  const p=page(3,'02 / Atlas observations','Separate composition from state','A cell map, a donor-level score and a marker heatmap answer three different questions.');
  panelTitle(p,'A','Illustrative cell atlas',48,586);
  const x=81,y=389,w=205,h=159;
  line(p,x,y,x+w,y,c.muted,.7);line(p,x,y,x,y+h,c.muted,.7);center(p,'UMAP 1',x,y-20,w,8,c.muted);text(p,'UMAP 2',x-24,y+47,8,c.muted,regular,{rotate:degrees(90)});
  let seed=2026;const rand=()=>{seed=(seed*16807)%2147483647;return(seed-1)/2147483646;};
  const clusters=[{cx:60,cy:103,col:c.teal},{cx:151,cy:110,col:c.blue},{cx:103,cy:35,col:c.lavender}];
  clusters.forEach(({cx,cy,col})=>{for(let i=0;i<52;i++){const a=rand()*Math.PI*2,r=Math.sqrt(rand());dot(p,x+cx+Math.cos(a)*r*35,y+cy+Math.sin(a)*r*23,1.8,col);}});
  ['Stromal','Immune','Endothelial'].forEach((label,i)=>{dot(p,55+i*79,359,2.5,clusters[i].col);text(p,label,61+i*79,356,7,c.muted);});
  panelTitle(p,'B','Inflammatory state',330,586);
  const bx=373,by=389,bw=168,bh=159;axis(p,bx,by,bw,bh,'Age group','State score (a.u.)',[0,.5,1],1.2,[{value:.27,label:'Young'},{value:.76,label:'Old'}]);
  [[.25,.35,.29,.41,.31,.38],[.74,.86,.80,.94,.83,1.02]].forEach((vs,group)=>{const dx=bx+bw*(group?.76:.27);vs.forEach((v,i)=>dot(p,dx+(i-2.5)*4,by+v/1.2*bh,3.3,group?c.blue:c.teal));const mean=vs.reduce((a,b)=>a+b,0)/vs.length;line(p,dx-17,by+mean/1.2*bh,dx+17,by+mean/1.2*bh,c.ink,1.5);});
  panelTitle(p,'C','Marker expression (illustrative)',48,305);
  const rows=['Stromal','Immune','Endothelial'],cols=['COL1A1','CXCL10','PECAM1'];
  const vals=[[.9,.45,.10],[.08,.83,.05],[.12,.28,.95]];
  cols.forEach((v,i)=>center(p,v,167+i*77,280,69,8,c.muted));
  rows.forEach((v,r)=>{text(p,v,65,253-r*23,8,c.muted);vals[r].forEach((v,col)=>rect(p,167+col*77,245-r*23,69,19,rgb(.93-v*.70,.96-v*.49,.98-v*.18)));});
  text(p,'Scaled expression',420,274,7.5,c.muted);for(let i=0;i<40;i++)rect(p,426+i*2.7,251,2.9,9,rgb(.93-i/39*.70,.96-i/39*.49,.98-i/39*.18));text(p,'Low',426,238,7,c.muted);text(p,'High',514,238,7,c.muted);
  note(p,'HOW TO READ FIGURE 2','A: coordinates are dimensionless. B: six points are six donors per group. C: color is relative expression, not absolute abundance. No p-values or real effect sizes were computed.',105);
  text(p,'Figure 2 | An illustrative cell atlas. Every coordinate and expression value is invented.',M,82,8,c.muted,italic);
}

// 4 — Pathways and association with correctly labelled coordinate systems.
{
  const p=page(4,'03 / Mechanistic clues','Association suggests a test','Pathway-level patterns and cross-cell associations help formulate hypotheses for intervention.');
  panelTitle(p,'A','Candidate pathway signals',48,586);
  const px=231,py=423,pw=297,ph=120;
  line(p,px,py,px+pw,py,c.muted,.7);
  [0,1,2,3].forEach(t=>{const tx=px+t/3*pw;line(p,tx,py,tx,py+ph,c.line,.5);center(p,t.toString(),tx-10,py-15,20,7.5,c.muted);});
  ['Interferon response','NF-kB signaling','Extracellular matrix'].forEach((label,i)=>{const cy=519-i*34;text(p,label,70,cy,9,c.muted);rect(p,px,cy-4,[2.4,1.8,1.1][i]/3*pw,16,[c.blue,c.teal,c.lavender][i]);});
  center(p,'Illustrative normalized enrichment score (NES)',px,py-34,pw,8,c.muted);
  panelTitle(p,'B','Scores within the same donor',48,349);
  const bx=123,by=163,bw=377,bh=151;axis(p,bx,by,bw,bh,'Stromal inflammatory score (a.u.)','Immune activation (a.u.)',[0,.5,1],1.2,[{value:0,label:'0'},{value:.5,label:'0.5'},{value:1,label:'1.0'}]);
  line(p,bx+35,by+31,bx+333,by+123,c.muted,1,{dashArray:[4,4]});
  const pts=[[.12,.19],[.19,.34],[.27,.27],[.35,.46],[.39,.40],[.44,.62],[.52,.55],[.61,.74],[.68,.73],[.77,.89],[.83,.91],[.91,.94]];
  pts.forEach(([a,b],i)=>dot(p,bx+a*bw,by+b/1.2*bh,3.5,i<6?c.teal:c.blue));
  para(p,'Figure 3 | Synthetic values. No enrichment, correlation or regression was performed. The dashed line is a visual guide, not an estimated regression.',M,103,516,9,c.muted,italic,13);
}

// 5 — Intervention workflow and donor dot plot.
{
  const p=page(5,'04 / Functional experiment','Match the intervention to the claim','A perturbation and a rescue can clarify function only when the relevant controls are present.');
  panelTitle(p,'A','Conditioned-medium transfer',48,586);
  box(p,'Stromal perturbation',48,507,146,55,c.lightBlue,'Modify candidate process');arrow(p,199,534,224);
  box(p,'Medium transfer',229,507,142,55,c.pale,'Test transferable effects');arrow(p,376,534,401);
  box(p,'Immune readout',407,507,157,55,c.mint,'Measure functional response');
  panelTitle(p,'B','Illustrative intervention and rescue',48,457);
  const x=114,y=245,w=396,h=168;axis(p,x,y,w,h,'Experimental condition','Immune activation (a.u.)',[0,.5,1],1.2,[{value:.17,label:'Vehicle'},{value:.50,label:'Perturbation'},{value:.83,label:'Rescue'}]);
  const values=[[.90,1.04,.99,.94],[.35,.47,.40,.38],[.76,.85,.79,.88]];
  values.forEach((vs,i)=>{const dx=x+(.17+.33*i)*w;vs.forEach((v,j)=>dot(p,dx+(j-1.5)*8,y+v/1.2*h,4.1,[c.blue,c.lavender,c.teal][i]));const mean=vs.reduce((a,b)=>a+b,0)/4;line(p,dx-24,y+mean/1.2*h,dx+24,y+mean/1.2*h,c.ink,1.5);});
  note(p,'CONTROLS MAKE THE INTERPRETATION','Check cell viability, drug carry-over, target engagement, dose and specificity. Four dots per condition represent four invented biological replicates, not technical wells.',112);
  para(p,'Figure 4 | A fictional intervention, shown only to teach experimental logic. No experiment was performed and no statistical inference is claimed.',M,91,516,8.5,c.muted,italic,12);
}

// 6 — Evidence boundaries and reading checklist.
{
  const p=page(6,'05 / Evidence boundaries','What can the data support?','A useful reading note records both the finding and the experiment that would change your confidence.');
  const rows=[
    ['Composition','Donor-level proportions','Cell-map density alone is insufficient.'],
    ['Within-cell state','Donor-level aggregation','More cells do not replace more donors.'],
    ['Mechanism','Target engagement + rescue','Association does not show direction.'],
    ['Translation','Independent human validation','A model does not establish clinical benefit.'],
  ];
  text(p,'QUESTION',60,583,8,c.muted,bold);text(p,'EVIDENCE TO LOOK FOR',181,583,8,c.muted,bold);text(p,'LIMIT',377,583,8,c.muted,bold);
  rows.forEach(([a,b,d],i)=>{const y=518-i*61;rect(p,48,y,516,52,i%2?c.paper:c.pale);text(p,a,60,y+30,9,c.ink,bold);para(p,b,181,y+30,177,9,c.ink,regular,13);para(p,d,377,y+30,173,9,c.muted,regular,13);});
  text(p,'A five-question reading checklist',48,292,17,c.ink,serif);
  const checks=['What is the experimental unit?','What do the axes and normalization mean?','Which exact panel supports this sentence?','Is the result descriptive, associative or interventional?','Which controls or methods are missing?'];
  checks.forEach((value,i)=>{p.drawCircle({x:57,y:261-i*25,size:8,color:c.lightBlue});center(p,String(i+1),49,258-i*25,16,8,c.blue,bold);text(p,value,76,258-i*25,10,c.ink);});
  rect(p,48,75,516,51,c.mint);text(p,'END OF EDUCATIONAL DEMONSTRATION',63,108,9,c.teal,bold);text(p,'Upload a real paper and verify every interpretation against the original PDF.',63,91,9,c.muted);
}

doc.setTitle('Mapping the ageing stromal niche - SYNTHETIC EDUCATIONAL DEMO');
doc.setAuthor('PaperLens - Original synthetic teaching material');
doc.setSubject('Fictional educational example; no real article, experiment, or data');
doc.setKeywords(['synthetic','educational demo','not a real study','PaperLens']);
doc.setCreator('PaperLens create-demo.mjs');
doc.setProducer('pdf-lib');
const out = fileURLToPath(new URL('../public/demo.pdf',import.meta.url));
await mkdir(fileURLToPath(new URL('../public/',import.meta.url)),{recursive:true});
await writeFile(out,await doc.save());
console.log(`Created ${out} (${doc.getPageCount()} synthetic educational pages)`);
