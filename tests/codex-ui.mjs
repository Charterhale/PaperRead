import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
const browser=await chromium.launch({executablePath:'/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',headless:true});
const page=await browser.newPage({viewport:{width:1680,height:1080}}),errors=[],passed=[],requests=[];
page.on('pageerror',e=>errors.push(e.message));
await page.route('**/api/health',r=>r.fulfill({json:{hasApiKey:false,defaultProvider:'codex'}}));
await page.route('**/api/jobs',r=>r.fulfill({json:{jobs:[]}}));
await page.route('**/api/codex/models',r=>r.fulfill({json:{models:[{id:'gpt-test-model',name:'OpenAI 测试模型',efforts:['low','medium','high'],inputModalities:['text','image'],isDefault:true}]}}));
await page.route('**/api/codex/status',r=>r.fulfill({json:{available:true,authenticated:true,billing:'subscription',message:'已通过 ChatGPT 账号登录，使用该账号的 Codex 订阅额度'}}));
await page.route('**/api/ask',r=>{const body=r.request().postDataJSON();requests.push(body);return r.fulfill({json:{answer:'Codex 软件测试回答'}});});
try{
 await page.goto(process.env.TEST_URL||'http://127.0.0.1:5180');await page.waitForSelector('.pdf-page-wrap canvas');
 await page.getByRole('button',{name:'设置',exact:true}).click();await page.waitForSelector('.app-settings');
 assert.equal(await page.getByLabel('AI 阅读服务').inputValue(),'codex');assert.equal(await page.getByLabel('DeepSeek API Key',{exact:true}).count(),0);assert.equal(await page.getByLabel('结合原图解析').isEnabled(),true);await page.getByLabel('Codex OpenAI 模型').selectOption('gpt-test-model');await page.getByLabel('Codex 推理强度').selectOption('high');passed.push('OpenAI 模型和低中高推理强度可独立选择');passed.push('默认 Codex 订阅模式，无需 API Key，支持图片');
 await page.getByLabel('AI 阅读服务').selectOption('deepseek');await page.getByLabel('DeepSeek API Key',{exact:true}).fill('test-key-only-never-persist');await page.getByLabel('DeepSeek 模型').selectOption('deepseek-v4-pro');assert.equal(await page.getByLabel('结合原图解析').isEnabled(),false);await page.getByLabel('DeepSeek 模型').selectOption('deepseek-flash');
 await page.getByLabel('AI 阅读服务').selectOption('codex');assert.equal(await page.getByLabel('Codex OpenAI 模型').inputValue(),'gpt-test-model');await page.getByLabel('Codex OpenAI 模型').selectOption('gpt-test-model');assert.equal(await page.getByLabel('DeepSeek API Key',{exact:true}).count(),0);await page.getByRole('button',{name:'完成',exact:true}).click();
 await page.getByLabel('向文献提问').fill('测试 Codex');await page.getByTitle('发送问题').click();await page.waitForSelector('.chat-message.assistant');assert.equal(requests[0].provider,'codex');assert.equal(requests[0].model,'gpt-test-model');assert.equal(requests[0].reasoningEffort,'high');assert(!('apiKey' in requests[0]));passed.push('Codex 请求不携带隐藏的 DeepSeek 密钥');
 await page.getByRole('button',{name:'设置',exact:true}).click();await page.getByLabel('AI 阅读服务').selectOption('deepseek');assert.equal(await page.getByLabel('DeepSeek API Key',{exact:true}).inputValue(),'test-key-only-never-persist');await page.getByRole('button',{name:'完成',exact:true}).click();await page.getByLabel('向文献提问').fill('测试手动 DeepSeek');await page.getByTitle('发送问题').click();await page.waitForFunction(()=>document.querySelectorAll('.chat-message.assistant').length===2);assert.equal(requests[1].provider,'deepseek');assert.equal(requests[1].apiKey,'test-key-only-never-persist');passed.push('DeepSeek 仅在手动选择后调用，密钥在本窗口保留');
 const settings=await page.evaluate(()=>JSON.parse(localStorage.getItem('pl-settings')));assert.equal(settings.provider,'deepseek');assert(!('apiKey' in settings));await page.reload();await page.getByRole('button',{name:'设置',exact:true}).click();assert.equal(await page.getByLabel('AI 阅读服务').inputValue(),'deepseek');assert.equal(await page.getByLabel('DeepSeek API Key',{exact:true}).inputValue(),'');passed.push('服务选择跨刷新保存，密钥不写入本机设置');
 await page.getByLabel('AI 阅读服务').selectOption('codex');await page.screenshot({path:'artifacts/codex-settings-light.png'});await page.getByRole('button',{name:'完成',exact:true}).click();await page.getByTitle('切换明暗主题').click();await page.getByRole('button',{name:'设置',exact:true}).click();await page.screenshot({path:'artifacts/codex-settings-dark.png'});assert.deepEqual(errors,[]);
 await writeFile('artifacts/codex-ui-verification.json',JSON.stringify({passed,errors},null,2));console.log(JSON.stringify({passed,errors},null,2));
}finally{await browser.close();}
