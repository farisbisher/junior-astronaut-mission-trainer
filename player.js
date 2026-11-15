// Junior Astronaut Mission Trainer: the branching player.
// A small state machine (story.json) drives two stacked <video> elements. The clip that comes next waits on the
// hidden one, already on its first frame, so every change of clip is a hard cut: no fades, no black. An idle loop
// (the same shot, still waiting) runs behind each choice, and one music bed per chapter plays across the cuts.
// Everything the player reads or presses is drawn on the picture: the choices (each appears as the film names it),
// the objective, tutorial hints, names for things in the shot, and every consequence as a meter change with its reason.
// The storm is real: each run draws one from data/donki.json, which tools/fetch_data.mjs pulled from NASA's DONKI API.
// Nothing is collected or sent anywhere. Code written with AI assistance (Claude Fable 5.2).
const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const stage = $('#stage'), vids = [$('#vA'), $('#vB')];
let STORY, CLIPS, DONKI, cur = 0, node = null, clipName = null, nav = 0, Q = [], idle = false, busy = false, timerId = 0, lateId = 0, actx = null, tipHtml = '';
const S = { vars: {}, open: new Set(), meters: null, pending: {}, log: [], storm: null, learned: [], last: null };
const blobs = new Map(), urls = new Map(), abufs = new Map();
let bed = { name: null, src: null, gain: null };
// public sources for every real fact shown in the film
const SRC = {
  donki: ['Storm records (flare alerts, particle events, eruption clouds, geomagnetic storms): NASA DONKI (Space Weather Database Of Notifications, Knowledge, Information), Community Coordinated Modeling Center, pulled through api.nasa.gov. Archived events, not live.', 'https://ccmc.gsfc.nasa.gov/tools/DONKI/'],
  radlab: ['Radiation dose inside the Space Station and in lunar orbit, September 2017: NASA Open Science Data Repository, RadLab (ISS-RAD and LRO CRaTER detectors). Archived.', 'https://visualization.osdr.nasa.gov/radlab/gui/data-api/'],
  veggie: ['Tomatoes grown on the Space Station for 101 days: NASA Open Science Data Repository, study OSD-766 (VEG-05).', 'https://osdr.nasa.gov/bio/repo/data/studies/OSD-766'],
  csa: ['Crop growing times (lettuce 21 to 28 days) and astronaut food: Canadian Space Agency, "Food production on the Moon" toolkit.', 'https://www.asc-csa.gc.ca/eng/youth-educators/toolkits/food-production/'],
  bone: ['Bone loss of about 1 to 1.5 percent a month on long missions: NASA Technical Reports Server.', 'https://ntrs.nasa.gov/citations/20170004598'],
  diviner: ['Lunar night temperatures below minus 170 degrees Celsius: Diviner Lunar Radiometer (NASA Lunar Reconnaissance Orbiter).', 'https://www.diviner.ucla.edu/science'],
  delay: ['Signal delay: computed from the Earth to Moon distance (384,400 km) and the Earth to Mars distance (55 to 401 million km) at the speed of light.', ''],
  site: ['The outpost stands at Malapert Massif, one of the candidate landing regions NASA named for Artemis III on 28 October 2024.', ''],
  shams: ['SHAMS, a Saudi Space Agency CubeSat, flew on the crewed Artemis II mission (first contact 4 April 2026) to measure space radiation and solar particles.', 'https://www.globalsecurity.org/space/library/news/2026/space-260404-spa01.htm'],
  madak: ['The Madak space competition (2024) was open to ages 6 to 18; ten winning experiments flew to the International Space Station in 2025.', 'https://www.wam.ae/en/article/bkpnm06-saudi-space-agency-marks-milestone-madak-space'],
  pipeline: ['SARI 2 (Saudi Space Agency with Aramco Digital, 2026) supports university students building and launching small satellites.', 'https://ssa.gov.sa/Sari2/'],
  ax2: ['Saudi astronauts Rayyanah Barnawi and Ali AlQarni flew to the International Space Station in May 2023.', 'https://axiomspace.com/news/ax2-successful-launch'],
};
const fill = s => s.replace(/\{(\w+)\}/g, (_, k) => S.vars[k] ?? '');
const uniq = a => [...new Set(a)], host = u => u.replace(/^https?:\/\//, '').split('/')[0];
const link = k => (SRC[k] && SRC[k][1] ? ` <a href="${SRC[k][1]}" target="_blank" rel="noopener">Source</a>` : '');
const store = { get() { try { return JSON.parse(localStorage.getItem('jamt2') || '{}'); } catch { return {}; } }, set(v) { try { localStorage.setItem('jamt2', JSON.stringify(v)); } catch { /* private window: fine */ } } };
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const day = iso => `${+iso.slice(8, 10)} ${MONTHS[+iso.slice(5, 7) - 1]} ${iso.slice(0, 4)}`, clock = iso => iso.slice(11, 16) + ' UTC';
const span = m => (m < 60 ? `${m} minutes` : `${Math.floor(m / 60)} hour${m >= 120 ? 's' : ''}${m % 60 ? ` ${m % 60} minutes` : ''}`);
const craft = s => (/GOES/.test(s) ? 'a GOES weather satellite' : /SOHO/.test(s) ? 'the SOHO Sun-watching spacecraft' : /STEREO/.test(s) ? 'the STEREO A spacecraft' : 'a spacecraft');
const num = n => n.toLocaleString('en-US');

// ---------- media: hard cuts between two video elements
function prefetch(names) { for (const n of names) if (n && CLIPS[n] && !blobs.has(n)) blobs.set(n, fetch(`v/${n}.mp4`).then(r => (r.ok ? r.blob() : Promise.reject())).then(b => { const u = URL.createObjectURL(b); urls.set(n, u); return u; }).catch(() => `v/${n}.mp4`)); }
function arm(v, name, loop) {                      // put a clip on a video element and hold it on its first frame
  if (v._name === name && v._arm) return v._arm;
  v._name = name; prefetch([name]);
  return (v._arm = (async () => {
    const url = await blobs.get(name); if (v._name !== name) return;
    v.pause(); v.loop = loop; v.muted = loop;
    await new Promise(res => { const ok = () => { v.removeEventListener('loadeddata', ok); v.removeEventListener('error', ok); clearTimeout(to); res(); }; v.addEventListener('loadeddata', ok); v.addEventListener('error', ok); const to = setTimeout(ok, 6000); v.src = url; v.load(); });
  })());
}
async function cut(name, { loop = false, my } = {}) {
  const v = vids[1 - cur], old = vids[cur];
  await arm(v, name, loop); if (v._name !== name || (my !== undefined && my !== nav)) return null;
  try { if (v.currentTime > 0.04) v.currentTime = 0; } catch { /* not seekable yet: it is at the start anyway */ }
  try { await v.play(); } catch { v.muted = true; await v.play().catch(() => {}); }
  v.classList.add('on'); old.classList.remove('on'); old.pause(); old._name = null; old._arm = null; cur = 1 - cur; clipName = name; Q = loop ? [] : [...(CLIPS[name]?.ui || [])];
  return v;
}
const preload = (name, loop = false) => { if (name && CLIPS[name]) arm(vids[1 - cur], name, loop); };
const ended = (v, my, name) => new Promise(r => { const t0 = performance.now(), max = ((CLIPS[name]?.duration || 12) + 4) * 1000;
  const done = () => { v.removeEventListener('ended', done); clearInterval(iv); r(); }; v.addEventListener('ended', done);
  const iv = setInterval(() => { if (my !== nav || v.ended || (performance.now() - t0) * (v.playbackRate || 1) > max) done(); }, 200); });

// ---------- sound: interface ticks, and one music bed per chapter that keeps playing across the cuts
function beep(f = 660, d = 0.09, g = 0.06, type = 'triangle') { if (!actx) return; try { const o = actx.createOscillator(), a = actx.createGain(); o.type = type; o.frequency.value = f; a.gain.setValueAtTime(g, actx.currentTime); a.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + d); o.connect(a).connect(actx.destination); o.start(); o.stop(actx.currentTime + d + 0.02); } catch { /* no sound: fine */ } }
async function setBed(name, level = 0.3) {
  if (!actx || !$('#musicOn').checked) name = null;
  if (bed.name !== name) {
    if (bed.src) { const { src, gain } = bed; try { gain.gain.setTargetAtTime(0.0001, actx.currentTime, 0.3); } catch { /* closed */ } setTimeout(() => { try { src.stop(); } catch { /* already stopped */ } }, 1500); }
    bed = { name, src: null, gain: null }; if (!name) return;
    try {
      if (!abufs.has(name)) abufs.set(name, fetch(`a/${name}.wav`).then(r => r.arrayBuffer()).then(b => actx.decodeAudioData(b)));
      const buf = await abufs.get(name); if (bed.name !== name || bed.src) return;
      const src = actx.createBufferSource(), gain = actx.createGain(); src.buffer = buf; src.loop = true; gain.gain.value = 0.0001; src.connect(gain).connect(actx.destination); src.start(); bed.src = src; bed.gain = gain;
    } catch { return; }                                                   // no music: the film still plays
  }
  if (bed.gain) bed.gain.gain.setTargetAtTime(level, actx.currentTime, 0.4);
}
const bedFor = n => (!n || n.quiet ? null : n.chapter === 1 ? 'bed_c1' : 'bed_m');

// ---------- HUD: objective, meters, labels, consequences, hints
function objective() {
  const el = $('#objective'), ch = node && STORY.chapters[node.chapter]; if (!ch || node.id === 'open' || node.screen) { el.hidden = true; return; }
  el.hidden = false; el.querySelector('.ch').textContent = ch.name; el.querySelector('.title').textContent = ch.title; el.querySelector('.goal').innerHTML = ch.goal;
  const st = node.step ?? -1; el.querySelector('.steps').innerHTML = ch.steps.map((s, i) => `<i class="${i < st ? 'done' : i === st ? 'now' : ''}">${s}</i>`).join('');
}
function renderMeters() {
  const M = STORY.meters, el = $('#meters'); stage.classList.toggle('has-meters', !!S.meters); if (!S.meters) { el.hidden = true; el.innerHTML = ''; return; } el.hidden = false;
  if (!el.children.length) el.innerHTML = Object.keys(M.start).map(k => `<div class="meter" data-k="${k}"><span class="chev"></span><span class="mi">${M.icons[k]}</span><span class="ml">${M.labels[k]}</span><span class="bar">${'<i></i>'.repeat(M.scale[1])}</span><span class="mv"></span></div>`).join('');
  for (const k of Object.keys(M.start)) { const m = el.querySelector(`[data-k="${k}"]`); m.classList.toggle('low', S.meters[k] <= 1); m.querySelectorAll('.bar i').forEach((b, i) => b.classList.toggle('on', i < S.meters[k])); m.querySelector('.mv').textContent = S.meters[k]; }
}
function pop({ x = 0.5, y = 0.45, cls, html, dur = 2.4 }) {             // something drawn at a point of the picture, for a moment (below the point when there is no room above)
  const el = document.createElement('div'); el.className = cls + (y < (cls.startsWith('fx') ? 0.24 : 0.14) ? ' below' : ''); el.style.left = Math.min(84, Math.max(16, x * 100)) + '%'; el.style.top = Math.min(90, Math.max(8, y * 100)) + '%'; el.innerHTML = html;
  $('#tags').appendChild(el); requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('on'))); setTimeout(() => { el.classList.remove('on'); setTimeout(() => el.remove(), 320); }, dur * 1000);
}
function dock() {                                                        // the shot changed: names come off the picture, consequences move to the side column
  for (const t of $$('#tags .tag')) t.parentNode.removeChild(t);
  const col = $('#dock'); for (const f of $$('#tags .fx')) { f.classList.remove('below'); f.style.left = f.style.top = ''; col.appendChild(f); }
}
function change(k, d, why, x, y) {                                       // a meter moves: shown where it happened, with the reason
  if (!S.meters || !d) return; const M = STORY.meters; S.meters[k] = Math.max(M.scale[0], Math.min(M.scale[1], S.meters[k] + d)); renderMeters();
  const m = $(`.meter[data-k="${k}"]`); if (m) { m.classList.remove('up', 'down'); void m.offsetWidth; m.classList.add('show', d > 0 ? 'up' : 'down'); m.querySelector('.chev').textContent = d > 0 ? '▲' : '▼'; clearTimeout(m._t); m._t = setTimeout(() => m.classList.remove('up', 'down'), 2800); }
  beep(d > 0 ? 880 : 240, 0.16, 0.06, d > 0 ? 'triangle' : 'sawtooth'); if (d > 0) setTimeout(() => beep(1320, 0.12, 0.05), 90);
  pop({ x, y, cls: 'fx ' + (d > 0 ? 'up' : 'dn'), dur: 3.1, html: `<div class="top"><span class="chev">${d > 0 ? '▲' : '▼'}</span><span class="num">${Math.abs(d)}</span><span class="lab">${M.icons[k]} ${M.labels[k]}</span></div>${why ? `<p>${why}</p>` : ''}` });
}
function flush() { for (const [k, d] of Object.entries(S.pending)) change(k, d, ''); S.pending = {}; }   // whatever a result clip did not show still counts
const fxHtml = fx => Object.entries(fx || {}).map(([k, v]) => `<i class="${v > 0 ? 'up' : 'dn'}">${(v > 0 ? '▲' : '▼').repeat(Math.abs(v))} ${STORY.meters.labels[k]}</i>`).join('');
const fxText = fx => Object.entries(fx || {}).map(([k, v]) => `${STORY.meters.labels[k]} ${v > 0 ? '▲' : '▼'}${Math.abs(v)}`).join(', ');   // arrows, never a plus sign (no cross shapes in the interface)

// a hint card: a tutorial line, a thing to learn, or a real record from NASA's data
function buildTip(id) {
  const s = S.storm, o = S.last, sp = STORY.specialists[S.vars.specialist];
  if (id === 'learn') id = o ? 'learn_' + o.id : '';
  if (id === 'door' && o?.opens) return { kind: 'door', small: o.opens.length > 1 ? 'Doors opened' : 'Door opened', text: o.opens.map(d => `<b>${STORY.specialists[d].icon} ${STORY.specialists[d].name}</b>`).join(' and ') + (o.opens.length > 1 ? '. You can pick either one at the academy.' : '. You can pick it at the academy.') };
  if (id === 'specialist' && sp) return { kind: 'door', small: 'You are the', text: `<b>${sp.icon} ${sp.name}</b>. ${sp.does} You get one <b>special move</b> in the storm.` };
  if (id === 'storm_flare' && s) return { kind: 'data', id: 'storm_' + s.key, title: `The storm of ${day(s.date)}`, small: 'Real storm · NASA DONKI', learn: true,
    text: `<b>${day(s.date)}</b>: a real <b>${s.flare.class} solar flare</b> began at ${clock(s.flare.start)}. Its particles arrived <b>${span(s.warningMin)}</b> later. That is your warning time.` };
  if (id === 'storm_particles' && s) return { kind: 'data', small: 'Real record · NASA DONKI', text: `Particles were first measured at <b>${clock(s.particles.time)}</b> by ${craft(s.particles.instrument)}: <b>${span(s.warningMin)}</b> after the flare.` };
  if (id === 'storm_cloud' && s?.cloud) return { kind: 'data', small: 'Real record · NASA DONKI', text: `The eruption's cloud left the Sun at <b>${s.cloud.speedMin === s.cloud.speedMax ? num(s.cloud.speedMax) : num(s.cloud.speedMin) + ' to ' + num(s.cloud.speedMax)} km per second</b>.` + (s.storm ? ` It reached Earth <b>${Math.round(s.storm.hoursAfterFlare)} hours</b> after the flare. Storm strength: <b>Kp ${s.storm.kpMax}</b> out of 9.` : '') };
  if (id === 'ending' && S.meters) { const M = STORY.meters, min = Math.min(...Object.values(S.meters)), low = Object.keys(S.meters).filter(k => S.meters[k] === min).map(k => `${M.icons[k]} ${M.labels[k]}`).join(' and ');
    return { kind: 'tutorial', small: 'Mission result', text: min >= 2 ? 'Nothing ran low: <b>all three</b> ended at 2 or more.' : min <= 0 ? `<b>${low}</b> hit zero. The crew flies home early.` : `<b>${low}</b> ended at ${min}. One thing ran low.` }; }
  const t = STORY.tips[id]; if (!t) return null;
  return { ...t, id, small: t.kind === 'tutorial' ? 'Tutorial' : 'Did you know · ' + t.title, learn: t.kind === 'learn' };
}
function showTip(id, { hold = false } = {}) {
  const t = buildTip(id); if (!t) return;
  tipHtml = `<div class="tip ${t.kind}"><small>${t.small}</small><p>${t.text}</p>${t.source && SRC[t.source]?.[1] ? `<span class="src">Source: ${host(SRC[t.source][1])}</span>` : ''}</div>`;
  const box = $('#notice'); box.innerHTML = tipHtml; const el = box.firstChild; requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('on'))); syncInfo(); beep(520, 0.05, 0.025);
  clearTimeout(showTip.t); if (!hold) showTip.t = setTimeout(() => el.classList.remove('on'), Math.max(4500, t.text.replace(/<[^>]+>/g, '').split(/\s+/).length * 430));
  if (t.learn && !S.learned.some(l => l.id === t.id)) S.learned.push({ id: t.id, title: t.title, text: t.text, source: t.source || (t.kind === 'data' ? 'donki' : '') });
}
function clearTip() { clearTimeout(showTip.t); const el = $('#notice').firstChild; if (el) el.classList.remove('on'); tipHtml = ''; syncInfo(); }
// upright phones: the same hint, and what each choice means, under the picture
function syncInfo() {
  const opts = $$('.opt.in').map(b => b._o).filter(Boolean);
  $('#info').innerHTML = tipHtml + (idle && node?.choice ? `<p class="ask">${node.choice.prompt}</p>` : '') + (opts.length && !$('#choices').classList.contains('done') ? `<ul class="legend">${opts.map((o, i) => `<li><b>${i + 1}. ${o.icon} ${o.label}</b>${o.about || ''}${o.effects ? ` <span>(${fxText(o.effects)})</span>` : ''}</li>`).join('')}</ul>` : '') + '<p class="turn">Turn your phone sideways for a bigger picture</p>';
}

// ---------- choices: built hidden; each one appears on the picture when the film names it
function optionsFor(n) {
  const c = n.choice;
  if (c.doors) { const ids = Object.keys(STORY.specialists).filter(id => S.open.has(id)), xs = c.doorX[ids.length] || ids.map((_, i) => (i + 1) * 100 / (ids.length + 1));   // only the doors you opened exist
    return ids.map((id, i) => ({ id, icon: STORY.specialists[id].icon, label: STORY.specialists[id].name, about: STORY.specialists[id].does, pos: [xs[i], c.doorY] })); }
  return c.options.filter(o => !o.only || o.only === S.vars.specialist).map(o => ({ ...o, special: !!o.only }));   // a move that belongs to another job is simply not there
}
function buildChoices(n) {
  const box = $('#choices'), list = optionsFor(n), c = n.choice; box.className = '';
  let set = null; if (c.list) { set = document.createElement('div'); set.className = 'set'; set.style.right = (100 - c.list[0]) + '%'; set.style.top = c.list[1] + '%'; box.appendChild(set); }
  list.forEach((o, i) => {
    const b = document.createElement('button'); b.className = 'opt' + (o.special ? ' special' : '') + (o.pos ? ' free' : ''); b.dataset.id = o.id; b.tabIndex = -1; b._o = o;
    if (o.pos) { b.style.left = o.pos[0] + '%'; b.style.top = o.pos[1] + '%'; }
    b.innerHTML = `<span class="key"><i>${i + 1}</i></span><span class="ic">${o.icon}</span><span class="tx">${o.special ? '<span class="only">Only you can do this</span>' : ''}<b>${o.label}</b>${o.about ? `<small>${o.about}</small>` : ''}${o.effects ? `<span class="fxs">${fxHtml(o.effects)}${o.later ? `<i class="dn">LATER ${Object.keys(o.later).map(k => '▼ ' + STORY.meters.labels[k]).join(' ')}</i>` : ''}</span>` : ''}</span>`;
    b.onclick = () => choose(n, o, b); (set || box).appendChild(b);
  });
  return list;
}
function reveal(id) { const b = $(`.opt[data-id="${id}"]`); if (!b || b.classList.contains('in') || $('#choices').classList.contains('done')) return; b.classList.add('in'); b.tabIndex = 0; beep(700 + 110 * $$('.opt.in').length, 0.07, 0.04); syncInfo(); }
function revealAll() { $$('.opt:not(.in)').forEach((b, i) => setTimeout(() => reveal(b.dataset.id), i * 160)); }
function clearChoices(delay = 0) {                                       // fades out the rows that are up now (never the next choice's)
  const kids = [...$('#choices').children]; if (!kids.length) return;
  setTimeout(() => { kids.forEach(k => k.classList.add('bye')); setTimeout(() => { kids.forEach(k => k.remove()); syncInfo(); }, 320); }, delay);
}
function stopTimer() { clearTimeout(timerId); clearTimeout(lateId); $('#timer').classList.remove('run', 'late'); }
function startTimer(n) {
  const c = n.choice, t = $('#timer'); stopTimer(); if (!c.timer || $('#noTimers').checked) return;
  t.style.setProperty('--secs', c.timer + 's'); void t.offsetWidth; t.classList.add('run'); lateId = setTimeout(() => t.classList.add('late'), c.timer * 700);
  timerId = setTimeout(() => { const list = optionsFor(n), o = list[Math.min(c.default || 0, list.length - 1)]; revealAll(); const b = $(`.opt[data-id="${o.id}"]`); b.classList.add('in'); choose(n, o, b); }, c.timer * 1000);
}
function choose(n, o, btn) {                                             // the pick lights up, the others go, and the film cuts straight to it
  if (busy || node !== n || !btn || !btn.classList.contains('in')) return; busy = true; idle = false; stopTimer();
  btn.classList.add('picked'); $('#choices').classList.add('done'); $('#prompt').hidden = true; beep(880, 0.08); setTimeout(() => beep(1320, 0.1), 80); clearTip();
  S.vars[n.choice.key] = o.id; S.last = o;
  if (o.opens) o.opens.forEach(id => S.open.add(id));
  if (o.effects) { S.pending = { ...o.effects }; S.log.push({ key: n.choice.key, id: o.id, label: o.label, icon: o.icon, effects: o.effects, later: o.later, why: o.why }); }
  go(n.next);
}

// ---------- the story
function startMission() {                                                // three meters, and one real storm from NASA's records (one you have not faced yet, if there is one)
  S.meters = { ...STORY.meters.start }; S.pending = {}; S.log = []; for (const k of ['m1', 'm2', 'm3', 'ending']) delete S.vars[k];
  const q = new URLSearchParams(location.search).get('storm'), alias = { jan: 's202601181727', may: 's202405110110', short: 's202511110949' }, keys = DONKI.game, st = store.get(), fresh = keys.filter(k => !(st.storms || []).includes(k)), pool = fresh.length ? fresh : keys;
  const pick = keys.includes(alias[q] || q) ? (alias[q] || q) : pool[Math.floor(Math.random() * pool.length)];
  S.storm = DONKI.storms.find(s => s.key === pick); S.vars.stormClip = S.storm.clip; st.storms = uniq([...(st.storms || []), pick]); store.set(st);
  $('#meters').innerHTML = ''; renderMeters();
}
function stormTax() {                                                    // the one rule that comes from the data: a short real warning costs shielding
  const R = STORY.storm, s = S.storm; if (!s || s.warningMin > R.shortWarningMin) return; const my = nav;
  setTimeout(() => { if (my !== nav) return;
    if (S.vars.m1 === R.taxWaivedFor) pop({ x: 0.5, y: 0.5, cls: 'tag', html: `<span>${R.waivedWhy}</span>`, dur: 3 });
    else { S.log.push({ key: 'storm', label: `Only ${span(s.warningMin)} of warning`, icon: '🌩️', effects: R.tax }); for (const [k, d] of Object.entries(R.tax)) change(k, d, `Only ${span(s.warningMin)} of warning: ${R.taxWhy.toLowerCase()}`, 0.5, 0.5); } }, 1600);
}
function settle() {                                                      // the night battery comes due, then the lowest meter decides
  flush(); const late = S.log.find(l => l.later && !l.spent);
  if (late) { late.spent = true; S.log.push({ key: 'night', label: 'The spent night battery', icon: '🔋', effects: late.later }); for (const [k, d] of Object.entries(late.later)) change(k, d, 'The night battery is empty now', 0.5, 0.5); }
  const min = Math.min(...Object.values(S.meters)); S.vars.ending = min <= 0 ? 'evac' : min >= 2 ? 'thrive' : 'lesson';
}
async function go(id) {
  const my = ++nav; node = STORY.nodes[id]; if (!node) return; node.id = id; idle = false; stopTimer(); $('#prompt').hidden = true;
  if (node.screen === 'chapter') return showChapter(id);
  if (node.screen === 'finale') return showFinale();
  if (node.meters) startMission();
  if (node.ending) settle();
  const name = fill(node.clip), nx = STORY.nodes[node.next];
  const v = await cut(name, { my }); if (my !== nav || !v) return;
  dock(); busy = false; clearChoices($('#choices').classList.contains('done') ? 520 : 0);   // the pick stays lit for a moment over the clip it led to
  objective(); setBed(bedFor(node), 0.3); if (S.meters && !node.meters) $$('.meter').forEach(m => m.classList.add('show'));
  const list = node.choice ? buildChoices(node) : null;
  if (node.tax) stormTax();
  // while this plays: fetch whatever can follow, and put the sure thing on the other video element, on its first frame
  if (list && nx?.clip) prefetch(list.map(o => nx.clip.replace(`{${node.choice.key}}`, o.id).replace(/\{(\w+)\}/g, (_, k) => S.vars[k] ?? '')));
  const after = nx?.clip ? fill(nx.clip) : null; if (list) preload(fill(node.loop), true); else preload(after);
  await ended(v, my, name); if (my !== nav) return;
  while (Q.length) fire(Q.shift());                                      // a cue on the clip's last frames still counts
  if (node.result) flush();
  if (list) {
    revealAll(); const lv = await cut(fill(node.loop), { loop: true, my }); if (my !== nav || !lv) return;
    idle = true; setBed(bedFor(node), 0.6); $('#prompt span').textContent = node.choice.prompt; $('#prompt').hidden = false; startTimer(node); if (node.idleTip) showTip(node.idleTip, { hold: true }); syncInfo();
  } else go(node.next);
}
function fire(c) {                                                       // a cue from the clip, on its frame
  if (c.ui === 'opt') { reveal(c.id); if (!Q.some(q => q.ui === 'opt')) setTimeout(() => { if (node?.choice) revealAll(); }, 600); }
  else if (c.ui === 'meter') { const m = $(`.meter[data-k="${c.id}"]`); if (m) { m.classList.add('show'); beep(700 + 180 * ['power', 'air', 'shield'].indexOf(c.id), 0.1); } }
  else if (c.ui === 'tip') showTip(c.id);
  else if (c.ui === 'cut') dock();
  else if (c.ui === 'tag') pop({ x: c.x, y: c.y, cls: 'tag', html: `<span>${c.text}</span>`, dur: c.dur || 2.2 });
  else if (c.ui === 'fx' && S.meters && node?.result) { change(c.k, c.d, c.text, c.x, c.y); S.pending[c.k] = (S.pending[c.k] || 0) - c.d; if (!S.pending[c.k]) delete S.pending[c.k]; }
}
function frame() {                                                       // every display frame: fire the clip's cues, show its captions
  const v = vids[cur], t = v.currentTime;
  if (!v.loop && !v.paused) while (Q.length && t >= Q[0].t) fire(Q.shift());
  const caps = CLIPS?.[clipName]?.captions, el = $('#caption'); let hit = null;
  if (caps && $('#capsOn').checked && !v.loop) for (const c of caps) if (t >= c.t0 && t < c.t1) { hit = c; break; }
  if (hit) { if (el.textContent !== hit.text) el.textContent = hit.text; el.className = 'on ' + hit.who; } else if (el.className) el.className = '';
  requestAnimationFrame(frame);
}

// ---------- the card after chapter 1, and the mission report
function showChapter(id) {
  const sp = STORY.specialists[S.vars.specialist], opt = (k, key) => STORY.nodes[k].choice.options.find(o => o.id === S.vars[key]), a = opt('tv', 'c1'), b = opt('fair', 'c2');
  const seen = store.get(); seen.specs = uniq([...(seen.specs || []), S.vars.specialist]); seen.kids = uniq([...(seen.kids || []), S.vars.c1 + '+' + S.vars.c2]); store.set(seen);
  $('#chTitle').innerHTML = `You are the <b>${sp.name}</b> ${sp.icon}`; $('#chDoes').textContent = sp.does + ' In the storm you get one special move that nobody else has.';
  $('#chFlow').innerHTML = [['Launch night', a], ['Space competition', b], ['The academy', { icon: sp.icon, label: sp.name }]].map(([s, o], i) => `${i ? '<span class="fline"></span>' : ''}<div class="fnode ${i === 2 ? 'me' : ''}"><small>${s}</small><b>${o.icon} ${o.label}</b></div>`).join('');
  $('#chNext').innerHTML = `A storm from the Sun is heading for the Moon base. ${STORY.chapters[2].goal}`;
  $('#chHint').textContent = `Found on this device: ${seen.specs.length} of 5 space jobs, ${seen.kids.length} of 9 childhoods. A different childhood opens different doors.`;
  $('#contBtn').onclick = () => { $('#chapter').hidden = true; go(STORY.nodes[id].next); };
  $('#againBtn').onclick = () => { $('#chapter').hidden = true; restart(); };
  $('#objective').hidden = true; clearTip(); clearChoices(); setBed('bed_c1', 0.45); $('#chapter').hidden = false;
}
function restart() { S.vars = {}; S.open.clear(); S.meters = null; S.pending = {}; S.log = []; S.storm = null; S.learned = []; S.last = null; busy = false; renderMeters(); clearTip(); $('#tags').innerHTML = ''; $('#dock').innerHTML = ''; go('tv'); }
function showFinale() {
  const E = STORY.endings[S.vars.ending], M = STORY.meters, sp = STORY.specialists[S.vars.specialist], s = S.storm, rp = STORY.realPath, keys = Object.keys(S.meters);
  const min = Math.min(...Object.values(S.meters)), lows = keys.filter(k => S.meters[k] === min);
  const cause = lows.map(k => { const hits = S.log.filter(l => (l.effects[k] || 0) < 0).map(l => `${l.icon} ${l.label}`); return `<b>${M.icons[k]} ${M.labels[k]}</b> ended at ${S.meters[k]} of 5${hits.length ? ': spent by ' + hits.join(' and ') : ''}.`; }).join(' ');
  const seen = store.get(); seen.ends = uniq([...(seen.ends || []), S.vars.ending]); seen.learned = uniq([...(seen.learned || []), ...S.learned.map(l => l.id)]); store.set(seen);
  $('#fnEyebrow').textContent = 'Mission report · ' + E.name; $('#fnTitle').textContent = E.title; $('#fnLine').textContent = E.line;
  $('#fnMeters').innerHTML = keys.map(k => `<div class="stat ${S.meters[k] <= 1 ? 'bad' : 'good'}">${M.icons[k]} ${M.labels[k]} <b>${S.meters[k]}</b></div>`).join('');
  $('#fnCause').innerHTML = (min >= 2 ? 'You kept all three in balance. ' : STORY.endings.rule + ' ') + cause;
  // the decisions, with only the options this player was offered
  const extra = S.log.filter(l => l.key === 'storm' || l.key === 'night').map(l => `<div class="frow"><span class="fq">${l.key === 'storm' ? 'The storm' : 'Later'}</span><div class="fnode me"><small>It happened</small><b>${l.icon} ${l.label}</b><em>${fxHtml(l.effects)}</em></div></div>`).join('');
  $('#fnFlow').innerHTML = ['flare', 'particles', 'peak'].map((k, i) => { const c = STORY.nodes[k].choice, list = c.options.filter(o => !o.only || o.only === S.vars.specialist);
    return `<div class="frow"><span class="fq">${STORY.chapters[2].steps[i]}</span>${list.map(o => { const me = S.vars[c.key] === o.id; return `<div class="fnode ${me ? 'me' : ''}"><small>${me ? 'You chose' : 'Not taken'}</small><b>${o.icon} ${o.label}</b><em>${fxHtml(o.effects)}</em>${me ? `<span>${o.why}</span>` : ''}</div>`; }).join('')}</div>`; }).join('') + extra;
  // the storm's own records
  const all = DONKI.storms.map(x => x.warningMin).sort((p, q) => p - q), med = all[Math.floor(all.length / 2)], ids = [s.flare.id, s.particles.id, s.cloud?.id, s.storm?.id].filter(Boolean);
  $('#fnStorm').innerHTML = `<dl><dt>Flare</dt><dd><b>${s.flare.class}</b> solar flare, ${day(s.date)}, ${clock(s.flare.start)}${s.flare.activeRegion ? ` (active region ${s.flare.activeRegion})` : ''}</dd>
    <dt>Particles</dt><dd>first measured at ${clock(s.particles.time)} by ${craft(s.particles.instrument)}: <b>${span(s.warningMin)}</b> of warning</dd>
    ${s.cloud ? `<dt>Cloud</dt><dd>left the Sun at ${clock(s.cloud.start)}, travelling at ${s.cloud.speedMin === s.cloud.speedMax ? num(s.cloud.speedMax) : num(s.cloud.speedMin) + ' to ' + num(s.cloud.speedMax)} km per second</dd>` : ''}
    ${s.storm ? `<dt>Storm</dt><dd>reached Earth ${s.storm.hoursAfterFlare} hours after the flare; strength Kp ${s.storm.kpMax} out of 9</dd>` : ''}</dl>
    NASA's records since ${DONKI.range[0].slice(0, 4)} link ${all.length} flares to measured particle events. The shortest warning was ${span(all[0])}; half gave less than ${span(med)}. Each time you play, the game draws one of ${DONKI.game.length} of these storms.
    <span class="ids">NASA DONKI records: ${ids.join(', ')}. Pulled from api.nasa.gov on ${day(DONKI.pulled)}. Archived data, not live.</span>
    <a href="${s.flare.link}" target="_blank" rel="noopener">The flare alert</a> · <a href="${s.particles.link}" target="_blank" rel="noopener">The particle record</a>${s.storm ? ` · <a href="${s.storm.link}" target="_blank" rel="noopener">The storm record</a>` : ''}`;
  $('#fnLearn').innerHTML = S.learned.map(l => `<li><strong>${l.title}</strong>${l.text}${l.source ? link(l.source) : ''}</li>`).join('') || '<li>Play on to collect what you learn.</li>';
  $('#fnPathTitle').textContent = `Your real path to ${sp.name.toLowerCase()}`;
  $('#fnPath').innerHTML = `<ul>${rp.common.map(([w, t, src]) => `<li><em>${w}:</em> ${t}${link(src)}</li>`).join('')}<li><em>Study:</em> ${rp[S.vars.specialist].study}.</li><li><em>Real today:</em> ${rp[S.vars.specialist].real}${link(rp[S.vars.specialist].source)}</li></ul>`;
  $('#fnHint').textContent = `On this device: ${(seen.storms || []).length} of ${DONKI.game.length} real storms faced, ${seen.ends.length} of 3 endings, ${seen.learned.length} things learned. Each space job has its own special move.`;
  $('#stormAgain').onclick = () => { $('#finale').hidden = true; S.learned = []; go('mission'); };
  $('#newLife').onclick = () => { $('#finale').hidden = true; restart(); };
  $('#objective').hidden = true; clearTip(); clearChoices(); setBed(null); $('#finale').style.setProperty('--poster', `url(p/end_${S.vars.ending}.jpg)`); $('#finale').hidden = false; $('#finale').scrollTop = 0;
}

// ---------- start
async function boot() {
  [STORY, CLIPS, DONKI] = await Promise.all(['story.json', 'clips.json', 'data/donki.json'].map(f => fetch(f).then(r => r.json())));
  prefetch(['open', 'intro', 'tv']); $('#start').style.setProperty('--poster', 'url(p/open.jpg)');
  $('#sources').innerHTML = Object.values(SRC).map(([t, u]) => `<li>${t}${u ? ` <a href="${u}" target="_blank" rel="noopener">${host(u)}</a>` : ''}</li>`).join('');
  $('#aboutData').textContent = `This copy holds ${DONKI.counts.particleEvents} particle events and ${DONKI.counts.geomagneticStorms} geomagnetic storms from ${day(DONKI.range[0])} to ${day(DONKI.range[1])}, pulled on ${day(DONKI.pulled)}. ${DONKI.counts.flaresWithParticles} flares are linked to measured particles; each run draws one of ${DONKI.game.length} storms that have the full chain of records, and its real numbers are the ones you see and hear.`;
  $('#startBtn').onclick = () => {
    try { actx = new (window.AudioContext || window.webkitAudioContext)(); actx.resume(); } catch { actx = null; }
    for (const v of vids) { v.src = urls.get('open') || 'v/open.mp4'; const p = v.play(); if (p) p.then(() => { if (!v._name) v.pause(); }).catch(() => {}); }   // this tap lets both video elements play with sound later
    $('#start').hidden = true; beep(660, 0.1);
    const q = new URLSearchParams(location.search), at = q.get('at');
    if (at && STORY.nodes[at] && at !== 'open') {                       // for testing: jump in part-way with a made-up past
      S.vars.c1 = q.get('c1') || 'engines'; S.vars.c2 = q.get('c2') || 'seeds'; S.vars.specialist = q.get('as') || 'farmer';
      for (const k of ['tv', 'fair']) STORY.nodes[k].choice.options.filter(o => o.id === S.vars.c1 || o.id === S.vars.c2).forEach(o => o.opens.forEach(d => S.open.add(d))); S.open.add(S.vars.specialist);
      if (STORY.nodes[at].chapter === 2 && at !== 'mission') startMission();
      for (const n of Object.values(STORY.nodes)) { const c = n.choice, id = c && q.get(c.key), o = id && (c.options || []).find(x => x.id === id);   // e.g. at=m2r&m2=m2b
        if (o) { S.vars[c.key] = id; if (n.next === at) { S.last = o; S.pending = { ...o.effects }; S.log.push({ key: c.key, id, label: o.label, icon: o.icon, effects: o.effects, later: o.later, why: o.why }); } } }
    }
    go(at && STORY.nodes[at] ? at : STORY.start);
  };
  for (const b of ['#menuBtn', '#aboutBtn2']) $(b).onclick = () => $('#about').showModal();
  $('#aboutClose').onclick = () => $('#about').close();
  $('#musicOn').onchange = () => setBed(node && !node.screen ? bedFor(node) : null, idle ? 0.6 : 0.3);
  document.addEventListener('keydown', e => { if ($('#about').open) return; const b = $$('.opt.in')[+e.key - 1]; if (b && !$('#choices').classList.contains('done')) b.click(); });
  requestAnimationFrame(frame);
  window.JAMT = { S, go, get node() { return node; }, get clip() { return clipName; }, get idle() { return idle; } };   // for testing
}
boot();
