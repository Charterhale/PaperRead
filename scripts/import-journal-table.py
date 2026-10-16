"""Import the user-selected workbook into a local, read-only journal lookup.
Usage: python3 scripts/import-journal-table.py /absolute/path/table.xlsx
Only requested journal fields are exported; source workbook remains unchanged.
"""
import sys, zipfile, xml.etree.ElementTree as E, re, json, hashlib
from pathlib import Path
source=Path(sys.argv[1]); ns={'s':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
def norm(s): return re.sub(r'[^\w]', '', s.casefold().replace('&','and')).replace('_','')
with zipfile.ZipFile(source) as z:
 strings=[''.join(e.itertext()) for e in E.fromstring(z.read('xl/sharedStrings.xml'))]
 def rows(i):
  for row in E.fromstring(z.read(f'xl/worksheets/sheet{i}.xml')).findall('s:sheetData/s:row',ns):
   values={}
   for c in row:
    v=c.find('s:v',ns); value=v.text or '' if v is not None else ''.join(c.itertext())
    if c.attrib.get('t')=='s': value=strings[int(value)]
    values[re.sub(r'\d','',c.attrib['r'])]=value.strip()
   yield int(row.attrib['r']),values
 journals={}
 def journal(name):
  key=norm(name)
  if key not in journals:journals[key]={'name':name,'aliases':[],'issns':[]}
  return journals[key]
 def add_unique(j,key,values):
  for v in values:
   if v and v!='-' and v not in j[key]:j[key].append(v)
 for row,r in rows(2):
  if row<4 or not r.get('A') or r.get('B') not in ['1','2','3','4']:continue
  j=journal(r['A']);j['cas']={'zone':int(r['B']),'top':r.get('C')=='是','edition':2025}
 for row,r in rows(1):
  if row<4 or not r.get('D') or not re.fullmatch('[1-4]区',r.get('G','')):continue
  j=journal(r['D']);add_unique(j,'issns',[r.get('E',''),r.get('F','')]);j.setdefault('emerging',{'zone':int(r['G'][0]),'top':False,'edition':2026});j['emerging']['top']|=r.get('H','').lower()=='top'
 for row,r in rows(4):
  if row<4 or not r.get('B'):continue
  j=journal(r['B']);add_unique(j,'aliases',[r.get('C','')]);add_unique(j,'issns',[r.get('D',''),r.get('E','')]);
  j['jcr']={'quartile':r.get('I','') if re.fullmatch('Q[1-4]',r.get('I','')) else '','impactFactor':r.get('H',''),'dataYear':r.get('AG',''),'edition':2026,'subjects':r.get('AF','')}
  j['indexes']=sorted(set(re.findall(r'\((SCIE|SSCI|AHCI|ESCI)\)',r.get('AF',''))))
 out={'source':{'name':source.name,'sha256':hashlib.sha256(source.read_bytes()).hexdigest(),'casEdition':2025,'emergingEdition':2026,'jcrEdition':2026,'jifDataYears':sorted(set(j['jcr']['dataYear'] for j in journals.values() if j.get('jcr')))},'journals':list(journals.values())}
 dest=Path(__file__).resolve().parents[1]/'server/data/journals.json';dest.parent.mkdir(parents=True,exist_ok=True);dest.write_text(json.dumps(out,ensure_ascii=False,separators=(',',':')))
 print(json.dumps({'journals':len(journals),'cas':sum('cas'in j for j in journals.values()),'emerging':sum('emerging'in j for j in journals.values()),'jcr':sum('jcr'in j for j in journals.values()),'jifDataYears':out['source']['jifDataYears'],'bytes':dest.stat().st_size},ensure_ascii=False))
 for key in ['Nature','Nature Communications','Cell Metabolism','Arthritis & Rheumatology']:print(json.dumps(journals.get(norm(key)),ensure_ascii=False))
