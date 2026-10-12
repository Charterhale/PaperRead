import { chromium } from '@playwright/test';
const browser=await chromium.launch({executablePath:'/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',headless:true});
const page=await browser.newPage({viewport:{width:1600,height:1040}});
page.on('pageerror',e=>console.log('PAGE ERROR',e.message));page.on('console',m=>console.log('CONSOLE',m.type(),m.text()));page.on('requestfailed',r=>console.log('REQUEST FAIL',r.url(),r.failure()));
await page.goto('http://127.0.0.1:5179');await page.waitForTimeout(4000);console.log((await page.locator('body').innerText()).slice(0,8000));await page.screenshot({path:'artifacts/inspect.png'});await browser.close();
