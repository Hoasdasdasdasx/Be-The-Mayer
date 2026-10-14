// Presentation only. Card definitions always come from the server state.
export const resources = { C: '시민', I: '지식인', O: '조직원', E: '상류층' };
export const symbols = { C: '◉', I: '▤', O: '◆', E: '♜' };
export const phases = { lobby: '선거 캠프 대기실', dayChoose: '어디에서 지지를 모을까요?', dayActions: '당신의 정책을 펼칠 시간', nightChoose: '도시가 잠든 사이', nightActions: '다음 한 수를 준비하세요', finished: '새로운 시장이 탄생했습니다' };
export const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const costText = cost => Object.entries(cost || {}).filter(([, n]) => n > 0).map(([r, n]) => `${resources[r]} ${n}`).join(' + ') || '무료';
export const isActor = state => state?.actionPlayer?.id === state?.me?.id;

// Original geometric illustrations; no external image dependencies.
export function illustration(family = 'E', seed = '', location = false) {
  const variant = [...seed].reduce((n, ch) => n + ch.charCodeAt(0), 0) % 3;
  const skyline = Array.from({ length: 12 }, (_, i) => { const h = 23 + ((i * 37 + variant * 17) % 55); return `<path d="M${i * 25} 150v-${h}h20v${h}"/><path class="lit" d="M${i * 25 + 6} ${156 - h}v12m8-12v12"/>`; }).join('');
  const drawings = {
    C: '<path class="paper" d="M96 48h108v65H96z"/><path class="ink" d="M112 62h75m-75 12h48m-48 12h63"/><path class="accent-fill" d="m130 107 53-28v50l-53-13z"/><path class="outline" d="m137 117 5 18h12l-6-22"/><path class="crowd" d="M53 157v-18q12-17 24 0v18m9 0v-28q13-18 26 0v28m63 0v-25q13-18 26 0v25m10 0v-16q12-17 24 0v16"/><g class="accent-fill"><circle cx="65" cy="121" r="8"/><circle cx="99" cy="111" r="9"/><circle cx="188" cy="115" r="9"/><circle cx="223" cy="124" r="8"/></g>',
    I: '<path class="paper" d="M99 35h85l20 20v77H99z"/><path class="outline" d="M184 35v21h20"/><path class="ink" d="M113 58h52m-52 12h38m-38 12h72m-72 12h61"/><path class="accent-fill" d="M116 121v-12h11v12m9 0V97h11v24m9 0V83h11v38m9 0V73h11v48"/><path class="outline" d="M74 148h154M80 142v-37m-8-5q-10-27 2-29 13-2 10 27z"/>',
    O: '<path class="silhouette" d="M95 148q0-46 22-58h49q27 20 28 58z"/><circle class="silhouette" cx="141" cy="66" r="23"/><path class="accent-fill" d="m105 63 69-9-12-8-8-17-32 5-5 19z"/><path class="paper" d="m121 109 74-13 9 49-75 12z"/><path class="ink" d="m121 109 43 21 31-34"/><path class="outline" d="m65 81 15-15m129 2 14 13"/>',
    E: '<path class="paper" d="M104 140V46l48-24 48 24v94z"/><path class="accent-fill" d="M148 22h6v118h-6z"/><path class="ink" d="M115 55h23m-23 14h23m-23 14h23m-23 14h23m-23 14h23m26-56h24m-24 14h24m-24 14h24m-24 14h24m-24 14h24"/><path class="silhouette" d="M65 146v-38l30-13v51m112 0V94l28 15v37"/><path class="outline" d="M57 149h187"/>'
  };
  const townhall = '<path class="paper" d="m69 78 81-43 81 43zM82 86h136v58H82z"/><path class="ink" d="M91 139V91m27 48V91m32 48V91m32 48V91m27 48V91"/><path class="accent-fill" d="M66 147h169v7H66zM150 20v22m0-22h22v12h-22"/>';
  return `<svg class="art art-${family}" viewBox="0 0 300 170" aria-hidden="true" focusable="false"><circle class="sun" cx="217" cy="52" r="35"/><g class="skyline">${skyline}</g><path class="rays" d="M0 166 300 20M0 126 300 0M25 170 300 60"/>${location && family === 'E' ? townhall : drawings[family] || drawings.E}<path class="ground" d="M0 157h300M0 162h300"/><text x="14" y="23" class="art-index">${location ? '도시 구역' : '선거 기록'} / 0${variant + 1}</text></svg>`;
}
export function useReason(state, inst, connected = true) {
  if (!connected) return '서버에 다시 연결 중입니다';
  if (!['dayActions', 'nightActions'].includes(state.phase)) return '카드 행동 단계에 사용합니다';
  if (!isActor(state)) return `${state.actionPlayer?.name || '다른 후보'}님의 차례입니다`;
  if (state.phase === 'nightActions' && !state.me.nightBought) return '구매를 먼저 완료하거나 건너뛰세요';
  if (inst.usableFromTurn > state.turn) return `${inst.usableFromTurn}턴부터 사용 가능`;
  if (inst.card.timing !== (state.phase === 'dayActions' ? 'day' : 'night')) return `${inst.card.timing === 'day' ? '낮' : '밤'} 행동에 사용 가능`;
  return '';
}
export function purchaseReason(state, inst, connected = true) {
  if (!connected) return '서버에 다시 연결 중입니다';
  if (state.phase !== 'nightActions') return '밤 구매 단계에 구매 가능';
  if (!isActor(state)) return `${state.actionPlayer?.name || '다른 후보'}님의 차례입니다`;
  if (state.me.nightBought) return '이번 밤 구매를 완료했습니다';
  if (state.me.hand.length >= 4) return '손패 한도 4장에 도달했습니다';
  const missing = Object.entries(inst.card.cost).filter(([r, n]) => state.me.resources[r] < n).map(([r, n]) => `${resources[r]} ${n - state.me.resources[r]}`);
  return missing.length ? `${missing.join(' + ')} 부족` : '';
}
export function cardMarkup(inst, { source = 'hand', selected = false, reason = '', index = 0, total = 1 } = {}) {
  const c = inst.card;
  return `<button type="button" class="game-card family-${escapeHtml(c.family)} ${reason ? 'unavailable' : 'playable'} ${selected ? 'selected' : ''}" data-card="${escapeHtml(inst.instanceId)}" data-source="${source}" aria-pressed="${selected}" aria-label="${escapeHtml(c.name)}, ${escapeHtml(reason || (source === 'market' ? '구매 가능' : '사용 가능'))}. 상세 보기" style="--tilt:${(index - (total - 1) / 2) * 3}deg;--lift:${Math.abs(index - (total - 1) / 2) * 5}px"><span class="card-meta"><span>${symbols[c.family] || ''} ${resources[c.family] || ''}</span><span>${c.timing === 'day' ? '☀ 낮' : '☾ 밤'}</span></span><span class="card-name">${escapeHtml(c.name)}</span><span class="card-art">${illustration(c.family, c.id)}</span><span class="card-description">${escapeHtml(c.desc)}</span><span class="card-cost"><small>구매 비용</small> ${escapeHtml(costText(c.cost))}</span><span class="card-status">${escapeHtml(reason || (source === 'market' ? '구매 가능 · 눌러서 검토' : '사용 가능 · 눌러서 선택'))}</span></button>`;
}
export function playerMarkup(p, state) {
  const me = p.id === state.me.id, active = p.id === state.actionPlayer?.id && /Actions$/.test(state.phase);
  return `<article class="candidate ${me ? 'self' : ''} ${active ? 'active' : ''}" aria-label="${escapeHtml(p.name)}${active ? ', 현재 행동 중' : ''}"><div class="candidate-top"><span class="avatar" aria-hidden="true">${escapeHtml(p.name.slice(0, 1))}</span><div class="candidate-name"><b>${escapeHtml(p.name)}</b><span>${me ? '내 후보 · ' : ''}${p.id === state.hostId ? '방장 · ' : ''}${p.connected ? '접속 중' : '연결 끊김'}</span></div><span class="candidate-score">${p.score}<small>지지도</small></span></div><div class="resource-row">${Object.entries(resources).map(([r, name]) => `<span class="text-${r}" title="${name}" aria-label="${name} ${p.resources[r]}">${symbols[r]} ${p.resources[r]}</span>`).join('')}</div><div class="candidate-foot"><span>특수 카드 ${p.handCount}장</span><span>${p.protected ? '◈ 강탈 보호' : active ? '● 행동 중' : ''}</span></div></article>`;
}

export function emptyHandMarkup() {
  return `<div class="hand-empty"><div class="hand-slots" aria-hidden="true">${Array.from({ length: 4 }, (_, i) => `<span class="vacant-card" style="--slot-tilt:${(i - 1.5) * 4}deg"><span class="slot-emblem">♜</span><small>0${i + 1}</small></span>`).join('')}</div><div class="hand-empty-copy"><b>아직 꺼내지 않은 당신의 한 수</b><span>밤에 공개 시장에서 특수 카드를 확보하세요.</span></div></div>`;
}
