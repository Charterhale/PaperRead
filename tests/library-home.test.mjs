import test from 'node:test';
import assert from 'node:assert/strict';
import { duplicatePaperIds, libraryPapers } from '../src/lib/libraryHome.ts';
const paper=(id,patch={})=>({id,title:id,authors:'',journal:'',year:'',fileName:id+'.pdf',category:'基础医学',folderId:'a',addedAt:1,pages:[],pageCount:1,outline:[],notes:'',starred:false,...patch});
const options={scope:'all',folderIds:['a','b'],query:'',sort:'added',descending:true};
test('library filters shared existing records without modifying reading content or deleting duplicates',()=>{
 const rows=[paper('a',{doi:'https://doi.org/10.1234/ABC',analysis:{overview:'保留分析'},notes:'保留笔记'}),paper('b',{doi:'10.1234/abc'}),paper('c',{fileHash:'same'}),paper('d',{fileHash:'same'}),paper('trash',{deletedAt:4})];
 const original=JSON.stringify(rows);assert.deepEqual([...duplicatePaperIds(rows)],['a','b','c','d']);assert.deepEqual(libraryPapers(rows,{...options,scope:'duplicates'}).map(p=>p.id),['a','b','c','d']);assert.equal(JSON.stringify(rows),original);
});
test('sorting supports titles, authors, journals, publication year and actual read time in both directions',()=>{
 const rows=[paper('z',{authors:'B',journal:'A',year:'2020',addedAt:3}),paper('a',{authors:'A',journal:'Z',year:'2026',addedAt:1,lastReadAt:10}),paper('b',{authors:'C',journal:'B',year:'2024',addedAt:2,lastReadAt:20})];
 for(const [sort,expected] of [['title',['a','b','z']],['authors',['a','z','b']],['journal',['z','b','a']],['year',['z','b','a']],['added',['a','b','z']],['read',['z','a','b']]]){
  assert.deepEqual(libraryPapers(rows,{...options,sort,descending:false}).map(p=>p.id),expected);assert.deepEqual(libraryPapers(rows,{...options,sort,descending:true}).map(p=>p.id),[...expected].reverse());
 }
});
test('scopes, reading filters and multiword search match real metadata, notes and PDF text',()=>{
 const rows=[paper('a',{authors:'Alice',pages:['synovium inflammation'],notes:'单细胞想法',lastReadAt:10,readingStatus:'reading'}),paper('b',{folderId:'unknown',starred:true,readingStatus:'done'}),paper('c',{folderId:'b',category:'临床研究',tags:['trial']})];
 assert.deepEqual(libraryPapers(rows,{...options,query:'Alice inflammation'}).map(p=>p.id),['a']);assert.equal(libraryPapers(rows,{...options,query:'单细胞'}).length,1);
 for(const [scope,ids] of [['unfiled',['b']],['folder:b',['c']],['starred',['b']],['reading',['a']],['done',['b']],['recent',['a']]])assert.deepEqual(libraryPapers(rows,{...options,scope}).map(p=>p.id),ids);
 assert.deepEqual(libraryPapers(rows,{...options,category:'临床研究',status:'unread'}).map(p=>p.id),['c']);
});
test('journal-tag sorting supports every metric in both directions and leaves missing values last',()=>{
 const rows=[paper('a',{citationCount:0,tags:['b']}),paper('b',{citationCount:40,tags:['a']}),paper('unknown')];const journals={a:{cas:{zone:1},emerging:{zone:2},jcr:{quartile:'Q3',impactFactor:'3.2'}},b:{cas:{zone:3},emerging:{zone:1},jcr:{quartile:'Q1',impactFactor:'12.1'}}};
 for(const [sort,order] of [['cas',['a','b','unknown']],['emerging',['b','a','unknown']],['jcr',['b','a','unknown']],['impact',['a','b','unknown']],['citations',['a','b','unknown']]]){assert.deepEqual(libraryPapers(rows,{...options,sort,journals,descending:false}).map(p=>p.id),order);assert.deepEqual(libraryPapers(rows,{...options,sort,journals,descending:true}).map(p=>p.id),[order[1],order[0],'unknown']);}
 assert.deepEqual(libraryPapers(rows.slice(0,2),{...options,sort:'tags',descending:false}).map(p=>p.id),['b','a']);
});
test('multiple memberships and saved smart filters update from current metadata without moving records',()=>{const rows=[paper('a',{folderIds:['a','b'],year:'2026',tags:['OA']}),paper('b',{folderIds:[],year:'2024'}),paper('merged',{mergedInto:'a'})];assert.deepEqual(libraryPapers(rows,{...options,scope:'folder:b'}).map(p=>p.id),['a']);assert.deepEqual(libraryPapers(rows,{...options,scope:'unfiled'}).map(p=>p.id),['b']);assert.deepEqual(libraryPapers(rows,{...options,scope:'smart:saved',smartGroup:{id:'saved',name:'Recent OA',query:'',yearFrom:'2025',tag:'OA'}}).map(p=>p.id),['a']);});
