'use strict';

(() => {
  const $ = (id) => document.getElementById(id);
  const screens = {
    title: $('scr-title'),
    setup: $('scr-setup'),
    howto: $('scr-howto'),
    credits: $('scr-credits'),
    pause: $('scr-pause'),
    result: $('scr-result'),
  };
  const isTouch = window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
  document.body.classList.toggle('is-touch', isTouch);

  // Remembered between visits: picks, difficulty, mute. Storage can be missing or
  // blocked (private mode); the game just starts fresh then.
  const STORE_KEY = 'takedown.settings';
  const saved = (() => {
    try {
      return JSON.parse(localStorage.getItem(STORE_KEY)) || {};
    } catch (e) {
      return {};
    }
  })();
  const save = () => {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({ pick: setup.pick, difficulty: setup.difficulty, muted: Sound.muted }));
    } catch (e) {
      // not saved; nothing else depends on it
    }
  };

  const keyboard = new KeyboardController(KEYMAP_P1);
  const touch = new TouchController($('touch'));
  // Portrait title: the free space between the tagline and the buttons, where the
  // backdrop fighters should stand.
  const backdropGap = () => {
    if (screens.title.classList.contains('hidden')) return null;
    const top = document.querySelector('#scr-title .tag').getBoundingClientRect().bottom;
    const bottom = document.querySelector('#scr-title .menu').getBoundingClientRect().top;
    return bottom - top > 120 ? { top: top + 6, bottom: bottom - 4 } : null;
  };
  const game = new Game($('game'), { onEnd: showResult, backdropGap });

  const setup = {
    ids: [],
    pick: ['', ''],
    names: ['', ''],
    typed: [false, false],
    side: 0,
    difficulty: ['easy', 'normal', 'hard'].includes(saved.difficulty) ? saved.difficulty : 'normal',
    lastCfg: null,
  };

  let inMatch = false;

  function show(name) {
    for (const [k, el] of Object.entries(screens)) el.classList.toggle('hidden', k !== name);
    previews.running = name === 'setup';
    if (previews.running) previews.start();
  }

  function setMatchUi(on) {
    inMatch = on;
    document.body.classList.toggle('in-match', on);
    $('topbar').classList.toggle('hidden', !on);
    $('touch').classList.toggle('hidden', !on || !isTouch);
    const input = on ? game.inputs[0] : null;
    keyboard.input = input;
    touch.reset();
    touch.input = input;
    game.inputs[0].reset();
  }

  function go(name) {
    if (name === 'title') {
      Sound.hush();
      setMatchUi(false);
      game.showcase(CHARS[setup.pick[0]], CHARS[setup.pick[1]]);
    }
    if (name === 'setup') refreshSetup();
    show(name);
    game.resize(); // the backdrop is framed around the title layout
  }

  // Phones: go fullscreen on the first menu tap so browser bars don't eat the
  // screen; lock landscape once the fight starts.
  function fullscreen(lock) {
    if (!isTouch) return;
    const el = document.documentElement;
    const req = el.requestFullscreen || el.webkitRequestFullscreen;
    const lockIt = () => lock && screen.orientation && screen.orientation.lock && screen.orientation.lock('landscape');
    const p = document.fullscreenElement || document.webkitFullscreenElement || !req ? Promise.resolve() : Promise.resolve(req.call(el));
    p.then(lockIt).catch(() => {});
  }

  document.querySelectorAll('[data-go]').forEach((b) =>
    b.addEventListener('click', () => {
      fullscreen(false);
      Sound.init();
      Sound.ui();
      go(b.dataset.go);
    })
  );

  // ---------- Character select ----------
  const nameInputs = [$('in-p1'), $('in-p2')];
  const slots = [$('slot-0'), $('slot-1')];
  const cards = [];

  // A fighter other than `not`, at random.
  const randomId = (not) => pick(setup.ids.filter((id) => id !== not)) || setup.ids[0];

  function choose(id) {
    Sound.init();
    Sound.ui();
    const side = setup.side;
    setup.pick[side] = id;
    if (!setup.typed[side]) setup.names[side] = CHARS[id].name;
    if (side === 0) setup.side = 1; // then pick the opponent
    refreshSetup();
    save();
  }

  function buildRoster() {
    setup.ids = Object.keys(CHARS);
    // last visit's picks, else you get the first fighter and a random opponent
    const ok = (id) => id && CHARS[id];
    const p1 = ok(saved.pick && saved.pick[0]) ? saved.pick[0] : setup.ids[0];
    const p2 = ok(saved.pick && saved.pick[1]) ? saved.pick[1] : randomId(p1);
    setup.pick = [p1, p2];
    const root = $('roster');
    for (const id of setup.ids) {
      const c = CHARS[id];
      const b = document.createElement('button');
      b.className = 'card';
      b.type = 'button';
      b.setAttribute('aria-label', c.name);
      b.innerHTML = `<canvas width="56" height="64"></canvas><span></span>`;
      b.querySelector('span').textContent = c.name;
      b.addEventListener('click', () => choose(id));
      root.appendChild(b);
      cards.push({ el: b, canvas: b.querySelector('canvas'), id });
      // static thumbnail: first idle frame, scaled to fit
      const g = b.querySelector('canvas').getContext('2d');
      g.imageSmoothingEnabled = false;
      const f = c.frames[c.anims.idle[0]];
      const zoom = Math.min(52 / f.w, 60 / f.h, 2) / c.scale;
      drawPreview(g, c, c.anims.idle[0], 28, 62, zoom, 1);
    }
    // Random: any fighter except the one already on the other side.
    const r = document.createElement('button');
    r.className = 'card random';
    r.type = 'button';
    r.setAttribute('aria-label', 'Random fighter');
    r.innerHTML = `<canvas width="56" height="64"></canvas><span>RANDOM</span>`;
    r.addEventListener('click', () => choose(randomId(setup.pick[1 - setup.side])));
    root.appendChild(r);
    const drawQ = () => {
      const g = r.querySelector('canvas').getContext('2d');
      g.clearRect(0, 0, 56, 64);
      g.font = '48px Bangers, Impact, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.lineWidth = 6;
      g.strokeStyle = '#000';
      g.strokeText('?', 28, 34);
      g.fillStyle = '#f5c542';
      g.fillText('?', 28, 34);
    };
    drawQ();
    if (document.fonts) document.fonts.ready.then(drawQ);

    slots.forEach((el, side) =>
      el.addEventListener('click', (e) => {
        if (e.target.tagName === 'INPUT') return;
        setup.side = side;
        refreshSetup();
      })
    );
  }

  nameInputs.forEach((inp, side) => {
    inp.addEventListener('input', () => {
      inp.value = inp.value.toUpperCase();
      setup.names[side] = inp.value.trim();
      setup.typed[side] = true;
    });
  });

  $('diff').querySelectorAll('button').forEach((b) =>
    b.addEventListener('click', () => {
      Sound.ui();
      setup.difficulty = b.dataset.d;
      refreshSetup();
      save();
    })
  );

  function refreshSetup() {
    [0, 1].forEach((side) => {
      if (!setup.names[side]) setup.names[side] = CHARS[setup.pick[side]].name;
      if (document.activeElement !== nameInputs[side]) nameInputs[side].value = setup.names[side];
      slots[side].classList.toggle('on', setup.side === side);
    });
    $('pick-hint').textContent = setup.side === 0 ? 'Pick your fighter' : 'Pick your opponent';
    cards.forEach((c) => {
      c.el.classList.toggle('p1', c.id === setup.pick[0]);
      c.el.classList.toggle('p2', c.id === setup.pick[1]);
    });
    $('diff').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.d === setup.difficulty));
  }

  // Animated idle previews of both picks, only while setup is open.
  const previews = {
    running: false,
    active: false,
    start() {
      if (this.active) return;
      this.active = true;
      let last = 0;
      const frame = (ts) => {
        if (!this.running) {
          this.active = false;
          return;
        }
        if (ts - last > 100) {
          last = ts;
          slots.forEach((el, side) => {
            const c = CHARS[setup.pick[side]];
            const cv = el.querySelector('canvas');
            const g = cv.getContext('2d');
            g.imageSmoothingEnabled = false;
            g.clearRect(0, 0, cv.width, cv.height);
            const list = c.anims.idle;
            const fi = list[Math.floor(ts / 150) % list.length];
            const f = c.frames[c.anims.idle[0]];
            const zoom = Math.min(136 / f.h, 150 / f.w) / c.scale; // fill the slot: idle pose ~136px tall
            g.fillStyle = 'rgba(0,0,0,0.45)';
            g.beginPath();
            g.ellipse(80, 144, 40, 5, 0, 0, TAU);
            g.fill();
            drawPreview(g, c, fi, 80, 146, zoom, side ? -1 : 1);
          });
        }
        requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    },
  };

  // ---------- Match flow ----------
  function startMatch(cfg) {
    setup.lastCfg = cfg;
    show(null);
    setMatchUi(true);
    game.start(cfg);
  }

  $('btn-fight').addEventListener('click', () => {
    Sound.init();
    const name = (side) => (setup.names[side] || CHARS[setup.pick[side]].name).slice(0, 12);
    startMatch({
      mode: 'cpu',
      difficulty: setup.difficulty,
      p1: { name: name(0), ch: CHARS[setup.pick[0]] },
      p2: { name: name(1), ch: CHARS[setup.pick[1]] },
      stage: pick(stageIds()),
    });
    fullscreen(true);
  });

  function pause(on) {
    if (!inMatch || game.phase === 'over') return;
    game.paused = on;
    touch.reset();
    game.inputs[0].reset();
    if (on) Sound.hush();
    show(on ? 'pause' : null);
  }

  $('btn-pause').addEventListener('click', () => pause(true));
  $('btn-resume').addEventListener('click', () => pause(false));
  $('btn-restart').addEventListener('click', () => startMatch(setup.lastCfg));
  $('btn-quit').addEventListener('click', () => go('title'));
  $('btn-rematch').addEventListener('click', () => startMatch(setup.lastCfg));
  $('btn-menu').addEventListener('click', () => go('title'));
  $('btn-mute').addEventListener('click', (e) => {
    e.currentTarget.classList.toggle('off', Sound.toggle());
    save();
  });
  if (saved.muted && !Sound.muted) $('btn-mute').classList.toggle('off', Sound.toggle());

  window.addEventListener('keydown', (e) => {
    if (e.code === 'Escape' && inMatch) pause(!game.paused);
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && inMatch && !game.paused) pause(true);
  });

  function showResult({ winner, p1, p2, won }) {
    const youWin = winner === p1;
    $('res-kicker').textContent = youWin ? 'VICTORY' : 'DEFEAT';
    $('res-kicker').className = 'result-kicker ' + (youWin ? 'win' : 'lose');
    $('res-name').textContent = `${winner.name} wins`;
    const rows = [
      ['', p1.name, p2.name],
      ['Rounds won', won[0], won[1]],
      ['Hits landed', p1.stats.hits, p2.stats.hits],
      ['Damage dealt', p1.stats.dmg, p2.stats.dmg],
      ['Best combo', p1.stats.maxCombo, p2.stats.maxCombo],
      ['Supers used', p1.stats.supers, p2.stats.supers],
    ];
    const esc = (v) => String(v).replace(/[&<>"]/g, (ch) => `&#${ch.charCodeAt(0)};`);
    $('res-stats').innerHTML = rows
      .map((r, i) => `<tr>${r.map((c) => (i === 0 ? `<th>${esc(c)}</th>` : `<td>${esc(c)}</td>`)).join('')}</tr>`)
      .join('');
    game.inputs[0].reset();
    $('topbar').classList.add('hidden');
    $('touch').classList.add('hidden');
    document.body.classList.remove('in-match');
    show('result');
  }

  // Boot: load sprite atlases, then show the menu. Until then the Play button is a
  // progress bar, so an early tap can't open an empty fighter select.
  const playBtn = $('btn-play');
  const progress = (done, total) => playBtn.style.setProperty('--p', (done / total).toFixed(3));
  Promise.all([loadCharacters(progress), loadStages()]).then(() => {
    playBtn.disabled = false;
    playBtn.classList.remove('loading');
    playBtn.textContent = 'Play vs Computer';
    if (!Object.keys(CHARS).length) {
      document.querySelector('#scr-title .tag').textContent = 'No fighters found: run tools/slice_sprites.py build';
      return;
    }
    buildRoster();
    refreshSetup();
    go('title');
  });
})();
