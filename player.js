// Junior Astronaut Mission Trainer: the branching player.
// A small state machine (story.json) drives two stacked <video> elements: one plays, the other is loaded with what
// comes next, and they cross-fade. An idle loop plays behind every choice. Three meters (power, air, shielding)
// move with every mission decision. Nothing is collected or sent anywhere.
// Code written with AI assistance (Claude Fable 5.2).
const $ = s => document.querySelector(s);
const vids = [$('#vA'), $('#vB')];
let STORY, CLIPS, cur = 0, node = null, clipName = null, nav = 0, actx = null, loopSrc = null, loopGain = null, timerId = 0;
const S = { vars: {}, open: new Set(), meters: null, log: [] };
const blobs = new Map(), abufs = new Map();
// public sources for every real fact shown in the film
const SRC = {
  donki: ['Storm timings and sizes: NASA DONKI (Space Weather Database Of Notifications, Knowledge, Information), Community Coordinated Modeling Center. Archived events, not live.', 'https://ccmc.gsfc.nasa.gov/tools/DONKI/'],
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
const wait = ms => new Promise(r => setTimeout(r, ms));
const link = k => (SRC[k] && SRC[k][1] ? ` <a href="${SRC[k][1]}" target="_blank" rel="noopener">Source</a>` : '');
const store = { get() { try { return JSON.parse(localStorage.getItem('jamt1') || '{}'); } catch { return {}; } }, set(v) { try { localStorage.setItem('jamt1', JSON.stringify(v)); } catch { /* private window: fine */ } } };

// ---------- media
function prefetch(names) { for (const n of names) if (n && CLIPS[n] && !blobs.has(n)) blobs.set(n, fetch(`v/${n}.mp4`).then(r => (r.ok ? r.blob() : Promise.reject())).then(b => URL.createObjectURL(b)).catch(() => `v/${n}.mp4`)); }
async function playClip(name, { loop = false } = {}) {
  prefetch([name]); const url = await blobs.get(name), v = vids[1 - cur], old = vids[cur];
  v.loop = loop; v.muted = loop; v.src = url;
  try { await v.play(); } catch { v.muted = true; await v.play().catch(() => {}); }
  v.classList.add('on'); old.classList.remove('on'); cur = 1 - cur; clipName = name;
  setTimeout(() => { if (vids[cur] !== old) { old.pause(); } }, 340);
  return v;
}
const ended = v => new Promise(r => { const done = () => { v.removeEventListener('ended', done); clearTimeout(t); r(); }; v.addEventListener('ended', done); const t = setTimeout(done, ((CLIPS[clipName]?.duration || 10) + 2.5) * 1000); });
function beep(f = 660, d = 0.09, g = 0.08, type = 'triangle') { if (!actx) return; const o = actx.createOscillator(), a = actx.createGain(); o.type = type; o.frequency.value = f; a.gain.setValueAtTime(g, actx.currentTime); a.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + d); o.connect(a).connect(actx.destination); o.start(); o.stop(actx.currentTime + d + 0.02); }
async function loopAudio(name) {       // the idle loop's music repeats seamlessly under the choice
  stopLoopAudio(); if (!actx || !name) return; const my = nav;
  try {
    if (!abufs.has(name)) abufs.set(name, fetch(`a/${name}.wav`).then(r => r.arrayBuffer()).then(b => actx.decodeAudioData(b)));
    const buf = await abufs.get(name); if (my !== nav) return;
    loopSrc = actx.createBufferSource(); loopSrc.buffer = buf; loopSrc.loop = true; loopGain = actx.createGain(); loopGain.gain.value = 0.0001;
    loopSrc.connect(loopGain).connect(actx.destination); loopSrc.start(); loopGain.gain.exponentialRampToValueAtTime(0.7, actx.currentTime + 0.5);
  } catch { /* no loop music: the film still plays */ }
}
function stopLoopAudio() { if (loopSrc) { const s = loopSrc, g = loopGain; try { g.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + 0.3); s.stop(actx.currentTime + 0.35); } catch { /* already stopped */ } loopSrc = null; } }

// ---------- the five doors and the three meters
const specs = () => Object.entries(STORY.specialists);
function renderDoors() { $('#doors').innerHTML = specs().map(([id, s]) => `<div class="door" data-id="${id}" title="${s.name}">${s.icon}</div>`).join(''); }
function syncDoors(pop = []) {
  for (const d of document.querySelectorAll('.door')) { const id = d.dataset.id; d.classList.toggle('open', S.open.has(id)); d.classList.toggle('me', S.vars.specialist === id);
    if (pop.includes(id)) { d.classList.remove('pop'); void d.offsetWidth; d.classList.add('pop'); } }
}
function renderMeters(shown) {
  const M = STORY.meters, el = $('#meters'); if (!S.meters) { el.hidden = true; return; } el.hidden = false;
  const was = shown || [...document.querySelectorAll('.meter.show')].map(m => m.dataset.k);
  el.innerHTML = Object.keys(M.start).map(k => `<div class="meter ${was.includes(k) ? 'show' : ''} ${S.meters[k] <= 1 ? 'low' : ''}" data-k="${k}"><span class="mi">${M.icons[k]}</span><span class="ml">${M.labels[k]}</span><span class="pips">${[0, 1, 2, 3, 4].map(i => `<i class="${i < S.meters[k] ? 'on' : ''}"></i>`).join('')}</span></div>`).join('');
}
const fxText = fx => Object.entries(fx || {}).map(([k, v]) => `${STORY.meters.labels[k]} ${v > 0 ? '▲' : '▼'}${Math.abs(v) > 1 ? Math.abs(v) : ''}`).join(' · ');
function applyEffects(fx) {
  const M = STORY.meters;
  for (const [k, v] of Object.entries(fx || {})) S.meters[k] = Math.max(M.scale[0], Math.min(M.scale[1], S.meters[k] + v));
  renderMeters();
  for (const [k, v] of Object.entries(fx || {})) { const m = document.querySelector(`.meter[data-k="${k}"]`); if (m) { m.classList.add('show', v > 0 ? 'up' : 'down'); setTimeout(() => m.classList.remove('up', 'down'), 1500); } }
}
function toast(text, ms = 2200) { const t = $('#toast'); t.textContent = text; t.classList.add('on'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('on'), ms); }
const opener = id => { for (const n of Object.values(STORY.nodes)) for (const o of n.choice?.options || []) if (o.opens?.includes(id)) return `${o.icon} ${o.label}`; return ''; };

// ---------- choices
function hidePanel() { $('#panel').hidden = true; $('#timer').classList.remove('run'); clearTimeout(timerId); }
function optionsFor(n) {
  const c = n.choice;
  if (c.doors) return specs().map(([id, s]) => ({ id, icon: s.icon, label: s.name, locked: !S.open.has(id), hint: S.open.has(id) ? s.does : 'Locked. Opens with: ' + opener(id) }));
  return c.options.filter(o => !o.only || o.only === S.vars.specialist).map(o => ({ ...o, hint: o.effects ? fxText(o.effects) + (o.later ? ' · later ' + fxText(o.later) : '') : o.hint, special: !!o.only }));
}
function showChoices(n) {
  const c = n.choice, box = $('#options'); box.innerHTML = ''; box.classList.toggle('five', !!c.doors); $('#prompt').textContent = c.prompt; $('#fact').hidden = true; $('#timer').hidden = true;
  optionsFor(n).forEach(o => {
    const b = document.createElement('button'); b.className = 'opt' + (o.locked ? ' locked' : '') + (o.special ? ' special' : '');
    b.innerHTML = `<span class="ic">${o.icon}</span><span>${o.label}${o.special ? ' <em>only you</em>' : ''}${o.hint ? `<small>${o.hint}</small>` : ''}</span>`;
    b.onclick = () => { if (o.locked) { b.classList.remove('shake'); void b.offsetWidth; b.classList.add('shake'); beep(180, 0.12, 0.07, 'square'); toast('That door is locked. It opens with: ' + opener(o.id)); return; } choose(n, o, b); };
    box.appendChild(b);
  });
  $('#panel').hidden = false;
}
function showFact(n) {
  const f = n.fact, el = $('#fact'); if (!f) return;
  if (f.storm) { const st = STORY.storms[S.vars.storm]; el.innerHTML = `Real storm, from NASA's archive: ${st.flare} solar flare, ${st.date}. Particles followed in ${st.warning}.${link('donki')}`; }
  else el.innerHTML = f.text + link(f.source);
  el.hidden = false;
}
function startTimer(n) {
  const c = n.choice; showFact(n);
  if (!c.timer || $('#noTimers').checked) return;
  const t = $('#timer'), list = optionsFor(n); t.hidden = false; t.style.setProperty('--secs', c.timer + 's'); t.classList.remove('run'); void t.offsetWidth; t.classList.add('run');
  timerId = setTimeout(() => { const i = Math.min(c.default || 0, list.length - 1), o = list[i]; toast('Time is up: ' + o.label); choose(n, o, document.querySelectorAll('.opt')[i]); }, c.timer * 1000);
}
async function choose(n, o, btn) {
  if (choose.busy) return; choose.busy = true; const my = ++nav; clearTimeout(timerId); $('#timer').classList.remove('run'); stopLoopAudio();
  btn?.classList.add('picked'); beep(880, 0.08); S.vars[n.choice.key] = o.id;
  if (o.opens) { const fresh = o.opens.filter(id => !S.open.has(id)); o.opens.forEach(id => S.open.add(id)); syncDoors(o.opens); setTimeout(() => beep(1320, 0.12), 110);
    toast((fresh.length ? 'Door opened: ' : 'Already open: ') + o.opens.map(id => STORY.specialists[id].name).join(' and ')); }
  else if (o.effects) { S.log.push({ key: n.choice.key, id: o.id, label: o.label, icon: o.icon, effects: o.effects, later: o.later }); applyEffects(o.effects); toast(fxText(o.effects), 2600); setTimeout(() => beep(520, 0.14), 110); }
  else { syncDoors([o.id]); toast('You are the ' + STORY.specialists[o.id].name); }
  await wait(o.effects ? 900 : 520); choose.busy = false; if (my === nav) go(n.next, o.effects ? `<b>${o.icon} ${o.label}.</b> ${o.why} <span class="fx">${fxText(o.effects)}</span>` : null);
}

// ---------- the story
async function go(id, note = null) {
  const my = ++nav; node = STORY.nodes[id]; hidePanel(); stopLoopAudio();
  if (!node) return;
  node.id = id;
  if (node.screen === 'chapter') return showChapter(id);
  if (node.screen === 'finale') return showFinale();
  $('#doors').classList.toggle('show', id !== 'open' && node.chapter === 1);
  if (node.meters) {                                                  // the mission begins: three meters, and one real storm drawn from the archive
    S.meters = { ...STORY.meters.start }; S.log = []; const q = new URLSearchParams(location.search).get('storm');
    S.vars.storm = q && STORY.storms[q] ? q : (Math.random() < 0.5 ? 'jan' : 'may'); for (const k of ['m1', 'm2', 'm3', 'ending']) delete S.vars[k]; renderMeters([]);
  }
  if (node.tax) { const st = STORY.storms[S.vars.storm]; if (st.tax) { if (S.vars.m1 === st.taxWaivedFor) setTimeout(() => toast(st.waivedNote, 3200), 1200); else setTimeout(() => { S.log.push({ key: 'storm', label: 'The storm (one hour of warning)', icon: '🌩️', effects: st.tax }); applyEffects(st.tax); toast(st.taxNote, 3800); }, 1200); } }
  if (node.ending) {
    const late = S.log.find(l => l.later); if (late) { S.log.push({ key: 'night', label: 'The spent night battery', icon: '🔋', effects: late.later }); applyEffects(late.later); toast('The night battery is spent: ' + fxText(late.later), 3200); }
    const min = Math.min(...Object.values(S.meters)); S.vars.ending = min <= 0 ? 'evac' : min >= 2 ? 'thrive' : 'lesson';
  }
  if (note) { $('#panel').hidden = false; $('#prompt').textContent = ''; $('#options').innerHTML = ''; $('#timer').hidden = true; $('#fact').innerHTML = note; $('#fact').hidden = false; }   // why that choice moved the meters, shown under its clip
  const name = fill(node.clip), meta = CLIPS[name] || {};
  const nexts = [], nx = STORY.nodes[node.next];                       // load what can come next while this plays
  if (node.loop) nexts.push(node.loop);
  if (nx?.clip) { if (node.choice?.doors) [...S.open].forEach(s => nexts.push(nx.clip.replace('{specialist}', s))); else if (node.choice) optionsFor(node).forEach(o => nexts.push(nx.clip.replace(`{${node.choice.key}}`, o.id))); else if (!nx.ending) nexts.push(fill(nx.clip)); }
  prefetch(nexts.filter(n => !n.includes('{')));
  const v = await playClip(name); if (my !== nav) return;
  let shown = false; const ui = [...(meta.ui || [])];
  const tick = () => {
    while (ui.length && v.currentTime >= ui[0].t) { const u = ui.shift(); if (u.ui === 'meter' && S.meters) { const m = document.querySelector(`.meter[data-k="${u.id}"]`); if (m) { m.classList.add('show'); beep(700 + 180 * ['power', 'air', 'shield'].indexOf(u.id), 0.1); } } }
    if (node.choice && !shown && meta.choicesAt != null && v.currentTime >= meta.choicesAt) { shown = true; showChoices(node); }
  };
  v.addEventListener('timeupdate', tick); await ended(v); v.removeEventListener('timeupdate', tick); if (my !== nav) return;
  if (S.meters) document.querySelectorAll('.meter').forEach(m => m.classList.add('show'));
  if (node.choice) { if (!shown) showChoices(node); await playClip(node.loop, { loop: true }); if (my !== nav) return; loopAudio(node.loop); startTimer(node); }
  else go(node.next);
}
function showChapter(id) {
  const sp = STORY.specialists[S.vars.specialist], opt = (k, key) => STORY.nodes[k].choice.options.find(o => o.id === S.vars[key]);
  const a = opt('tv', 'c1'), b = opt('fair', 'c2'), seen = store.get(); seen.specs = [...new Set([...(seen.specs || []), S.vars.specialist])]; seen.kids = [...new Set([...(seen.kids || []), S.vars.c1 + '+' + S.vars.c2])]; store.set(seen);
  $('#chTitle').textContent = `You are the ${sp.name}.`;
  $('#chPath').innerHTML = `<span class="chip">${a.icon} ${a.label}</span><span>then</span><span class="chip">${b.icon} ${b.label}</span><span>opened</span><span class="chip me">${sp.icon} ${sp.name}</span>`;
  $('#chHint').textContent = `Found on this device: ${seen.specs.length} of 5 specialists, ${seen.kids.length} of 9 childhoods. Locked doors open with a different childhood.`;
  $('#chDoors').innerHTML = specs().map(([sid, s]) => `<div class="tile ${S.open.has(sid) ? 'open' : ''} ${sid === S.vars.specialist ? 'me' : ''}"><b>${s.icon}</b>${s.name}${S.open.has(sid) ? '' : '<br>🔒 ' + opener(sid)}</div>`).join('');
  const more = !!CLIPS[STORY.nodes[STORY.nodes[id].next]?.clip]; $('#contBtn').disabled = !more; $('#contBtn').textContent = more ? 'Continue to the Moon' : 'The Moon mission is coming next';
  $('#contBtn').onclick = () => { $('#chapter').hidden = true; go(STORY.nodes[id].next); };
  $('#againBtn').onclick = () => { $('#chapter').hidden = true; restart(); };
  vids.forEach(v => v.pause()); $('#chapter').style.setProperty('--poster', `url(p/${fill('reveal_{specialist}')}.jpg)`); $('#chapter').hidden = false;
}
function restart() { S.vars = {}; S.open.clear(); S.meters = null; S.log = []; renderMeters(); syncDoors(); $('#doors').classList.remove('show'); go('tv'); }
function showFinale() {
  const E = STORY.endings[S.vars.ending], M = STORY.meters, sp = STORY.specialists[S.vars.specialist], st = STORY.storms[S.vars.storm], rp = STORY.realPath;
  const min = Math.min(...Object.values(S.meters)), lows = Object.keys(S.meters).filter(k => S.meters[k] === min);
  const cause = lows.map(k => { const hits = S.log.filter(l => (l.effects[k] || 0) < 0).map(l => `${l.icon} ${l.label}`); return `<b>${M.icons[k]} ${M.labels[k]}</b> ended at ${S.meters[k]} of 5${hits.length ? ': spent by ' + hits.join(' and ') : ''}.`; }).join(' ');
  const seen = store.get(); seen.ends = [...new Set([...(seen.ends || []), S.vars.ending])]; store.set(seen);
  $('#fnEyebrow').textContent = { thrive: 'Ending: the outpost thrives', lesson: 'Ending: safe, with a lesson', evac: 'Ending: home early, safe' }[S.vars.ending];
  $('#fnTitle').textContent = E.title; $('#fnLine').textContent = E.line;
  $('#fnMeters').innerHTML = Object.keys(S.meters).map(k => `<span class="chip ${S.meters[k] === min && min < 2 ? 'bad' : ''}">${M.icons[k]} ${M.labels[k]} ${S.meters[k]}/5</span>`).join('');
  $('#fnCause').innerHTML = (min >= 2 ? 'You kept all three in balance. ' : STORY.endings.rule + ' ') + cause;
  $('#fnFlow').innerHTML = ['flare', 'particles', 'peak'].map((k, i) => { const c = STORY.nodes[k].choice; return `<div class="frow"><span class="fq">Decision ${i + 1}</span>${c.options.map(o => { const mine = S.vars[c.key] === o.id, locked = o.only && o.only !== S.vars.specialist; return `<span class="fchip ${mine ? 'me' : ''} ${locked ? 'lock' : ''}">${locked ? '🔒 ' + STORY.specialists[o.only].icon : o.icon} ${o.label}<small>${locked ? 'only the ' + STORY.specialists[o.only].name : fxText(o.effects)}</small></span>`; }).join('')}</div>`; }).join('');
  $('#fnStorm').innerHTML = `<b>The storm was real.</b> ${st.facts} <span class="ids">NASA DONKI event IDs: ${st.ids.join(', ')}. Archived data, not live.</span> <a href="${st.link}" target="_blank" rel="noopener">See the NASA record</a>`;
  $('#fnPath').innerHTML = `<b>${sp.icon} Your real path to ${sp.name.toLowerCase()}</b><ul>${rp.common.map(([w, t, s]) => `<li><em>${w}:</em> ${t}${link(s)}</li>`).join('')}<li><em>Study:</em> ${rp[S.vars.specialist].study}.</li><li><em>Real today:</em> ${rp[S.vars.specialist].real}${link(rp[S.vars.specialist].source)}</li></ul>`;
  $('#fnHint').textContent = `Endings found on this device: ${seen.ends.length} of 3. Each specialist has a different special move, and the storm is drawn again each time.`;
  $('#stormAgain').onclick = () => { $('#finale').hidden = true; go('mission'); };
  $('#newLife').onclick = () => { $('#finale').hidden = true; restart(); };
  hidePanel(); vids.forEach(v => v.pause()); $('#finale').style.setProperty('--poster', `url(p/end_${S.vars.ending}.jpg)`); $('#finale').hidden = false; $('#finale').scrollTop = 0;
}

// ---------- captions
function captions() {
  const v = vids[cur], caps = CLIPS?.[clipName]?.captions, el = $('#caption'); let hit = null;
  if (caps && $('#capsOn').checked && !v.loop) for (const c of caps) if (v.currentTime >= c.t0 && v.currentTime < c.t1) { hit = c; break; }
  if (hit) { if (el.textContent !== hit.text) el.textContent = hit.text; el.className = 'on ' + hit.who; } else el.className = '';
  requestAnimationFrame(captions);
}

// ---------- start
async function boot() {
  [STORY, CLIPS] = await Promise.all([fetch('story.json').then(r => r.json()), fetch('clips.json').then(r => r.json())]);
  renderDoors(); prefetch(['open', 'tv']); $('#start').style.setProperty('--poster', 'url(p/open.jpg)');
  $('#sources').innerHTML = Object.values(SRC).map(([t, u]) => `<li>${t}${u ? ` <a href="${u}" target="_blank" rel="noopener">${u.replace(/^https?:\/\//, '').split('/')[0]}</a>` : ''}</li>`).join('');
  $('#startBtn').onclick = async () => {
    try { actx = new (window.AudioContext || window.webkitAudioContext)(); await actx.resume(); } catch { actx = null; }
    const b = vids[1]; b.muted = true; b.src = await blobs.get('open'); b.play().then(() => b.pause()).catch(() => {});   // let both video elements play later without another tap
    $('#start').hidden = true; beep(660, 0.1);
    const q = new URLSearchParams(location.search), at = q.get('at');
    if (at && at !== 'open' && at !== 'tv') { S.vars.c1 = q.get('c1') || 'engines'; S.vars.c2 = q.get('c2') || 'seeds'; S.vars.specialist = q.get('as') || 'farmer'; for (const k of ['tv', 'fair']) STORY.nodes[k].choice.options.filter(o => o.id === S.vars.c1 || o.id === S.vars.c2).forEach(o => o.opens.forEach(d => S.open.add(d))); S.open.add(S.vars.specialist); syncDoors(); }
    go(at || STORY.start);
  };
  for (const btn of ['#aboutBtn', '#aboutBtn2']) if ($(btn)) $(btn).onclick = () => $('#about').showModal();
  $('#aboutClose').onclick = () => $('#about').close();
  document.addEventListener('keydown', e => { const i = '123456'.indexOf(e.key); const b = document.querySelectorAll('.opt')[i]; if (i >= 0 && b && !$('#panel').hidden) b.click(); });
  requestAnimationFrame(captions);
  window.JAMT = { S, go, get node() { return node; }, get clip() { return clipName; } };   // for testing
}
boot();
