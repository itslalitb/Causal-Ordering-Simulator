/* ============================================================
   CAUSAL ORDERING SIMULATOR — script.js
   Lamport Logical Clock engine + DOM/SVG visualiser
   ============================================================ */

'use strict';

/* ─────────────────────────────────────────────
   CONSTANTS
───────────────────────────────────────────── */
const PROCS = [
  { id: 0, name: 'P1', color: '#58a6ff' },
  { id: 1, name: 'P2', color: '#3fb950' },
  { id: 2, name: 'P3', color: '#f0883e' },
];

const TYPE_ICONS = { internal: '●', send: '↑', receive: '↓' };

const COL_W   = 110;   // px — matches CSS --col-w
const LANE_H  = 80;    // px — matches CSS --lane-h
const NODE_R  = 22;    // px — half of --node-size

/* ─────────────────────────────────────────────
   STATE
───────────────────────────────────────────── */
const state = {
  clocks:    [0, 0, 0],          // Lamport clock per process
  queue:     [],                 // all events added (pending + executed)
  executed:  [],                 // events stepped through so far
  step:      0,                  // index into queue
  evCounter: 0,                  // global event id counter
};

/* ─────────────────────────────────────────────
   DOM REFERENCES
───────────────────────────────────────────── */
const $ = id => document.getElementById(id);

const dom = {
  selType:      () => $('sel-event-type'),
  selSender:    () => $('sel-sender'),
  selReceiver:  () => $('sel-receiver'),
  receiverWrap: () => $('receiver-wrap'),
  inpLabel:     () => $('inp-label'),
  btnAdd:       () => $('btn-add'),
  btnStep:      () => $('btn-step'),
  btnRun:       () => $('btn-run'),
  btnReset:     () => $('btn-reset'),
  queueInfo:    () => $('queue-info'),
  logBody:      () => $('log-body'),
  logCount:     () => $('log-count'),
  tablebody:    () => $('table-body'),
  lanes:        [() => $('lane-0'), () => $('lane-1'), () => $('lane-2')],
  arrowSvg:     () => $('arrow-svg'),
  laneBody:     () => $('lane-body'),
  clockVals:    [() => $('cv-p1'), () => $('cv-p2'), () => $('cv-p3')],
  clockCards:   [() => $('clock-p1'), () => $('clock-p2'), () => $('clock-p3')],
};

/* ─────────────────────────────────────────────
   LAMPORT CLOCK RULES
───────────────────────────────────────────── */

/** Rule 1 / 2 — internal or send: local clock + 1 */
function tickClock(p) {
  state.clocks[p] += 1;
  return state.clocks[p];
}

/** Rule 3 — receive: max(local, received) + 1 */
function mergeClock(p, received) {
  state.clocks[p] = Math.max(state.clocks[p], received) + 1;
  return state.clocks[p];
}

/* ─────────────────────────────────────────────
   ADD EVENT TO QUEUE
───────────────────────────────────────────── */
function addEvent() {
  const type       = dom.selType().value;
  const senderIdx  = parseInt(dom.selSender().value, 10);
  const recvIdx    = parseInt(dom.selReceiver().value, 10);
  const rawLabel   = dom.inpLabel().value.trim();
  const label      = rawLabel || (type === 'internal' ? 'Event' : 'Msg');

  if (type === 'send' && senderIdx === recvIdx) {
    toast('Sender and receiver must be different.', 'error');
    return;
  }

  /* ── create send / internal event ── */
  const ev = {
    id:           ++state.evCounter,
    evLabel:      `E${state.evCounter}`,   // E1, E2 …
    type,
    processIdx:   senderIdx,
    label,
    clock:        null,
    predecessor:  null,   // id of causal predecessor event
    nodeEl:       null,   // DOM element (assigned on render)
  };
  state.queue.push(ev);

  /* ── for send, also queue the paired receive ── */
  if (type === 'send') {
    const recvEv = {
      id:           ++state.evCounter,
      evLabel:      `E${state.evCounter}`,
      type:         'receive',
      processIdx:   recvIdx,
      label:        `from ${PROCS[senderIdx].name}`,
      clock:        null,
      predecessor:  null,
      linkedSendId: ev.id,
      nodeEl:       null,
    };
    state.queue.push(recvEv);
    ev.linkedRecvId = recvEv.id;
  }

  dom.inpLabel().value = '';
  renderPendingNodes();
  updateQueueInfo();
  toast(`Queued: ${PROCS[senderIdx].name} — ${label}`, 'ok');
}

/* ─────────────────────────────────────────────
   RENDER PENDING (grey) NODES  into timeline
───────────────────────────────────────────── */
function renderPendingNodes() {
  /* Clear lanes — we will re-append all nodes in queue order */
  PROCS.forEach((_, i) => { dom.lanes[i]().innerHTML = ''; });

  state.queue.forEach(ev => {
    if (ev.nodeEl) {
      /* node already exists — just re-attach it in order */
      dom.lanes[ev.processIdx]().appendChild(ev.nodeEl);
      return;
    }

    /* create a new pending node */
    const node = document.createElement('div');
    node.className    = 'ev-node pending';
    node.dataset.proc = ev.processIdx;
    node.dataset.evId = ev.id;

    const idSpan = document.createElement('span');
    idSpan.className   = 'node-id';
    idSpan.textContent = ev.evLabel;

    const clockSpan = document.createElement('span');
    clockSpan.className   = 'node-clock';
    clockSpan.textContent = '';

    const lbl = document.createElement('span');
    lbl.className   = 'node-label';
    lbl.textContent = ev.label;

    node.appendChild(idSpan);
    node.appendChild(clockSpan);
    node.appendChild(lbl);

    dom.lanes[ev.processIdx]().appendChild(node);
    ev.nodeEl = node;
  });

  resizeArrowSvg();
}

/* ─────────────────────────────────────────────
   STEP FORWARD  (core simulation)
───────────────────────────────────────────── */
function stepForward() {
  if (state.step >= state.queue.length) {
    toast('All events have been executed.', 'info');
    return;
  }

  const ev = state.queue[state.step];

  /* ── Compute Lamport clock ── */
  if (ev.type === 'internal') {
    ev.clock      = tickClock(ev.processIdx);
    ev.predecessor = localPredecessor(ev);

  } else if (ev.type === 'send') {
    ev.clock      = tickClock(ev.processIdx);
    ev.predecessor = localPredecessor(ev);

  } else if (ev.type === 'receive') {
    const sendEv   = state.queue.find(e => e.id === ev.linkedSendId);
    const sentT    = (sendEv && sendEv.clock !== null) ? sendEv.clock : 0;
    ev.clock       = mergeClock(ev.processIdx, sentT);
    ev.predecessor = sendEv ? sendEv.id : null;
  }

  state.executed.push(ev);
  state.step++;

  /* ── Update DOM ── */
  activateNode(ev);
  updateClockDisplay(ev.processIdx);
  appendLogRow(ev);
  appendTableRow(ev);
  if (ev.type === 'receive') drawArrow(ev);
  updateQueueInfo();

  if (state.step >= state.queue.length) {
    toast('Simulation complete ✓', 'info');
  }
}

/* run all remaining */
function runAll() {
  if (state.step >= state.queue.length) {
    toast('All events already executed.', 'info');
    return;
  }
  while (state.step < state.queue.length) stepForward();
}

/* ─────────────────────────────────────────────
   RESET
───────────────────────────────────────────── */
function resetSim() {
  state.clocks    = [0, 0, 0];
  state.queue     = [];
  state.executed  = [];
  state.step      = 0;
  state.evCounter = 0;

  /* clear lanes */
  PROCS.forEach((_, i) => { dom.lanes[i]().innerHTML = ''; });

  /* clear SVG arrows */
  const svg = dom.arrowSvg();
  [...svg.querySelectorAll('.msg-arrow, .arrow-path')].forEach(el => el.remove());

  /* clock display */
  dom.clockVals.forEach(fn => { fn().textContent = '0'; });

  /* log */
  dom.logBody().innerHTML = '<p class="log-empty">No events yet — add events above and run the simulation.</p>';
  dom.logCount().textContent = '0 events';

  /* table */
  dom.tablebody().innerHTML = '<tr class="empty-row"><td colspan="7">— no events executed yet —</td></tr>';

  updateQueueInfo();
  toast('Simulation reset.', 'ok');
}

/* ─────────────────────────────────────────────
   HELPERS — causal predecessor
───────────────────────────────────────────── */
function localPredecessor(ev) {
  /* last executed event on the same process before this one */
  const same = state.executed.filter(e => e.processIdx === ev.processIdx);
  return same.length ? same[same.length - 1].id : null;
}

/* ─────────────────────────────────────────────
   DOM UPDATE — activate node (pending → executed)
───────────────────────────────────────────── */
function activateNode(ev) {
  const node = ev.nodeEl;
  if (!node) return;

  node.classList.remove('pending');
  node.classList.add('executed');

  /* update inner clock text */
  const clockSpan = node.querySelector('.node-clock');
  if (clockSpan) clockSpan.textContent = `T=${ev.clock}`;

  /* receive badge */
  if (ev.type === 'receive') {
    const badge = document.createElement('span');
    badge.className   = 'node-recv-badge';
    badge.textContent = '←msg';
    node.appendChild(badge);
  }
}

/* ─────────────────────────────────────────────
   DOM UPDATE — clock sidebar cards
───────────────────────────────────────────── */
function updateClockDisplay(procIdx) {
  const val  = dom.clockVals[procIdx]();
  const card = dom.clockCards[procIdx]();
  val.textContent = state.clocks[procIdx];

  /* pulse animation */
  card.classList.remove('pulse');
  void card.offsetWidth;           // force reflow to restart animation
  card.classList.add('pulse');
}

/* ─────────────────────────────────────────────
   DOM UPDATE — event log
───────────────────────────────────────────── */
function appendLogRow(ev) {
  const body = dom.logBody();
  const empty = body.querySelector('.log-empty');
  if (empty) empty.remove();

  const proc = PROCS[ev.processIdx];
  const num  = state.executed.length;

  const row = document.createElement('div');
  row.className = `log-row type-${ev.type}`;

  row.innerHTML = `
    <span class="log-num">#${num}</span>
    <span class="log-icon" style="color:${proc.color}">${TYPE_ICONS[ev.type]}</span>
    <span class="log-msg">
      <strong style="color:${proc.color}">${proc.name}</strong>
      &nbsp;${ev.evLabel}: ${ev.label}
    </span>
    <span class="log-t">T = ${ev.clock}</span>
  `;

  body.appendChild(row);
  body.scrollTop = body.scrollHeight;

  dom.logCount().textContent = `${state.executed.length} event${state.executed.length !== 1 ? 's' : ''}`;
}

/* ─────────────────────────────────────────────
   DOM UPDATE — causal order table
───────────────────────────────────────────── */
function appendTableRow(ev) {
  const tbody = dom.tablebody();

  /* remove empty-row placeholder */
  const empty = tbody.querySelector('.empty-row');
  if (empty) empty.remove();

  const proc  = PROCS[ev.processIdx];
  const dotStyle = `--dot:${proc.color}`;

  const badgeMap = {
    internal: '<span class="badge b-internal">Internal</span>',
    send:     '<span class="badge b-send">Send</span>',
    receive:  '<span class="badge b-receive">Receive</span>',
  };

  /* causal predecessor label */
  let predHTML = '<span class="pred-none">—</span>';
  if (ev.predecessor !== null) {
    const predEv = state.executed.find(e => e.id === ev.predecessor);
    if (predEv) {
      const pProc = PROCS[predEv.processIdx];
      predHTML = `<span class="pred-val">${pProc.name}·${predEv.evLabel} (T=${predEv.clock})</span>`;
    }
  }

  const tr = document.createElement('tr');
  tr.className  = 'flash';
  tr.dataset.evId = ev.id;
  tr.innerHTML = `
    <td class="row-order">0</td>
    <td style="font-family:'Courier New',monospace;color:${proc.color}">${ev.evLabel}</td>
    <td>${ev.label}</td>
    <td><span class="p-dot" style="${dotStyle}">${proc.name}</span></td>
    <td>${badgeMap[ev.type]}</td>
    <td><span class="t-chip">${ev.clock}</span></td>
    <td>${predHTML}</td>
  `;

  tbody.appendChild(tr);
  resortTable();
}

/* re-sort all rows by clock value, renumber */
function resortTable() {
  const tbody = dom.tablebody();
  const rows  = [...tbody.querySelectorAll('tr[data-ev-id]')];

  rows.sort((a, b) => {
    const ta = parseInt(a.querySelector('.t-chip').textContent, 10);
    const tb = parseInt(b.querySelector('.t-chip').textContent, 10);
    if (ta !== tb) return ta - tb;
    return parseInt(a.dataset.evId) - parseInt(b.dataset.evId);
  });

  rows.forEach((r, i) => {
    r.querySelector('.row-order').textContent = i + 1;
    tbody.appendChild(r);
  });
}

/* ─────────────────────────────────────────────
   SVG — draw message arrow (send node → receive node)
───────────────────────────────────────────── */
function drawArrow(recvEv) {
  const sendEv = state.queue.find(e => e.id === recvEv.linkedSendId);
  if (!sendEv || !sendEv.nodeEl || !recvEv.nodeEl) return;

  resizeArrowSvg();   // ensure SVG viewport is up-to-date before measuring
  const svg      = dom.arrowSvg();
  const laneBody = dom.laneBody();
  const bodyRect = laneBody.getBoundingClientRect();

  const sRect = sendEv.nodeEl.getBoundingClientRect();
  const rRect = recvEv.nodeEl.getBoundingClientRect();

  /* centre points relative to lane-body */
  const x1 = sRect.left + sRect.width  / 2 - bodyRect.left + laneBody.scrollLeft;
  const y1 = sRect.top  + sRect.height / 2 - bodyRect.top;
  const x2 = rRect.left + rRect.width  / 2 - bodyRect.left + laneBody.scrollLeft;
  const y2 = rRect.top  + rRect.height / 2 - bodyRect.top;

  /* slight curve for same-x arrows */
  const dx = x2 - x1;
  const dy = y2 - y1;

  /* use a quadratic bezier with a horizontal offset for clarity */
  const cx = x1 + dx * 0.5 + (dy !== 0 ? 0 : 30);
  const cy = y1 + dy * 0.5 + (dx === 0 ? 0 : 0);

  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('class', 'msg-arrow');
  path.setAttribute('d', `M ${x1} ${y1} Q ${cx} ${cy} ${x2} ${y2}`);
  path.setAttribute('marker-end', 'url(#arrowhead)');

  svg.appendChild(path);
}

/* resize SVG to match lane-body dimensions */
function resizeArrowSvg() {
  const body = dom.laneBody();
  const svg  = dom.arrowSvg();
  const w    = body.scrollWidth;
  const h    = body.scrollHeight;
  svg.setAttribute('width',  w);
  svg.setAttribute('height', h);
  svg.style.width  = w + 'px';
  svg.style.height = h + 'px';
}

/* ─────────────────────────────────────────────
   UI HELPERS
───────────────────────────────────────────── */
function updateQueueInfo() {
  const pending = state.queue.length - state.step;
  dom.queueInfo().textContent =
    `Queue: ${pending} event${pending !== 1 ? 's' : ''} pending`;
}

/* ─────────────────────────────────────────────
   TOAST
───────────────────────────────────────────── */
let _toastTimer = null;

function toast(msg, type = 'ok') {
  let el = $('sim-toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'sim-toast';
    document.body.appendChild(el);
  }

  const styles = {
    ok:    { bg: '#3fb950', color: '#0d1117' },
    error: { bg: '#f85149', color: '#fff'    },
    info:  { bg: '#58a6ff', color: '#0d1117' },
  };
  const s = styles[type] || styles.ok;
  el.style.background = s.bg;
  el.style.color      = s.color;
  el.style.opacity    = '1';
  el.style.transform  = 'translateY(0)';
  el.textContent      = msg;

  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => {
    el.style.opacity   = '0';
    el.style.transform = 'translateY(8px)';
  }, 2500);
}

/* ─────────────────────────────────────────────
   RECEIVER DROPDOWN — keep in sync with sender
───────────────────────────────────────────── */
function syncReceiverOptions() {
  const sIdx   = parseInt(dom.selSender().value, 10);
  const recvEl = dom.selReceiver();
  const prev   = parseInt(recvEl.value, 10);

  recvEl.innerHTML = '';
  PROCS.forEach(p => {
    if (p.id !== sIdx) {
      const opt = new Option(p.name, p.id);
      recvEl.appendChild(opt);
    }
  });

  /* try to keep the same receiver if it's still valid */
  if (prev !== sIdx) {
    recvEl.value = prev;
    if (recvEl.value === '') recvEl.selectedIndex = 0;
  }
}

/* ─────────────────────────────────────────────
   BOOT — wire all listeners on DOMContentLoaded
───────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {

  /* ── event type toggle ── */
  dom.selType().addEventListener('change', () => {
    const isSend = dom.selType().value === 'send';
    dom.receiverWrap().classList.toggle('visible', isSend);
  });

  /* ── sender change → rebuild receiver list ── */
  dom.selSender().addEventListener('change', syncReceiverOptions);

  /* ── add event ── */
  dom.btnAdd().addEventListener('click', addEvent);
  dom.inpLabel().addEventListener('keydown', e => {
    if (e.key === 'Enter') addEvent();
  });

  /* ── simulation controls ── */
  dom.btnStep().addEventListener('click', stepForward);
  dom.btnRun().addEventListener('click', runAll);
  dom.btnReset().addEventListener('click', resetSim);

  /* ── keyboard shortcuts ── */
  document.addEventListener('keydown', e => {
    if (['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)) return;
    if (e.key === ' ' || e.key === 'ArrowRight') { e.preventDefault(); stepForward(); }
    if (e.key === 'Enter')                        { runAll(); }
    if (e.key === 'r' || e.key === 'R')           { resetSim(); }
  });

  /* ── resize SVG on window resize ── */
  window.addEventListener('resize', () => {
    resizeArrowSvg();
    /* redraw arrows */
    const svg = dom.arrowSvg();
    [...svg.querySelectorAll('.msg-arrow')].forEach(el => el.remove());
    state.executed
      .filter(e => e.type === 'receive')
      .forEach(e => drawArrow(e));
  });

  /* ── initial state ── */
  syncReceiverOptions();
  updateQueueInfo();
});
