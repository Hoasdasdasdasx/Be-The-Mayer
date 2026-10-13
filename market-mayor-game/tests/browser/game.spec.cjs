const { test, expect } = require('@playwright/test');
const { createHarness } = require('../server-harness.cjs');

async function observeLiveSocket(page) {
  await page.route('**/socket.io/socket.io.js', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: await response.text() + '\n;{const original=window.io;window.io=(...args)=>{const s=original(...args);window.__socket=s;s.on("state",state=>window.__state=state);return s;};}' });
  });
}
async function waitState(page, expression) { await page.waitForFunction(expression); }
async function fixture(page, initial) {
  await page.route('**/socket.io/socket.io.js', route => route.fulfill({ contentType: 'text/javascript', body: `
    window.__sent=[];const handlers={};window.__receive=(event,data)=>(handlers[event]||[]).forEach(fn=>fn(data));
    window.io=()=>{const socket={connected:true,on(event,fn){(handlers[event]||=[]).push(fn)},emit(event,data){window.__sent.push({event,data})},disconnect(){this.connected=false;window.__receive('disconnect')},connect(){this.connected=true;window.__receive('connect')}};
    window.__socket=socket;setTimeout(()=>{window.__receive('connect');window.__receive('roomJoined',{code:${JSON.stringify(initial.code)},playerId:${JSON.stringify(initial.me.id)}});window.__receive('state',${JSON.stringify(initial)});},0);return socket;};
  ` })) ;
  await page.goto('/'); await expect(page.locator('#game')).toBeVisible();
}
async function push(page, state) { await page.evaluate(s => window.__receive('state', s), state); }
function cardState(id = 'campaign', timing = 'day', max = 6) {
  const h = createHarness(), { clients, room } = h.room(max);
  clients[0].send('startGame');
  const actor = room.players[0]; actor.name = '서윤'; room.players[1].name = '민준';
  actor.resources = { C: 8, I: 6, O: 5, E: 4 }; room.players[1].resources = { C: 6, I: 5, O: 4, E: 3 };
  actor.hand = ['campaign','press','pickpocket','backroom'].map((cardId,i) => ({ instanceId: `hand-${i}`, cardId, usableFromTurn: 1 }));
  actor.hand[0] = { instanceId: 'chosen-card', cardId: id, usableFromTurn: 1 };
  room.market = ['public-fund','advice','rumor','corporate', ...(max === 10 ? ['political-network'] : [])].map((cardId,i) => ({ instanceId:`market-${i}`,cardId }));
  h.startActions(room, timing); actor.nightBought = timing === 'night'; h.broadcast(room);
  return { h, clients, room, state: clients[0].state };
}

test('실제 서버: 두 브라우저 세션, 초대, 비공개 선택, 재접속, 10턴 공동 당선', async ({ browser }) => {
  test.setTimeout(120000);
  const contexts = await Promise.all([browser.newContext(), browser.newContext()]);
  const pages = await Promise.all(contexts.map(c=>c.newPage()));
  const errors = []; pages.forEach(p=>p.on('pageerror',e=>errors.push(e.message)));
  for (const page of pages) await observeLiveSocket(page);
  const [a,b] = pages;
  await a.goto('/'); await a.locator('#candidateName').fill('서윤'); await a.locator('#createBtn').click();
  await expect(a.locator('#game')).toBeVisible(); await expect(a.locator('#startGame')).toBeDisabled();
  const code = await a.locator('#roomCode').textContent();
  await b.goto(`/?room=${code}`); await expect(b.locator('#game')).toBeVisible();
  await expect(a.locator('#playerCount')).toHaveText('2 / 6명');
  await a.locator('#startGame').click();
  await expect(a.locator('[data-location=plaza]')).toContainText('무제한');
  await a.locator('[data-location=plaza]').click();
  await expect(a.locator('.waiting')).toContainText('선택을 확정');
  expect(await b.evaluate(()=>window.__state.players[0].chosen)).toBeNull();
  await b.locator('[data-location=plaza]').click();
  await waitState(a,()=>window.__state.phase==='dayActions');
  // Disconnect the current actor; the other browser receives the new turn.
  const oldId = await a.evaluate(()=>window.__state.me.id);
  await a.evaluate(()=>window.__socket.disconnect());
  await expect(a.locator('#connection')).toContainText('연결 끊김');
  await waitState(b,()=>window.__state.actionPlayer.id===window.__state.me.id);
  await a.evaluate(()=>window.__socket.connect());
  await expect(a.locator('#connection')).toHaveText('서버 연결됨');
  expect(await a.evaluate(()=>window.__state.me.id)).toBe(oldId);
  await b.locator('#skipAction').click();
  // Continue all phases through actual rendered controls.
  for (let guard=0;guard<150;guard++) {
    const s = await a.evaluate(()=>window.__state);
    if(s.phase==='finished') break;
    if(s.phase.endsWith('Choose')) {
      for(const page of pages) {
        await page.waitForFunction(phase=>window.__state.phase===phase,s.phase);
        await page.locator('[data-location=plaza]').click();
      }
      await a.waitForFunction(phase=>window.__state.phase!==phase,s.phase);
    } else {
      const actor = await a.evaluate(()=>window.__state.me.id===window.__state.actionPlayer.id) ? a : b;
      await actor.waitForFunction(()=>window.__state.actionPlayer.id===window.__state.me.id);
      const before = await actor.evaluate(()=>({phase:window.__state.phase,turn:window.__state.turn,bought:window.__state.me.nightBought}));
      await actor.locator('#skipAction').click();
      await actor.waitForFunction(before=>window.__state.phase!==before.phase||window.__state.turn!==before.turn||window.__state.actionPlayer.id!==window.__state.me.id||window.__state.me.nightBought!==before.bought,before);
      await a.waitForFunction(()=>!document.querySelector('#skipAction')?.disabled);
    }
  }
  await expect(a.locator('.victory')).toContainText('공동 당선');
  await expect(a.locator('.ranking .winner')).toHaveCount(2);
  expect(await a.evaluate(()=>window.__state.players.map(p=>p.score))).toEqual([20,20]);
  expect(errors).toEqual([]);
  await Promise.all(contexts.map(c=>c.close()));
});

test('실제 서버: 10인 모드, 공개 시장 5장, 상가·술집·시청 선택', async ({ browser }) => {
  const contexts = await Promise.all([browser.newContext(),browser.newContext()]);
  const [a,b] = await Promise.all(contexts.map(c=>c.newPage()));
  for(const p of [a,b]) await observeLiveSocket(p);
  await a.goto('/'); await a.locator('[name=mode][value="10"]').check(); await a.locator('#createBtn').click();
  await expect(a.locator('#market .game-card')).toHaveCount(5);
  await b.goto(`/?room=${await a.locator('#roomCode').textContent()}`); await expect(a.locator('#playerCount')).toHaveText('2 / 10명');
  await a.locator('#startGame').click();
  await a.locator('[data-location=shops]').click(); await b.locator('[data-location=tavern]').click();
  await a.locator('#skipAction').click(); await b.locator('#skipAction').click();
  await a.locator('[data-location=cityhall]').click(); await b.locator('[data-location=cityhall]').click();
  await waitState(a,()=>window.__state.phase==='nightActions');
  expect(await a.evaluate(()=>window.__state.me.resources)).toEqual({C:0,I:1,O:0,E:1});
  expect(await b.evaluate(()=>window.__state.me.resources)).toEqual({C:0,I:0,O:1,E:1});
  await a.locator('#market .game-card').first().click();
  await expect(a.locator('#confirmCard')).toBeDisabled(); await expect(a.locator('.detail-reason')).toContainText('부족');
  await Promise.all(contexts.map(c=>c.close()));
});

test('서버 정의 18종 렌더링·대상 선택·카드 사용·서버 확인·중복 입력', async ({ page }) => {
  const first = cardState(); await fixture(page, first.state);
  for(const c of first.h.CARDS) {
    const f = cardState(c.id,c.timing);
    await push(page,f.state); await page.evaluate(()=>window.__sent=[]);
    await page.locator('#hand [data-card="chosen-card"]').click();
    await expect(page.locator('.detail-description')).toHaveText(c.desc);
    await expect(page.locator('.detail-cost')).toContainText(Object.entries(c.cost).map(([r,n])=>`${{C:'시민',I:'지식인',O:'조직원',E:'상류층'}[r]} ${n}`).join(' + '));
    if(c.target) await page.locator('#targetSelect').selectOption(f.room.players[1].id);
    if(c.stealTypes) await page.locator('#resourceSelect').selectOption(c.stealTypes[0]);
    if(c.marketTarget) await page.locator('#marketSelect').selectOption('market-0');
    // Unrelated state updates must preserve both the selected card and targets.
    f.state.log.unshift('다른 후보가 연결했습니다.'); await push(page,f.state);
    await expect(page.locator('#hand [data-card="chosen-card"]')).toHaveAttribute('aria-pressed','true');
    if(c.target) await expect(page.locator('#targetSelect')).toHaveValue(f.room.players[1].id);
    if(c.marketTarget) await expect(page.locator('#marketSelect')).toHaveValue('market-0');
    await page.evaluate(()=>{document.getElementById('confirmCard').click();document.getElementById('confirmCard').click()});
    const sent = await page.evaluate(()=>window.__sent);
    expect(sent).toHaveLength(1); expect(sent[0].event).toBe(c.timing==='day'?'dayAction':'nightAction');
    await expect(page.locator('#hand [data-card="chosen-card"]')).toHaveCount(1);
    f.clients[0].send(sent[0].event,sent[0].data); await push(page,f.clients[0].state);
    await expect(page.locator('#hand [data-card="chosen-card"]')).toHaveCount(0);
    await expect(page.locator('#toast')).toContainText('서버에 반영');
  }
});

test('구매 확인·자원 차감·실패 복구·손패 한도·다음 턴 제한', async ({ page }) => {
  const f = cardState('campaign','night'); f.room.players[0].hand=[]; f.room.players[0].nightBought=false; f.h.broadcast(f.room);
  await fixture(page,f.clients[0].state);
  await page.locator('#market [data-card="market-0"]').click();
  await expect(page.locator('#confirmCard')).toBeEnabled();
  await page.locator('#confirmCard').click();
  await expect(page.locator('#handCount')).toHaveText('0 / 4장');
  await page.evaluate(()=>window.__receive('notice',{type:'error',message:'구매 비용이 부족합니다.'}));
  await expect(page.locator('#confirmCard')).toBeEnabled();
  await page.locator('#confirmCard').click();
  const sent = await page.evaluate(()=>window.__sent.at(-1)); f.clients[0].send(sent.event,sent.data); await push(page,f.clients[0].state);
  await expect(page.locator('#handCount')).toHaveText('1 / 4장');
  expect(f.clients[0].state.me.resources).toEqual({C:6,I:5,O:5,E:4});
  await expect(page.locator('#toast')).toContainText('구매 완료');
  const full=cardState('campaign','night'); full.room.players[0].nightBought=false; full.h.broadcast(full.room); await push(page,full.clients[0].state);
  await page.locator('#market .game-card').first().click(); await expect(page.locator('.detail-reason')).toContainText('손패 한도 4장');
  const later=cardState('campaign','day'); later.room.players[0].hand[0].usableFromTurn=2; later.h.broadcast(later.room); await push(page,later.clients[0].state);
  await page.locator('#hand [data-card="chosen-card"]').click(); await expect(page.locator('#confirmCard')).toBeDisabled(); await expect(page.locator('.detail-reason')).toHaveText('2턴부터 사용 가능');
});

for(const size of [{width:1920,height:1080},{width:1366,height:768},{width:390,height:844}]) test(`화면 ${size.width}×${size.height}: 긴 설명·확대·키보드·모션 감소`,async({page},testInfo)=>{
  await page.setViewportSize(size); const f=cardState('backroom','night',10); await fixture(page,f.state);
  await expect(page.locator('#market .game-card')).toHaveCount(5); await expect(page.locator('#hand .game-card')).toHaveCount(4);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  for(const card of await page.locator('.game-card').all()) {
    expect(await card.evaluate(el=>{const desc=el.querySelector('.card-description'); return desc.scrollHeight<=desc.clientHeight+1})).toBe(true);
  }
  const hand=page.locator('#hand .game-card').first(); await hand.focus(); await page.keyboard.press('Enter');
  await expect(page.locator('#cardDetail')).toBeVisible(); await page.keyboard.press('Escape'); await expect(page.locator('#cardDetail')).toHaveCount(0);
  await hand.hover();
  expect(await hand.evaluate(el=>{const r=el.getBoundingClientRect();return el.contains(document.elementFromPoint(r.x+r.width/2,r.y+15))})).toBe(true);
  await page.locator('[data-dialog=settingsDialog]').click(); await page.locator('#reduceMotion').check(); await page.locator('#settingsDialog [data-close]').click();
  await expect(page.locator('body')).toHaveClass(/reduce-motion/);
  expect(await hand.evaluate(el=>parseFloat(getComputedStyle(el).transitionDuration))).toBeLessThan(.02);
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.locator('#logToggle').click(); await expect(page.locator('#logPanel')).toBeVisible(); await page.keyboard.press('Escape');
  if(size.width<600){await page.locator('#playersToggle').click(); await expect(page.locator('#candidates')).toBeVisible(); await page.locator('#playersToggle').click();}
  await page.mouse.move(0,0); await page.evaluate(()=>{document.activeElement.blur();window.scrollTo(0,0)}); await page.screenshot({path:testInfo.outputPath(`board-${size.width}.png`),fullPage:true});
  f.room.phase='dayChoose'; f.h.broadcast(f.room); await push(page,f.clients[0].state);
  await expect(page.locator('body')).toHaveAttribute('data-theme','day');
  await expect(page.locator('[data-location=plaza]')).toBeEnabled();
  await page.locator('[data-location=plaza]').click();
  expect((await page.evaluate(()=>window.__sent.at(-1))).event).toBe('chooseLocation');
});

test('단독 당선·공동 당선 표시와 새 선거 안내', async({page})=>{
  const f=cardState(); f.room.phase='finished'; f.room.turn=10; f.room.winner=[f.room.players[0].id]; f.h.broadcast(f.room);
  await fixture(page,f.clients[0].state);
  await expect(page.locator('.victory')).toHaveText('♛ 서윤 당선'); await expect(page.locator('.ranking .winner')).toHaveCount(1);
  f.room.players[1].resources={...f.room.players[0].resources}; f.room.winner=f.room.players.map(p=>p.id); f.h.broadcast(f.room); await push(page,f.clients[0].state);
  await expect(page.locator('.victory')).toContainText('공동 당선'); await expect(page.locator('.ranking .winner')).toHaveCount(2);
  await page.locator('#newGame').click(); await expect(page.locator('#entry')).toBeVisible(); await expect(page.locator('#game')).toBeHidden();
});
