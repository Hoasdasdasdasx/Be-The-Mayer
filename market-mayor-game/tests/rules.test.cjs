const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHarness } = require('./server-harness.cjs');

for (const max of [6, 10]) test(`${max}인 방, 모든 장소 정원·우선권·비공개 선택`, () => {
  for (const [loc, resource, capacity] of [['plaza', 'C', max], ['shops', 'I', max === 6 ? 2 : 4], ['tavern', 'O', max === 6 ? 2 : 3], ['cityhall', 'E', max === 6 ? 1 : 2]]) {
    const h = createHarness(), { clients, room } = h.room(max, max);
    assert.equal(room.market.length, max === 6 ? 4 : 5);
    clients[0].send('startGame'); room.turn = 2;
    clients[0].send('chooseLocation', { location: loc });
    assert.equal(clients[1].state.players[0].chosen, null);
    clients.slice(1).forEach(s => s.send('chooseLocation', { location: loc }));
    assert.equal(room.phase, 'dayActions');
    assert.equal(room.actionOrder[0], room.players[1].id);
    const order = [...room.players.slice(1), room.players[0]];
    order.forEach((p, i) => {
      assert.equal(h.points(p), 1);
      assert.equal(p.resources[i < capacity ? resource : 'C'], 1);
    });
    if (loc === 'plaza') assert.equal(clients[0].state.locations.plaza.capacity, null);
  }
});

test('최소 인원, 구매 부족, 한도 4장, 중복 구매와 비공개 손패', () => {
  const h = createHarness(), { clients, room } = h.room(6, 1), owner = clients[0];
  owner.send('startGame'); assert.equal(room.phase, 'lobby');
  const guest = h.client(); guest.send('joinRoom', { code: room.code }); owner.send('startGame');
  h.startActions(room, 'night');
  const p = room.players[0], inst = room.market[0], c = h.CARDS.find(c => c.id === inst.cardId);
  owner.send('nightPurchase', { cardInstanceId: inst.instanceId });
  assert.equal(p.hand.length, 0); assert.equal(owner.messages.at(-1).event, 'notice');
  Object.assign(p.resources, { C: 20, I: 20, O: 20, E: 20 });
  owner.send('nightPurchase', { cardInstanceId: inst.instanceId });
  owner.send('nightPurchase', { cardInstanceId: inst.instanceId });
  assert.equal(p.hand.length, 1);
  for (const r of ['C','I','O','E']) assert.equal(p.resources[r], 20 - (c.cost[r] || 0));
  assert.equal(guest.state.players[0].handCount, 1); assert.equal(guest.state.players[0].hand, undefined); assert.equal(guest.state.me.hand.length, 0);
  p.hand = Array.from({ length: 4 }, (_, i) => ({ instanceId: `full-${i}`, cardId: c.id, usableFromTurn: 1 })); p.nightBought = false;
  owner.send('nightPurchase', { cardInstanceId: room.market[0].instanceId });
  assert.equal(p.hand.length, 4); assert.match(owner.messages.at(-1).data.message, /최대 4장/);
});

const definitions = createHarness().CARDS;
for (const definition of definitions) test(`특수 카드 효과·타이밍·중복 방지: ${definition.name}`, () => {
  const h = createHarness(), { clients, room } = h.room(), [actor, victim] = room.players;
  clients[0].send('startGame');
  Object.assign(actor.resources, { C: 5, I: 5, O: 5, E: 5 });
  Object.assign(victim.resources, { C: 6, I: 6, O: 6, E: 6 });
  const inst = { instanceId: 'test-card', cardId: definition.id, usableFromTurn: 1 };
  actor.hand.push(inst); h.startActions(room, definition.timing); actor.nightBought = true;
  const event = definition.timing === 'day' ? 'dayAction' : 'nightAction';
  const targetMarket = room.market[0].instanceId;
  const payload = { cardInstanceId: inst.instanceId, targetId: victim.id, resourceType: 'C', marketInstanceId: targetMarket };
  clients[0].send(event, payload);
  assert.equal(actor.hand.some(i => i.instanceId === inst.instanceId), false);
  assert.equal(room.discard.filter(i => i.instanceId === inst.instanceId).length, 1);
  assert.equal(room.actionIndex, 1);
  const after = JSON.stringify([actor.resources, victim.resources, actor.hand]);
  clients[0].send(event, payload);
  assert.equal(JSON.stringify([actor.resources, victim.resources, actor.hand]), after);
  switch (definition.effect) {
    case 'gain': for (const [r,n] of Object.entries(definition.gain)) assert.equal(actor.resources[r], 5+n); break;
    case 'appeal': assert.equal(actor.resources.C, 10); break;
    case 'steal': assert.equal(h.points(actor), 20 + definition.stealMax); assert.equal(h.points(victim), 24 - definition.stealMax); break;
    case 'destroy': assert.equal(h.points(victim), 24-definition.stealMax); break;
    case 'protect': assert.equal(actor.protectCharges, 1); break;
    case 'rumor': assert.equal(victim.resources.C, 4); assert.equal(actor.resources.C, 6); break;
    case 'closeCityhall': assert.equal(room.cityhallClosedTurn, 2); break;
    case 'discardMarket': assert.equal(room.market.some(i=>i.instanceId===targetMarket), false); assert.equal(room.market.length, 4); break;
    case 'takeMarket': assert.equal(actor.hand[0].instanceId, targetMarket); assert.equal(actor.hand[0].usableFromTurn, 2); break;
    default: assert.fail('새 효과에 대한 검증을 추가하세요');
  }
});

test('사용 시점 제한, 보호 효과, 폐쇄 시청 대체 자원', () => {
  const h = createHarness(), { clients, room } = h.room(); clients[0].send('startGame');
  const actor = room.players[0]; h.startActions(room, 'day');
  actor.hand.push({ instanceId: 'future', cardId: 'campaign', usableFromTurn: 2 });
  clients[0].send('dayAction', { cardInstanceId: 'future' }); assert.equal(actor.hand.length, 1); assert.equal(room.actionIndex, 0);
  actor.hand[0] = { instanceId: 'night', cardId: 'pickpocket', usableFromTurn: 1 };
  clients[0].send('dayAction', { cardInstanceId: 'night' }); assert.equal(actor.hand.length, 1);
  h.startActions(room, 'night'); actor.nightBought = true; room.players[1].resources.C = 5; room.players[1].protectCharges = 1;
  clients[0].send('nightAction', { cardInstanceId: 'night', targetId: room.players[1].id });
  assert.equal(room.players[1].resources.C, 5); assert.equal(room.players[1].protectCharges, 0);
  room.phase = 'dayChoose'; room.cityhallClosedTurn = 1;
  clients.forEach(s => s.send('chooseLocation', { location: 'cityhall' }));
  assert.equal(room.players[0].resources.C, 1); assert.equal(room.players[0].resources.E, 0);
});

test('10턴 낮·밤·구매 건너뛰기와 공동 승리', () => {
  const h = createHarness(), { clients, room } = h.room(); clients[0].send('startGame');
  for (let turn = 1; turn <= 10; turn++) {
    assert.equal(room.turn, turn);
    for (const kind of ['day', 'night']) {
      clients.forEach(s => s.send('chooseLocation', { location: 'plaza' }));
      for (let i = 0; i < 2; i++) {
        const s = clients.find(s => s.data.playerId === room.actionOrder[room.actionIndex]);
        if (kind === 'night') s.send('nightPurchase', {});
        s.send(kind === 'day' ? 'dayAction' : 'nightAction', {});
      }
    }
  }
  assert.equal(room.phase, 'finished'); assert.equal(room.winner.length, 2);
  room.players.forEach(p => assert.equal(h.points(p), 20));
});

test('연결 해제 자동 진행과 기존 후보로 재접속', () => {
  const h = createHarness(), { clients, room } = h.room(); clients[0].send('startGame');
  clients[0].send('disconnect'); assert.equal(room.players[0].connected, false);
  clients[1].send('chooseLocation', { location: 'plaza' });
  assert.equal(room.actionOrder[room.actionIndex], room.players[1].id);
  const returning = h.client(); returning.send('joinRoom', { code: room.code, playerId: room.players[0].id });
  assert.equal(room.players.length, 2); assert.equal(room.players[0].connected, true);
});
