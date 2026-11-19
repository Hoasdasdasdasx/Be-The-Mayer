const { test, expect } = require('@playwright/test');
const { io } = require('socket.io-client');

test('실제 서버에서 카드 구매 후 새로고침해 같은 손패와 자원을 복구하고 카드 사용', async ({ page, baseURL }) => {
  const guestSocket = io(baseURL, { autoConnect: false, reconnection: false });
  const states = [null,null], revisions = [0,0];
  const observe = (index, state) => { states[index] = state; revisions[index]++; };
  guestSocket.on('state', state => observe(1, state));
  let host;
  await page.exposeFunction('observeHostState', state => observe(0, state));
  await page.exposeFunction('observeHostGrant', grant => { host = grant; });
  await page.route('**/socket.io/socket.io.js', async route => {
    const response = await route.fetch();
    const observer = `
      ;{ const open = window.io;
         window.io = (...args) => {
           const socket = open(...args);
           window.hostSocket = socket;
           socket.on('state', state => window.observeHostState(state));
           socket.on('roomCreated', grant => window.observeHostGrant(grant));
           return socket;
         };
       }`;
    await route.fulfill({ response, body: await response.text() + observer });
  });
  const waitForBroadcast = before => expect.poll(() => revisions.every((r, i) => r > before[i])).toBe(true);
  const broadcast = async (index,event,data={}) => {
    const before = [...revisions];
    if (index === 0) {
      await page.evaluate(([event, data]) => { window.hostSocket.emit(event, data); }, [event, data]);
    } else {
      guestSocket.emit(event, data);
    }
    await waitForBroadcast(before);
  };
  try {
    await page.goto('/');
    const creatorKey = process.env.MAYOR_BROWSER_TEST_KEY;
    await page.locator('#candidateName').fill('네트워크 후보');
    await page.locator('#creatorKey').fill(creatorKey);
    await page.locator('#createBtn').click();
    await expect(page.locator('#game')).toBeVisible();
    await expect.poll(() => !!host).toBe(true);
    const joined = new Promise(resolve => guestSocket.once('roomJoined', (grant, acknowledge) => {
      resolve(grant);
      acknowledge();
    }));
    guestSocket.connect().emit('joinRoom', { code: host.code, inviteToken: host.inviteToken, name: '다른 세션' });
    const guest = await joined;
    expect(host.resumeToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(guest.resumeToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(new Set([host.inviteToken, host.resumeToken, guest.resumeToken]).size).toBe(3);
    await expect.poll(() => states.every(state => state?.players.length === 2)).toBe(true);
    for (const state of states) {
      const payload = JSON.stringify(state);
      for (const secret of [creatorKey, host.inviteToken, host.resumeToken, guest.resumeToken]) {
        expect(payload.includes(secret)).toBe(false);
      }
    }
    await broadcast(0,'startGame');
    let bought=0,used=0;
    const locFor={C:'plaza',I:'shops',O:'tavern',E:'cityhall'};
    for(let guard=0;guard<160&&states[0].phase!=='finished'&&used<2;guard++) {
      const state=states[0];
      if(state.phase.endsWith('Choose')) {
        const cheapest=[...state.market].sort((a,b)=>Object.values(a.card.cost).reduce((s,n)=>s+n,0)-Object.values(b.card.cost).reduce((s,n)=>s+n,0))[0];
        const need=Object.entries(cheapest.card.cost).find(([r,n])=>state.me.resources[r]<n)?.[0]||'C';
        // A disconnected player may already have an automatic plaza choice in this phase.
        if (!state.me.chosen) await broadcast(0,'chooseLocation',{location:locFor[need]});
        if (states[1].phase === state.phase && !states[1].me.chosen) {
          await broadcast(1,'chooseLocation',{location:'plaza'});
        }
      } else {
        const i=state.actionPlayer.id===state.me.id?0:1, current=states[i];
        if(current.phase==='nightActions'&&!current.me.nightBought) {
          const card=i===0&&current.me.hand.length<4&&current.market.find(m=>Object.entries(m.card.cost).every(([r,n])=>current.me.resources[r]>=n));
          const previous={...current.me.resources};
          if (card) {
            const before = [...revisions];
            await page.locator(`#market [data-card="${card.instanceId}"]`).click();
            await page.locator('#confirmCard').click();
            await waitForBroadcast(before);
          } else {
            await broadcast(i, 'nightPurchase');
          }
          if(card){
            bought++;
            for(const r of ['C','I','O','E'])expect(states[0].me.resources[r]).toBe(previous[r]-(card.card.cost[r]||0));
            expect(states[0].me.hand.some(c=>c.instanceId===card.instanceId)).toBe(true);
            expect(states[1].me.hand).toEqual([]);
            expect(states[1].players[0].hand).toBeUndefined();
            expect(states[1].players[0].handCount).toBe(states[0].me.hand.length);
            if (bought === 1) {
              const { id, hand, resources } = states[0].me;
              const seats = states[0].players.map(p => p.id);
              const beforeReload = revisions[0];
              await page.reload();
              await expect(page.locator('#game')).toBeVisible();
              await expect(page.locator(`#hand [data-card="${card.instanceId}"]`)).toBeVisible();
              await expect.poll(() => revisions[0]).toBeGreaterThan(beforeReload);
              expect(states[0].me.id).toBe(id);
              expect(states[0].me.hand).toEqual(hand);
              expect(states[0].me.resources).toEqual(resources);
              expect(states[0].players.map(p => p.id)).toEqual(seats);
              await expect(page.locator('#playerCount')).toHaveText('2 / 6명');
            }
          }
        } else {
          const timing=current.phase==='dayActions'?'day':'night';
          const card=i===0&&current.me.hand.find(c=>c.card.timing===timing&&c.usableFromTurn<=current.turn);
          const event=timing==='day'?'dayAction':'nightAction';
          await broadcast(i,event,card?{cardInstanceId:card.instanceId,targetId:states[1].me.id,resourceType:'C',marketInstanceId:current.market[0].instanceId}:{});
          if(card){used++;expect(states[0].me.hand.some(c=>c.instanceId===card.instanceId)).toBe(false)}
        }
      }
    }
    expect(bought).toBeGreaterThanOrEqual(1); expect(used).toBeGreaterThanOrEqual(1);
  } finally { guestSocket.disconnect(); }
});
