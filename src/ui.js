// DOM-Oberfläche: Statusleiste, Werkzeugleiste, Info-Panel, Dialoge, Zwitscher-Feed und Aufgaben.
import {
  ROAD_TYPES, ZONES, SERVICES, MILESTONES, EXPENSE_CATS, TREE_COST,
} from './config.js';
import { fmt, fmt1, fmtMoney, fmtSigned, clamp } from './util.js';
import { VIEWS } from './render/overlay.js';
import { saveInfo } from './save.js';
import { CITY_NAMES } from './names.js';

const CATEGORIES = [
  { id: 'roads', icon: '🛣️', name: 'Straßen', items: [1, 2, 3].map((t) => ({ kind: 'road', type: t })) },
  { id: 'zones', icon: '🏘️', name: 'Zonen', items: [1, 2, 3, 4, 5, 6, 0].map((z) => ({ kind: 'zone', zone: z })) },
  { id: 'power', icon: '⚡', name: 'Strom', items: ['wind', 'coal', 'solar'].map((d) => ({ kind: 'service', def: d })) },
  { id: 'water', icon: '💧', name: 'Wasser', items: ['pump', 'outlet', 'tower', 'treatment'].map((d) => ({ kind: 'service', def: d })) },
  { id: 'transit', icon: '🚌', name: 'Nahverkehr', items: ['busstop', 'busdepot'].map((d) => ({ kind: 'service', def: d })) },
  { id: 'services', icon: '🏛️', name: 'Dienste', items: ['police', 'fire', 'clinic', 'school', 'landfill', 'highschool', 'incinerator', 'hospital', 'policehq', 'university'].map((d) => ({ kind: 'service', def: d })) },
  { id: 'parks', icon: '🌳', name: 'Parks', items: [{ kind: 'tree' }, ...['park', 'playground', 'plaza', 'citypark', 'cityhall', 'stadium', 'tvtower'].map((d) => ({ kind: 'service', def: d }))] },
];

const TASKS = [
  { id: 'road', text: 'Baue eine Straße an die Autobahn (🛣️ Straßen)' },
  { id: 'res', text: 'Weise ein Wohngebiet aus (🏘️ Zonen)' },
  { id: 'ci', text: 'Weise Gewerbe und Industrie aus' },
  { id: 'power', text: 'Baue ein Windrad an einer Straße (⚡)' },
  { id: 'water', text: 'Baue eine Wasserpumpe am Ufer (💧)' },
  { id: 'sewage', text: 'Baue einen Abwasserauslass am Ufer' },
  { id: 'pop', text: 'Erreiche 200 Einwohner' },
];

function itemInfo(spec) {
  if (spec.kind === 'road') {
    const r = ROAD_TYPES[spec.type];
    return { icon: r.icon, name: r.name, cost: r.cost, unit: '/8 m', upkeep: r.upkeep, desc: r.desc, unlock: r.unlock };
  }
  if (spec.kind === 'zone') {
    if (!spec.zone) return { icon: '🧽', name: 'Zonen entfernen', cost: 0, desc: 'Entfernt Zonen mit Pinsel oder Füllen.', unlock: 0, color: '#ff6b6b' };
    const z = ZONES[spec.zone];
    return { icon: z.icon, name: z.name, cost: 0, desc: z.desc, unlock: z.unlock, color: '#' + z.color.toString(16).padStart(6, '0') };
  }
  if (spec.kind === 'tree') return { icon: '🌲', name: 'Bäume pflanzen', cost: TREE_COST, unit: '/Baum', desc: 'Bäume filtern Verschmutzung und sehen schön aus.', unlock: 0 };
  if (spec.kind === 'bulldoze') return { icon: '🚜', name: 'Abriss', desc: '', unlock: 0 };
  const s = SERVICES[spec.def];
  return { icon: s.icon, name: s.name, cost: s.cost, upkeep: s.upkeep, desc: s.desc || '', unlock: s.unlock, size: `${s.w}×${s.h}` };
}

const sameSpec = (a, b) => a && b && a.kind === b.kind && a.type === b.type && a.zone === b.zone && a.def === b.def;
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export class UI {
  constructor(game) {
    this.g = game;
    this.cat = null;
    this.toolSpec = null;
    this.infoB = null;
    this.infoRoad = -1;
    this.lastMilestone = -1;
    this.buildToolbar();
    this.bind();
  }

  // ------------------------------------------------------------ Aufbau
  buildToolbar() {
    const tb = $('toolbar');
    tb.innerHTML = '';
    for (const c of CATEGORIES) {
      const b = document.createElement('button');
      b.className = 'cat';
      b.dataset.cat = c.id;
      b.innerHTML = `<span class="ico">${c.icon}</span><span class="lbl">${c.name}</span>`;
      b.onclick = () => { this.g.sound.click(); this.openCategory(this.cat === c.id ? null : c.id); };
      tb.appendChild(b);
    }
    const bd = document.createElement('button');
    bd.className = 'cat danger';
    bd.dataset.cat = 'bulldoze';
    bd.innerHTML = '<span class="ico">🚜</span><span class="lbl">Abriss</span>';
    bd.onclick = () => {
      this.g.sound.click();
      this.openCategory(null);
      this.selectTool(this.toolSpec && this.toolSpec.kind === 'bulldoze' ? null : { kind: 'bulldoze' });
    };
    tb.appendChild(bd);
  }

  bind() {
    $('btnMenu').onclick = () => { this.g.sound.click(); this.showMenu(); };
    $('btnBudget').onclick = () => { this.g.sound.click(); this.showBudget('budget'); };
    $('statPop').onclick = () => this.showBudget('stats');
    $('statMoney').onclick = () => this.showBudget('budget');
    $('statHappy').onclick = () => this.showBudget('stats');
    $('rci').onclick = () => this.showDemandHelp();
    for (const b of document.querySelectorAll('#speed button')) {
      b.onclick = () => { this.g.sound.click(); this.g.setSpeed(Number(b.dataset.speed)); };
    }
    $('btnUndo').onclick = () => this.g.undo();
    $('btnViews').onclick = () => { this.g.sound.click(); this.toggleViews(); };
    $('btnRotL').onclick = () => this.g.camera.rotateBy(Math.PI / 4);
    $('btnRotR').onclick = () => this.g.camera.rotateBy(-Math.PI / 4);
    $('btnTiltUp').onclick = () => this.g.camera.tiltBy(0.15);
    $('btnTiltDown').onclick = () => this.g.camera.tiltBy(-0.15);
    $('btnZoomIn').onclick = () => this.g.camera.zoomBy(0.75);
    $('btnZoomOut').onclick = () => this.g.camera.zoomBy(1.33);
    $('hintClose').onclick = () => this.selectTool(null);
    $('cfOk').onclick = () => this.g.pending && this.g.pending.confirm();
    $('cfRot').onclick = () => this.g.pending && this.g.pending.rotate();
    $('cfNo').onclick = () => { this.positionConfirm(null); this.g.pending = null; this.g.preview.clear(); this.setCursorLabel(null); };
    $('tasksHead').onclick = () => $('tasks').classList.toggle('collapsed');
    $('legendClose').onclick = () => this.setView(null);
  }

  // ------------------------------------------------------------ Werkzeuge
  openCategory(id) {
    this.cat = id;
    for (const b of document.querySelectorAll('#toolbar .cat')) b.classList.toggle('open', b.dataset.cat === id);
    const sp = $('subpanel');
    document.body.classList.toggle('sub-open', !!id);
    if (!id) { sp.classList.remove('show'); return; }
    this.renderSubpanel();
    sp.classList.add('show');
    $('viewsPanel').classList.remove('show');
  }

  renderSubpanel() {
    const c = CATEGORIES.find((k) => k.id === this.cat);
    if (!c) return;
    const sp = $('subpanel');
    const ms = this.g.sim.milestone;
    sp.innerHTML = `<div class="sp-title">${c.icon} ${c.name}</div><div class="sp-items"></div>`;
    const wrap = sp.querySelector('.sp-items');
    for (const spec of c.items) {
      const info = itemInfo(spec);
      const locked = info.unlock > ms;
      const el = document.createElement('button');
      el.className = 'item' + (locked ? ' locked' : '') + (sameSpec(spec, this.toolSpec) ? ' active' : '');
      const cost = info.cost ? `${fmtMoney(info.cost)}${info.unit || ''}` : spec.kind === 'zone' ? 'kostenlos' : '';
      const upkeep = info.upkeep ? `<span class="upk">${fmtMoney(info.upkeep)}${spec.kind === 'road' ? '/8 m' : ''}/Mon.</span>` : '';
      const unique = spec.kind === 'service' && SERVICES[spec.def].unique && this.g.world.unique[spec.def] !== undefined;
      el.innerHTML = `
        <span class="it-ico" ${info.color ? `style="background:${info.color}33;border-color:${info.color}"` : ''}>${info.icon}</span>
        <span class="it-name">${info.name}</span>
        <span class="it-cost">${locked ? `🔒 ab ${fmt(MILESTONES[info.unlock].pop)} Einw.` : unique ? '✔ gebaut' : cost}</span>
        ${!locked && upkeep ? upkeep : ''}
        ${info.size ? `<span class="it-size">${info.size}</span>` : ''}`;
      el.title = info.desc || '';
      el.onclick = () => {
        if (locked) { this.toast(`🔒 ${info.name} wird mit „${MILESTONES[info.unlock].name}“ (${fmt(MILESTONES[info.unlock].pop)} Einwohner) freigeschaltet.`, 'info'); this.g.sound.error(); return; }
        this.g.sound.click();
        this.selectTool(sameSpec(spec, this.toolSpec) ? null : spec);
        this.showItemDesc(info);
      };
      wrap.appendChild(el);
    }
  }

  showItemDesc(info) {
    if (!info.desc) return;
    const d = $('itemDesc');
    d.textContent = info.desc;
    d.classList.add('show');
    clearTimeout(this.descT);
    this.descT = setTimeout(() => d.classList.remove('show'), 3500);
  }

  selectTool(spec) {
    if (spec && spec.kind === 'service' && SERVICES[spec.def].unique && this.g.world.unique[spec.def] !== undefined) {
      this.toast('Dieses Gebäude gibt es nur einmal pro Stadt.', 'info');
      return;
    }
    this.toolSpec = spec;
    this.g.setTool(spec);
    for (const b of document.querySelectorAll('#toolbar .cat')) b.classList.toggle('active', !!spec && spec.kind === 'bulldoze' && b.dataset.cat === 'bulldoze');
    if (this.cat) this.renderSubpanel();
    const hint = $('hint');
    if (spec && this.g.tool) {
      this.renderHint();
      hint.classList.add('show');
      this.closeInfo();
    } else hint.classList.remove('show');
    if (!spec) { this.setCursorLabel(null); this.positionConfirm(null); }
  }

  // Hinweistext und Bauweisen des aktiven Werkzeugs (z. B. Freihand / Gerade / Kurve)
  renderHint() {
    const tool = this.g.tool;
    if (!tool) return;
    $('hintText').textContent = tool.hint;
    const box = $('hintModes');
    const modes = tool.modes;
    box.innerHTML = '';
    box.classList.toggle('hidden', !modes);
    if (!modes) return;
    for (const m of modes) {
      const b = document.createElement('button');
      b.className = 'mode' + (m.id === tool.mode ? ' active' : '');
      b.innerHTML = `<span>${m.icon}</span>${m.label}`;
      b.onclick = () => {
        this.g.sound.click();
        this.g.setToolMode(m.id);
        this.renderHint();
      };
      box.appendChild(b);
    }
  }

  setCursorLabel(text, bad = false) {
    const el = $('cursorLabel');
    if (!text) { el.classList.remove('show'); return; }
    el.textContent = text;
    el.classList.toggle('bad', !!bad);
    el.classList.add('show');
    const p = this.g.lastPointer || { x: innerWidth / 2, y: innerHeight / 2, touch: false };
    const off = p.touch ? 90 : 34;
    const r = el.getBoundingClientRect();
    const x = clamp(p.x - r.width / 2, 8, innerWidth - r.width - 8);
    const y = clamp(p.y - off - r.height, 70, innerHeight - r.height - 8);
    el.style.transform = `translate(${x}px, ${y}px)`;
  }

  positionConfirm(fit) {
    const el = $('confirm');
    if (!fit) { el.classList.remove('show'); return; }
    // Knöpfe über dem Geister-Gebäude, sonst darunter
    const top = this.g.preview.ghostTop || 1;
    const cx = fit.cx, cz = fit.cz;
    const pTop = this.g.worldToScreen(cx, top + 0.3, cz);
    const pBot = this.g.worldToScreen(cx, 0, cz);
    const r = el.getBoundingClientRect();
    const h = r.height || 60, wd = r.width || 200;
    let y = Math.min(pTop.y, pBot.y) - h - 16;
    if (y < 80) y = Math.max(pTop.y, pBot.y) + 24;
    el.style.transform = `translate(${clamp(pTop.x - wd / 2, 8, innerWidth - wd - 8)}px, ${clamp(y, 80, innerHeight - h - 110)}px)`;
    el.classList.add('show');
    $('cfOk').disabled = !fit.ok;
  }

  // ------------------------------------------------------------ Laufende Aktualisierung
  update() {
    const g = this.g, sim = g.sim, s = sim.stats;
    $('popVal').textContent = fmt(s.pop);
    const mv = $('moneyVal');
    mv.textContent = fmtMoney(sim.money);
    mv.classList.toggle('neg', sim.money < 0);
    const est = sim.monthlyEstimate();
    const net = est.income - est.expense;
    const md = $('moneyDelta');
    md.textContent = `${fmtSigned(net)}/Monat`;
    md.className = net >= 0 ? 'pos' : 'neg';
    const h = s.happiness;
    $('happyVal').textContent = s.pop ? `${Math.round(h)} %` : '–';
    $('happyIco').textContent = h > 75 ? '😄' : h > 60 ? '🙂' : h > 45 ? '😐' : h > 30 ? '🙁' : '😠';
    const d = sim.date;
    $('dateVal').textContent = d.toLocaleDateString('de-DE', { day: 'numeric', month: 'short', year: 'numeric' });
    const hh = Math.floor(g.clock), mm = Math.floor((g.clock - hh) * 60);
    $('clockVal').textContent = `${hh < 10 ? '0' : ''}${hh}:${mm < 10 ? '0' : ''}${mm}`;
    $('clockIco').textContent = g.clock >= 6.5 && g.clock < 19 ? '☀️' : '🌙';
    $('cityName').textContent = sim.cityName;
    $('milestone').textContent = MILESTONES[sim.milestone].name;
    const next = MILESTONES[sim.milestone + 1];
    const prog = $('msProg');
    if (next) {
      const prev = MILESTONES[sim.milestone].pop;
      prog.style.width = `${clamp((s.pop - prev) / (next.pop - prev), 0, 1) * 100}%`;
      $('msNext').textContent = `${MILESTONES[sim.milestone].name} → ${next.name}: ${fmt(s.pop)} / ${fmt(next.pop)}`;
    } else { prog.style.width = '100%'; $('msNext').textContent = 'Höchste Stufe erreicht!'; }
    for (const k of ['R', 'C', 'I', 'O']) {
      const v = sim.demand[k];
      const bar = $('dem' + k);
      const hgt = Math.abs(v) / 100 * 50;
      bar.style.height = `${hgt}%`;
      bar.style.bottom = v >= 0 ? '50%' : `${50 - hgt}%`;
      bar.classList.toggle('neg', v < 0);
    }
    $('demO').parentElement.style.opacity = sim.unlocked(ZONES[6].unlock) ? 1 : 0.35;
    for (const b of document.querySelectorAll('#speed button')) b.classList.toggle('active', Number(b.dataset.speed) === g.speed);
    $('btnUndo').classList.toggle('disabled', !g.undoStack.length);
    if (this.lastMilestone !== sim.milestone) {
      this.lastMilestone = sim.milestone;
      if (this.cat) this.renderSubpanel();
    }
    this.updateTasks();
    if (this.infoB) this.renderInfo();
    if (this.modalKind === 'budget' || this.modalKind === 'stats') this.refreshBudgetLive();
  }

  // ------------------------------------------------------------ Aufgaben (Einstieg)
  updateTasks() {
    const sim = this.g.sim, w = this.g.world, s = sim.stats;
    const t = sim.tasks;
    if (t.allDone) { $('tasks').classList.add('hidden'); return; }
    const has = { R: 0, C: 0, I: 0 };
    if (!t.res || !t.ci) for (const c of w.cells) if (c.zone) has[ZONES[c.zone].key] = 1;
    if (!t.road) {
      for (const sg of w.net.segs.values()) if (sg.type !== 3 && w.net.compOutside[sg.comp]) { t.road = true; break; }
    }
    if (has.R) t.res = true;
    if (has.C && has.I) t.ci = true;
    if (s.powerSup > 0) t.power = true;
    if (s.waterSup > 0) t.water = true;
    if (s.sewSup > 0) t.sewage = true;
    if (sim.milestone >= 1) t.pop = true;
    const list = $('tasksList');
    let html = '', done = 0;
    for (const task of TASKS) {
      if (t[task.id]) done++;
      html += `<li class="${t[task.id] ? 'done' : ''}"><span class="chk">${t[task.id] ? '✔' : ''}</span>${task.text}</li>`;
    }
    if (list.dataset.h !== html) { list.innerHTML = html; list.dataset.h = html; }
    $('tasksCount').textContent = `${done}/${TASKS.length}`;
    if (done === TASKS.length) {
      t.allDone = true;
      this.toast('🎓 Einführung abgeschlossen! Jetzt gehört die Stadt dir.', 'good');
    }
    $('tasks').classList.remove('hidden');
  }

  // ------------------------------------------------------------ Meldungen
  toast(msg, type = 'info') {
    const el = document.createElement('div');
    el.className = 'toast ' + type;
    el.textContent = msg;
    $('toasts').appendChild(el);
    requestAnimationFrame(() => el.classList.add('show'));
    setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 400); }, 3200);
    while ($('toasts').children.length > 3) $('toasts').firstChild.remove();
  }

  handleEvent(ev) {
    if (ev.type === 'chirp') {
      this.addFeed('🐦', ev.author, ev.text);
      this.g.sound.chirp();
    } else if (ev.type === 'milestone') {
      this.g.sound.milestone();
      this.showMilestone(ev);
    } else if (ev.type === 'warn') {
      const txt = { power: 'Strommangel! Baue mehr Kraftwerke.', water: 'Wassermangel! Baue mehr Pumpen.', sewage: 'Abwasser staut sich! Baue Auslässe.',
        conn: 'Keine Verbindung zur Autobahn – niemand kann zuziehen.', broke: 'Die Stadtkasse ist im Minus!' }[ev.key];
      if (txt) this.addFeed('⚠️', 'Stadtverwaltung', txt, true);
    }
  }

  addFeed(avatar, author, text, warn = false) {
    const feed = $('feed');
    const el = document.createElement('div');
    el.className = 'chirp' + (warn ? ' warn' : '');
    el.innerHTML = `<span class="av">${avatar}</span><div><b>${esc(author)}</b><p>${esc(text)}</p></div>`;
    feed.prepend(el);
    requestAnimationFrame(() => el.classList.add('show'));
    setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 500); }, 9000);
    while (feed.children.length > 4) feed.lastChild.remove();
  }

  // ------------------------------------------------------------ Info-Panel
  showInfo(b) {
    this.infoB = b;
    this.infoRoad = -1;
    this.renderInfo();
    $('info').classList.add('show');
    $('viewsPanel').classList.remove('show');
    this.g.highlight(b);
  }

  showRoadInfo(id) {
    const w = this.g.world;
    const seg = w.net.segs.get(id);
    if (!seg) return;
    this.infoB = null;
    this.infoRoad = id;
    const t = ROAD_TYPES[seg.type];
    const dens = seg.density || 0;
    const mid = w.net.at(seg, seg.len / 2);
    const bridge = w.terrainAt(mid.x, mid.z) === 1;
    $('info').innerHTML = `
      <div class="info-head"><span class="info-icon">${t.icon}</span><div><h3>${t.name}</h3><div class="sub">${bridge ? 'Brücke' : 'Straßenabschnitt'} · ${Math.round(seg.len * 8)} m</div></div>
      <button class="x" id="infoClose">✕</button></div>
      <div class="info-body">
        ${this.bar('Verkehrsauslastung', clamp(dens, 0, 1) * 100, dens > 0.8 ? 'bad' : dens > 0.5 ? 'mid' : 'good', `${Math.round(clamp(dens, 0, 1.5) * 100)} %`)}
        <div class="kv"><span>Höchstgeschwindigkeit</span><b>${t.kmh} km/h</b></div>
        <div class="kv"><span>Unterhalt</span><b>${fmtMoney(t.upkeep * seg.len)}/Monat</b></div>
        <p class="tip">Tipp: Wähle im Straßenmenü einen anderen Straßentyp und tippe auf diesen Abschnitt, um ihn umzubauen.</p>
      </div>`;
    $('infoClose').onclick = () => this.closeInfo();
    $('info').classList.add('show');
    $('viewsPanel').classList.remove('show');
    this.g.highlight(null);
  }

  closeInfo() {
    this.infoB = null;
    this.infoRoad = -1;
    $('info').classList.remove('show');
    this.g.highlight(null);
  }

  bar(label, pct, cls, txt) {
    return `<div class="bar-row"><span>${label}</span><div class="bar ${cls}"><i style="width:${clamp(pct, 0, 100)}%"></i></div><b>${txt}</b></div>`;
  }

  renderInfo() {
    const b = this.infoB;
    const g = this.g, w = g.world, sim = g.sim;
    if (!b || !w.buildings.has(b.id)) { this.closeInfo(); return; }
    const ci = b.ti;
    const cov = sim.cov;
    const pct = (v) => `${Math.round(clamp(v, 0, 1) * 100)} %`;
    const chip = (ok, ico, label) => `<span class="chip ${ok ? 'ok' : 'no'}">${ico} ${label}</span>`;
    let head, body = '', actions = '';
    if (b.kind === 'zone') {
      const z = ZONES[b.zone];
      const stars = '★'.repeat(b.level) + '☆'.repeat(z.maxLevel - b.level);
      head = { icon: z.icon, title: b.name || z.name, sub: `${z.short} · Stufe <span class="stars">${stars}</span>` };
      if (b.fire > 0) body += `<div class="status bad">🔥 Das Gebäude brennt!${b.fireCovered ? ' Die Feuerwehr ist unterwegs.' : ' Keine Feuerwache in Reichweite!'}</div>`;
      if (b.abandoned) body += '<div class="status bad">🏚️ Verlassen – die Bewohner waren zu unzufrieden.</div>';
      else if (b.built < 1) body += `<div class="status mid">🏗️ ${b.level > 1 ? 'Wird ausgebaut' : 'Im Bau'} (${Math.round(b.built * 100)} %)</div>`;
      if (b.seg < 0) body += '<div class="status bad">🚧 Keine Straßenanbindung</div>';
      else if (!b.connected) body += '<div class="status bad">🛣️ Nicht mit der Autobahn verbunden</div>';
      const isR = z.key === 'R';
      body += this.bar(isR ? 'Bewohner' : 'Beschäftigte', b.cap ? (b.occ / b.cap) * 100 : 0, 'info', `${fmt(b.occ)} / ${fmt(b.cap)}`);
      body += this.bar('Zufriedenheit', b.happy, b.happy > 60 ? 'good' : b.happy > 35 ? 'mid' : 'bad', `${Math.round(b.happy)} %`);
      body += this.bar('Bodenwert', sim.landValue[ci], 'info', `${Math.round(sim.landValue[ci])}`);
      body += '<div class="chips">';
      body += chip(b.power, '⚡', 'Strom') + chip(b.water, '💧', 'Wasser') + chip(b.sewage, '🚽', 'Abwasser');
      body += chip(b.garbage || sim.stats.pop <= 400, '🗑️', 'Müllabfuhr');
      body += chip(cov.police[ci] > 0.05, '🚓', `Polizei ${pct(cov.police[ci])}`);
      body += chip(cov.fire[ci] > 0.05, '🚒', `Feuerwehr ${pct(cov.fire[ci])}`);
      body += chip(cov.health[ci] > 0.05, '🩺', `Gesundheit ${pct(cov.health[ci])}`);
      if (isR) body += chip(b.edu > 0.1, '🎓', `Bildung ${pct(b.edu)}`);
      body += chip(cov.parks[ci] > 0.05, '🌳', `Parks ${pct(cov.parks[ci])}`);
      body += chip(cov.transit[ci] > 0.05, '🚌', `ÖPNV ${pct(cov.transit[ci])}`);
      body += '</div>';
      body += `<div class="kv"><span>Verschmutzung</span><b>${Math.round(sim.pollution[ci])}</b></div>`;
      body += `<div class="kv"><span>Lärm</span><b>${Math.round(sim.noise[ci])}</b></div>`;
      body += `<div class="kv"><span>Kriminalität</span><b>${Math.round(sim.crime[ci])}</b></div>`;
      if (b.level < z.maxLevel && !b.abandoned) {
        const need = z.key === 'I' || z.key === 'O' ? 'mehr Bildung und Zufriedenheit' : 'höheren Bodenwert (Parks, Dienste, wenig Lärm)';
        body += `<p class="tip">⬆️ Für die nächste Stufe braucht dieses Gebäude ${need}.</p>`;
      }
    } else {
      const d = SERVICES[b.def];
      head = { icon: d.icon, title: d.name, sub: d.desc || '' };
      if (b.seg < 0) body += '<div class="status bad">🚧 Keine Straßenanbindung</div>';
      if (b.fire > 0) body += '<div class="status bad">🔥 Das Gebäude brennt!</div>';
      if (d.powerUse && !b.power) body += '<div class="status bad">⚡ Kein Strom – Gebäude arbeitet nicht</div>';
      if (d.power) body += `<div class="kv"><span>Stromerzeugung</span><b>${d.power} MW</b></div>`;
      if (d.water) body += `<div class="kv"><span>Wasserförderung</span><b>${d.water} Einheiten</b></div>`;
      if (d.sewage) body += `<div class="kv"><span>Abwasserkapazität</span><b>${d.sewage} Einheiten</b></div>`;
      if (d.cover) body += `<div class="kv"><span>Wirkungsradius</span><b>${d.cover.r} Felder</b></div>`;
      if (d.powerUse) body += `<div class="kv"><span>Stromverbrauch</span><b>${fmt1(d.powerUse)} MW</b></div>`;
      if (d.jobs) body += `<div class="kv"><span>Arbeitsplätze</span><b>${d.jobs}</b></div>`;
      if (d.pollution) body += `<div class="kv"><span>Verschmutzung</span><b class="neg">hoch</b></div>`;
      body += `<div class="kv"><span>Unterhalt</span><b>${fmtMoney(d.upkeep)}/Monat</b></div>`;
      actions = `<button class="btn danger" id="infoDemolish">🚜 Abreißen (+${fmtMoney(d.cost * 0.5)})</button>`;
    }
    if (b.kind === 'zone') actions = '<button class="btn danger" id="infoDemolish">🚜 Abreißen</button>';
    const html = `
      <div class="info-head"><span class="info-icon">${head.icon}</span><div><h3>${esc(head.title)}</h3><div class="sub">${head.sub}</div></div>
      <button class="x" id="infoClose">✕</button></div>
      <div class="info-body">${body}</div>
      <div class="info-actions"><button class="btn" id="infoFocus">🎯 Zentrieren</button>${actions}</div>`;
    const el = $('info');
    if (el.dataset.h === html) return;
    el.dataset.h = html;
    el.innerHTML = html;
    $('infoClose').onclick = () => this.closeInfo();
    $('infoFocus').onclick = () => g.camera.animateTo({ x: b.cx, z: b.cz, dist: Math.max(10, Math.min(g.camera.dist, 22)) });
    const dm = $('infoDemolish');
    if (dm) dm.onclick = () => g.demolish(b);
  }

  // ------------------------------------------------------------ Info-Ansichten
  toggleViews() {
    const p = $('viewsPanel');
    if (p.classList.contains('show')) { p.classList.remove('show'); return; }
    this.openCategory(null);
    this.closeInfo();
    p.innerHTML = '<div class="sp-title">🗺️ Info-Ansichten</div><div class="views"></div>';
    const wrap = p.querySelector('.views');
    const off = document.createElement('button');
    off.className = 'view' + (!this.g.overlay.mode ? ' active' : '');
    off.innerHTML = '<span>🏙️</span>Normal';
    off.onclick = () => { this.setView(null); p.classList.remove('show'); };
    wrap.appendChild(off);
    for (const [k, v] of Object.entries(VIEWS)) {
      const b = document.createElement('button');
      b.className = 'view' + (this.g.overlay.mode === k ? ' active' : '');
      b.innerHTML = `<span>${v.icon}</span>${v.name}`;
      b.onclick = () => { this.g.sound.click(); this.setView(k); p.classList.remove('show'); };
      wrap.appendChild(b);
    }
    p.classList.add('show');
  }

  setView(k) {
    this.g.setOverlay(k);
    const lg = $('legend');
    if (!k) { lg.classList.remove('show'); $('btnViews').classList.remove('active'); return; }
    const v = VIEWS[k];
    $('legendTitle').textContent = `${v.icon} ${v.name}`;
    $('legendLow').textContent = v.low;
    $('legendHigh').textContent = v.high;
    const grad = { pollution: 'linear-gradient(90deg,#37b24d,#965f1e)', noise: 'linear-gradient(90deg,#444,#9646c8)',
      traffic: 'linear-gradient(90deg,#37b24d,#fab005,#e03131)', crime: 'linear-gradient(90deg,#37b24d,#fab005,#e03131)' }[k]
      || (['police', 'fire', 'health', 'garbage', 'parks', 'transit'].includes(k) ? 'linear-gradient(90deg,#e03131,#fab005,#37b24d)' : 'linear-gradient(90deg,#e03131,#fab005,#37b24d)');
    $('legendBar').style.background = grad;
    lg.classList.add('show');
    $('btnViews').classList.add('active');
  }

  // ------------------------------------------------------------ Dialoge
  openModal(html, kind, wide = false) {
    const m = $('modal');
    m.innerHTML = `<div class="dialog ${wide ? 'wide' : ''}">${html}</div>`;
    m.classList.add('show');
    this.modalKind = kind;
    m.onclick = (e) => { if (e.target === m && kind !== 'start') this.closeModal(); };
    for (const b of m.querySelectorAll('[data-close]')) b.onclick = () => { this.g.sound.click(); this.closeModal(); };
    return m;
  }

  closeModal() {
    $('modal').classList.remove('show');
    this.modalKind = null;
    document.body.classList.toggle('start-mode', !this.g.started);
  }

  showMenu() {
    const info = saveInfo();
    const m = this.openModal(`
      <div class="dlg-head"><h2>☰ Menü</h2><button class="x" data-close>✕</button></div>
      <div class="menu-grid">
        <button class="btn big" id="mSave">💾 Speichern</button>
        <button class="btn big" id="mLoad" ${info ? '' : 'disabled'}>📂 Laden${info ? `<small>${esc(info.name)} · ${new Date(info.savedAt).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })}</small>` : ''}</button>
        <button class="btn big" id="mNew">🏗️ Neue Stadt</button>
        <button class="btn big" id="mSettings">⚙️ Einstellungen</button>
        <button class="btn big" id="mHelp">❓ Hilfe & Steuerung</button>
        <button class="btn big" id="mFull">⛶ Vollbild</button>
        <button class="btn big" id="mExport">📤 Exportieren</button>
        <button class="btn big" id="mImport">📥 Importieren</button>
      </div>`, 'menu');
    m.querySelector('#mSave').onclick = () => { if (this.g.save()) this.toast('💾 Spiel gespeichert', 'good'); this.closeModal(); };
    m.querySelector('#mLoad').onclick = () => { this.g.load(); this.closeModal(); };
    m.querySelector('#mNew').onclick = () => this.showStart(true);
    m.querySelector('#mSettings').onclick = () => this.showSettings();
    m.querySelector('#mHelp').onclick = () => this.showHelp();
    m.querySelector('#mFull').onclick = () => { this.g.toggleFullscreen(); this.closeModal(); };
    m.querySelector('#mExport').onclick = () => { this.g.exportSave(); this.closeModal(); };
    m.querySelector('#mImport').onclick = () => { this.g.importSave(); this.closeModal(); };
  }

  showStart(fromMenu = false) {
    const info = saveInfo();
    const name = CITY_NAMES[Math.floor(Math.random() * CITY_NAMES.length)];
    document.body.classList.add('start-mode');
    const m = this.openModal(`
      <div class="start">
        <div class="logo">🏙️</div>
        <h1>Stadtplaner</h1>
        <p class="tagline">Plane, baue und verwalte deine eigene Stadt in 3D.</p>
        <label class="field"><span>Name deiner Stadt</span>
          <div class="row"><input id="sName" maxlength="28" value="${esc(name)}" /><button class="btn" id="sDice" title="Zufälliger Name">🎲</button></div></label>
        <label class="field"><span>Karte</span>
          <div class="row"><input id="sSeed" inputmode="numeric" value="${this.g.world.seed}" /><button class="btn" id="sMap" title="Andere Karte">🗺️ Andere Karte</button></div></label>
        <div class="start-actions">
          <button class="btn big primary" id="sNew">🏗️ Neue Stadt gründen</button>
          ${info ? `<button class="btn big" id="sCont">▶ Weiterspielen<small>${esc(info.name)} · ${fmt(info.pop || 0)} Einw.</small></button>` : ''}
          ${fromMenu ? '<button class="btn big" data-close>Abbrechen</button>' : ''}
        </div>
        ${fromMenu ? '<p class="warn-txt">⚠️ Eine neue Stadt ersetzt den gespeicherten Spielstand beim nächsten Speichern.</p>' : '<p class="small">Tipp: Zum Startbildschirm hinzufügen für Vollbild auf dem Tablet.</p>'}
      </div>`, 'start');
    m.querySelector('#sDice').onclick = () => { m.querySelector('#sName').value = CITY_NAMES[Math.floor(Math.random() * CITY_NAMES.length)]; };
    m.querySelector('#sMap').onclick = () => {
      const seed = Math.floor(Math.random() * 1e6);
      m.querySelector('#sSeed').value = seed;
      this.g.previewMap(seed);
    };
    m.querySelector('#sSeed').onchange = (e) => this.g.previewMap(Number(e.target.value) || 1);
    m.querySelector('#sNew').onclick = () => {
      this.g.sound.unlock();
      const seed = Number(m.querySelector('#sSeed').value) || 1;
      const nm = m.querySelector('#sName').value.trim() || 'Neustadt';
      this.closeModal();
      this.g.newGame(seed, nm);
    };
    const c = m.querySelector('#sCont');
    if (c) c.onclick = () => { this.g.sound.unlock(); this.closeModal(); this.g.load(); };
  }

  showSettings() {
    const s = this.g.settings;
    const opt = (k, v, label) => `<button class="seg ${s[k] === v ? 'active' : ''}" data-k="${k}" data-v="${v}">${label}</button>`;
    const m = this.openModal(`
      <div class="dlg-head"><h2>⚙️ Einstellungen</h2><button class="x" data-close>✕</button></div>
      <div class="settings">
        <div class="set"><span>Grafikqualität</span><div class="segs">${opt('quality', 'low', 'Niedrig')}${opt('quality', 'medium', 'Mittel')}${opt('quality', 'high', 'Hoch')}</div></div>
        <div class="set"><span>Schatten</span><div class="segs">${opt('shadows', false, 'Aus')}${opt('shadows', true, 'An')}</div></div>
        <div class="set"><span>Tag-Nacht-Zyklus</span><div class="segs">${opt('dayNight', false, 'Immer Tag')}${opt('dayNight', true, 'An')}</div></div>
        <div class="set"><span>Fahrzeuge</span><div class="segs">${opt('vehicles', 150, 'Wenige')}${opt('vehicles', 350, 'Normal')}${opt('vehicles', 600, 'Viele')}</div></div>
        <div class="set"><span>Status-Symbole</span><div class="segs">${opt('icons', false, 'Aus')}${opt('icons', true, 'An')}</div></div>
        <div class="set"><span>Ton</span><div class="segs">${opt('sound', false, 'Aus')}${opt('sound', true, 'An')}</div></div>
      </div>`, 'settings');
    for (const b of m.querySelectorAll('.seg')) {
      b.onclick = () => {
        const k = b.dataset.k;
        let v = b.dataset.v;
        if (v === 'true') v = true; else if (v === 'false') v = false; else if (!isNaN(Number(v))) v = Number(v);
        this.g.applySetting(k, v);
        this.showSettings();
      };
    }
  }

  showHelp() {
    this.openModal(`
      <div class="dlg-head"><h2>❓ Hilfe & Steuerung</h2><button class="x" data-close>✕</button></div>
      <div class="help">
        <h3>👆 Touch (Tablet)</h3>
        <ul>
          <li><b>1 Finger ziehen</b> – Karte verschieben (ohne Werkzeug) oder bauen (mit Werkzeug)</li>
          <li><b>2 Finger</b> – zoomen (spreizen), drehen (verdrehen) und verschieben</li>
          <li><b>3 Finger hoch/runter</b> – Kamera neigen (oder Knöpfe rechts)</li>
          <li><b>Tippen</b> auf ein Gebäude – Infos anzeigen</li>
          <li><b>Gebäude platzieren</b> – ziehen, dann ✓ tippen (⟳ dreht)</li>
        </ul>
        <h3>🖱️ Maus & Tastatur</h3>
        <ul>
          <li>Linke Taste: bauen / verschieben · Rechte Taste: drehen & neigen · Mausrad: zoomen</li>
          <li>WASD/Pfeile: bewegen · Q/E: drehen · R/F: zoomen · T/G: neigen</li>
          <li>Leertaste: Pause · 1–3: Tempo · Strg+Z: Rückgängig · Esc: Werkzeug abwählen · B: Abriss</li>
        </ul>
        <h3>🏙️ So wächst deine Stadt</h3>
        <ol>
          <li>Verbinde neue <b>Straßen</b> mit der Autobahn – nur so ziehen Menschen zu.</li>
          <li>Weise <b>Zonen</b> neben Straßen aus: <span class="z r">Wohnen</span> <span class="z c">Gewerbe</span> <span class="z i">Industrie</span> <span class="z o">Büros</span>.</li>
          <li>Sorge für <b>Strom</b> (Windrad) und <b>Wasser</b> (Pumpe + Abwasserauslass am Ufer). Leitungen verlaufen unter den Straßen.</li>
          <li>Beobachte die <b>Nachfrage-Balken</b> (R/C/I/O) oben – sie zeigen, was gebraucht wird.</li>
          <li>Mit wachsender Einwohnerzahl schaltest du <b>Meilensteine</b> frei: Polizei, Feuerwehr, Schulen, Hochhäuser …</li>
          <li><b>Parks, Dienste und wenig Lärm</b> steigern den Bodenwert – Gebäude werden dann aufgewertet.</li>
          <li>Halte die <b>Steuern</b> moderat (📊 Budget). Zu hohe Steuern vertreiben Bürger.</li>
        </ol>
      </div>`, 'help', true);
  }

  showDemandHelp() {
    const d = this.g.sim.demand;
    const row = (k, name, cls) => `<div class="kv"><span><i class="dot ${cls}"></i>${name}</span><b>${Math.round(d[k])}</b></div>`;
    this.openModal(`
      <div class="dlg-head"><h2>📊 Nachfrage</h2><button class="x" data-close>✕</button></div>
      <p>Die Balken zeigen, welche Zonen die Stadt gerade braucht. Positive Werte bedeuten: Hier wird gebaut, sobald Flächen ausgewiesen sind.</p>
      ${row('R', 'Wohnen', 'r')}${row('C', 'Gewerbe', 'c')}${row('I', 'Industrie', 'i')}${row('O', 'Büros', 'o')}
      <p class="tip">Wohnen steigt mit freien Arbeitsplätzen. Gewerbe braucht Einwohner als Kunden. Industrie beliefert Gewerbe. Büros brauchen gebildete Arbeitskräfte.</p>`, 'demand');
  }

  showBudget(tab = 'budget') {
    const m = this.openModal(`
      <div class="dlg-head"><h2>📊 Stadtverwaltung</h2><button class="x" data-close>✕</button></div>
      <div class="tabs"><button class="tab ${tab === 'budget' ? 'active' : ''}" data-tab="budget">💰 Budget</button><button class="tab ${tab === 'stats' ? 'active' : ''}" data-tab="stats">📈 Statistik</button></div>
      <div id="budgetBody"></div>`, tab, true);
    for (const b of m.querySelectorAll('.tab')) b.onclick = () => this.showBudget(b.dataset.tab);
    this.renderBudget(tab);
  }

  renderBudget(tab) {
    const sim = this.g.sim, s = sim.stats;
    const body = $('budgetBody');
    if (!body) return;
    if (tab === 'budget') {
      const L = sim.lastMonth || sim.month;
      const est = sim.monthlyEstimate();
      const taxRow = (k, name, cls) => `
        <div class="tax"><span><i class="dot ${cls}"></i>${name}</span>
          <input type="range" min="0" max="29" step="1" value="${sim.taxes[k]}" data-k="${k}" />
          <b id="tax${k}">${sim.taxes[k]} %</b><small id="inc${k}">${fmtMoney((L.income[k] || 0))}</small></div>`;
      let exp = '';
      for (const [k, name] of Object.entries(EXPENSE_CATS)) exp += `<div class="kv"><span>${name}</span><b id="exp_${k}">${fmtMoney(L.expense[k] || 0)}</b></div>`;
      body.innerHTML = `
        <div class="budget">
          <div class="col">
            <h3>Steuern & Einnahmen <small>${sim.lastMonth ? 'letzter Monat' : 'laufender Monat'}</small></h3>
            ${taxRow('R', 'Wohnen', 'r')}${taxRow('C', 'Gewerbe', 'c')}${taxRow('I', 'Industrie', 'i')}${taxRow('O', 'Büros', 'o')}
            <div class="kv"><span>🎫 Fahrkarten</span><b>${fmtMoney(L.income.T || 0)}</b></div>
            <p class="tip">Über 12 % sinkt die Nachfrage spürbar, unter 7 % steigt sie – kostet aber Einnahmen.</p>
          </div>
          <div class="col">
            <h3>Ausgaben</h3>${exp}
          </div>
        </div>
        <div class="sum"><span>Einnahmen <b class="pos" id="estInc">${fmtMoney(est.income)}</b></span><span>Ausgaben <b class="neg" id="estExp">${fmtMoney(est.expense)}</b></span><span>Bilanz <b id="estNet" class="${est.income - est.expense >= 0 ? 'pos' : 'neg'}">${fmtSigned(est.income - est.expense)}</b> / Monat</span></div>
        <canvas id="chartMoney" height="140"></canvas>`;
      for (const r of body.querySelectorAll('input[type=range]')) {
        r.oninput = () => { sim.taxes[r.dataset.k] = Number(r.value); $('tax' + r.dataset.k).textContent = `${r.value} %`; };
      }
      this.drawChart('chartMoney', sim.history.map((h) => h.money), '#4dabf7', 'Kontostand');
    } else {
      const pct = (a, b) => (b > 0 ? Math.round((a / b) * 100) : 0);
      const util = (label, sup, dem, unit) => this.bar(label, dem > 0 ? Math.min(100, (sup / Math.max(dem, 0.001)) * 50) : 0,
        sup >= dem ? 'good' : 'bad', `${fmt1(sup)} / ${fmt1(dem)} ${unit}`);
      body.innerHTML = `
        <div class="budget">
          <div class="col">
            <h3>Bevölkerung</h3>
            <div class="kv"><span>Einwohner</span><b id="stPop">${fmt(s.pop)}</b></div>
            <div class="kv"><span>Erwerbspersonen</span><b>${fmt(s.workforce)}</b></div>
            <div class="kv"><span>Arbeitslosigkeit</span><b class="${s.unemployment > 0.12 ? 'neg' : ''}">${Math.round(s.unemployment * 100)} %</b></div>
            <div class="kv"><span>Pendler von außerhalb</span><b>${fmt(s.commuters)}</b></div>
            <div class="kv"><span>Fahrgäste ÖPNV</span><b>${fmt(s.riders)}</b></div>
            <div class="kv"><span>Arbeitsplätze (Gew./Ind./Büro/Öff.)</span><b>${fmt(s.jobsC)} / ${fmt(s.jobsI)} / ${fmt(s.jobsO)} / ${fmt(s.jobsS)}</b></div>
            <div class="kv"><span>Ø Bildung</span><b>${Math.round(s.eduAvg * 100)} %</b></div>
            <div class="kv"><span>Gebäude</span><b>${fmt(s.buildings)}</b></div>
          </div>
          <div class="col">
            <h3>Versorgung & Umwelt</h3>
            ${util('⚡ Strom', s.powerSup, s.powerDem, 'MW')}
            ${util('💧 Wasser', s.waterSup, s.waterDem, '')}
            ${util('🚽 Abwasser', s.sewSup, s.sewDem, '')}
            ${this.bar('😊 Zufriedenheit', s.happiness, s.happiness > 60 ? 'good' : s.happiness > 40 ? 'mid' : 'bad', `${Math.round(s.happiness)} %`)}
            ${this.bar('💎 Ø Bodenwert', s.landValue, 'info', `${Math.round(s.landValue)}`)}
            ${this.bar('🏭 Ø Verschmutzung', s.pollution * 2, s.pollution > 20 ? 'bad' : 'good', `${Math.round(s.pollution)}`)}
            ${this.bar('🦹 Ø Kriminalität', s.crime * 2, s.crime > 25 ? 'bad' : 'good', `${Math.round(s.crime)}`)}
            ${this.bar('🚦 Verkehrsauslastung', this.g.traffic.congestion * 100, this.g.traffic.congestion > 0.6 ? 'bad' : 'good', `${pct(this.g.traffic.congestion, 1)} %`)}
          </div>
        </div>
        <canvas id="chartPop" height="140"></canvas>`;
      this.drawChart('chartPop', sim.history.map((h) => h.pop), '#51cf66', 'Einwohner');
    }
  }

  refreshBudgetLive() {
    const now = performance.now();
    if (now - (this.lastBudgetRefresh || 0) < 2000) return;
    this.lastBudgetRefresh = now;
    if (this.modalKind === 'stats') { this.renderBudget('stats'); return; }
    const sim = this.g.sim;
    const est = sim.monthlyEstimate();
    const set = (id, v) => { const e = $(id); if (e) e.textContent = v; };
    set('estInc', fmtMoney(est.income));
    set('estExp', fmtMoney(est.expense));
    set('estNet', fmtSigned(est.income - est.expense));
  }

  drawChart(id, values, color, label) {
    const cv = $(id);
    if (!cv) return;
    const dpr = window.devicePixelRatio || 1;
    const W = cv.clientWidth || 600, H = 140;
    cv.width = W * dpr; cv.height = H * dpr;
    const c = cv.getContext('2d');
    c.scale(dpr, dpr);
    c.fillStyle = 'rgba(255,255,255,0.04)';
    c.fillRect(0, 0, W, H);
    c.fillStyle = '#9fb0c3';
    c.font = '12px system-ui, sans-serif';
    c.fillText(`${label} (Monatsverlauf)`, 10, 18);
    if (values.length < 2) { c.fillText('Noch keine Daten – warte einen Monat.', 10, 70); return; }
    const min = Math.min(0, ...values), max = Math.max(1, ...values);
    const px = (i) => 10 + (i / (values.length - 1)) * (W - 20);
    const py = (v) => H - 14 - ((v - min) / (max - min)) * (H - 40);
    c.beginPath();
    values.forEach((v, i) => (i ? c.lineTo(px(i), py(v)) : c.moveTo(px(i), py(v))));
    c.strokeStyle = color;
    c.lineWidth = 2.5;
    c.stroke();
    c.lineTo(px(values.length - 1), H - 14);
    c.lineTo(px(0), H - 14);
    c.fillStyle = color + '33';
    c.fill();
    c.fillStyle = '#dfe7ef';
    c.fillText(fmt(values[values.length - 1]), W - 80, 18);
  }

  showMilestone(ev) {
    const unlocked = [];
    for (const r of Object.values(ROAD_TYPES)) if (r.unlock === ev.index) unlocked.push(`${r.icon} ${r.name}`);
    for (const z of Object.values(ZONES)) if (z.unlock === ev.index) unlocked.push(`${z.icon} ${z.name}`);
    for (const s of Object.values(SERVICES)) if (s.unlock === ev.index) unlocked.push(`${s.icon} ${s.name}`);
    const next = MILESTONES[ev.index + 1];
    this.openModal(`
      <div class="milestone">
        <div class="confetti">🎉</div>
        <h2>${esc(this.g.sim.cityName)} ist jetzt ${ev.name === 'Weiler' ? 'ein' : ev.name === 'Dorf' ? 'ein' : 'eine'} ${ev.name}!</h2>
        <p>Belohnung: <b class="pos">+${fmtMoney(ev.reward)}</b></p>
        ${unlocked.length ? `<h3>Freigeschaltet</h3><div class="unlocks">${unlocked.map((u) => `<span>${u}</span>`).join('')}</div>` : ''}
        ${next ? `<p class="small">Nächster Meilenstein: ${next.name} bei ${fmt(next.pop)} Einwohnern</p>` : ''}
        <button class="btn big primary" data-close>Weiter bauen</button>
      </div>`, 'milestone');
  }
}

