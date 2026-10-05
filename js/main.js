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
    ladder: $('scr-ladder'),
  };
  const isTouch = window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
  document.body.classList.toggle('is-touch', isTouch);

  // Remembered between visits: picks, difficulty, mute, arcade clears. Storage can be missing or
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
      localStorage.setItem(STORE_KEY, JSON.stringify({ pick: setup.pick, difficulty: setup.difficulty, muted: Sound.muted, cleared, best }));
    } catch (e) {
      // not saved; nothing else depends on it
    }
  };

  // fighter id -> hardest difficulty that fighter has cleared arcade on
  const LEVELS = ['easy', 'normal', 'hard'];
  const cleared = saved.cleared && typeof saved.cleared === 'object' ? saved.cleared : {};
  // fighter id -> best arcade score
  const best = saved.best && typeof saved.best === 'object' ? saved.best : {};

  const keyboard = new KeyboardController(KEYMAP_P1);
  const touch = new TouchController($('touch'));
  const pad = new GamepadController({
    power: () => (game.p1 ? game.p1.power : 0),
    pause: () => pause(!game.paused),
    menu: () => !inMatch || game.paused || game.phase === 'over',
  });
  // the gamepad focus ring is only for the pad; a mouse or touch hides it again
  window.addEventListener('pointerdown', () => document.body.classList.remove('pad-nav'));
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
    difficulty: LEVELS.includes(saved.difficulty) ? saved.difficulty : 'normal',
    mode: 'versus', // or 'arcade'
    lastCfg: null,
  };

  // Arcade run: a ladder of opponents fought in order. Losing offers a continue.
  const ARCADE_FIGHTS = 8;
  const arcade = { on: false, ladder: [], i: 0, continues: 0, score: 0 };

  // Arcade scoring for a won fight, SF2-style: damage dealt, best combo, and for every
  // round you took, health and seconds left over (a full-health round is a PERFECT).
  // Harder levels multiply it. A continue costs CONTINUE_COST of the running score.
  const SCORE_MULT = { easy: 1, normal: 1.5, hard: 2 };
  const CONTINUE_COST = 0.2;
  const fmt = (n) => Math.round(n).toLocaleString('en-US');

  function fightScore(me, rounds, level) {
    const mine = rounds.filter((r) => r.side === me.side);
    const parts = {
      damage: me.stats.dmg * 10,
      combo: me.stats.maxCombo > 1 ? me.stats.maxCombo * 200 : 0,
      health: mine.reduce((a, r) => a + Math.round(r.hp) * 50, 0),
      time: mine.reduce((a, r) => a + r.sec * 50, 0),
      perfect: mine.filter((r) => r.hp >= 100 && r.sec > 0).length * 5000,
    };
    const mult = SCORE_MULT[level] || 1;
    const total = Math.round(Object.values(parts).reduce((a, b) => a + b, 0) * mult);
    return { parts, mult, total };
  }

  let inMatch = false;

  function show(name) {
    for (const [k, el] of Object.entries(screens)) el.classList.toggle('hidden', k !== name);
    previews.running = name === 'setup';
    if (previews.running) previews.start();
  }

  function setMatchUi(on) {
    inMatch = on;
    // a menu button left focused would be pressed again by Space / Enter mid-fight
    if (on && document.activeElement && document.activeElement.blur) document.activeElement.blur();
    document.body.classList.toggle('in-match', on);
    $('topbar').classList.toggle('hidden', !on);
    $('touch').classList.toggle('hidden', !on || !isTouch);
    const input = on ? game.inputs[0] : null;
    keyboard.input = input;
    touch.reset();
    touch.input = input;
    pad.reset();
    pad.input = input;
    game.inputs[0].reset();
  }

  let updateReady = false; // a new build is cached and waiting for a quiet moment

  function go(name) {
    if (name === 'title' && updateReady) return location.reload();
    if (name === 'title') {
      arcade.on = false;
      Sound.hush();
      setMatchUi(false);
      game.showcase(CHARS[setup.pick[0]], CHARS[setup.pick[1]]);
    }
    if (name === 'setup') {
      screens.setup.classList.toggle('arcade', setup.mode === 'arcade');
      if (setup.mode === 'arcade') setup.side = 0;
      refreshSetup();
    }
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
      if (b.dataset.mode) setup.mode = b.dataset.mode;
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
    if (side === 0 && setup.mode !== 'arcade') setup.side = 1; // then pick the opponent
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
    r.addEventListener('click', () => choose(randomId(setup.mode === 'arcade' ? null : setup.pick[1 - setup.side])));
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
        if (e.target.tagName === 'INPUT' || setup.mode === 'arcade') return;
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
    const arc = setup.mode === 'arcade';
    $('pick-hint').textContent = setup.side === 0 ? 'Pick your fighter' : 'Pick your opponent';
    $('btn-fight').textContent = arc ? 'Start!' : 'Fight!';
    cards.forEach((c) => {
      c.el.classList.toggle('p1', c.id === setup.pick[0]);
      c.el.classList.toggle('p2', !arc && c.id === setup.pick[1]);
      const lv = cleared[c.id];
      let star = c.el.querySelector('.star');
      if (lv && !star) {
        star = document.createElement('i');
        c.el.appendChild(star);
      }
      if (star) {
        star.className = 'star ' + lv;
        star.textContent = '\u2605';
        star.title = `Arcade cleared on ${lv}`;
      }
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
    if (setup.mode === 'arcade') {
      startArcade();
      fullscreen(true);
      return;
    }
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

  // ---------- Arcade ----------
  const myName = () => (setup.names[0] || CHARS[setup.pick[0]].name).slice(0, 12);

  function startArcade() {
    const others = setup.ids.filter((id) => id !== setup.pick[0]);
    for (let i = others.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [others[i], others[j]] = [others[j], others[i]];
    }
    Object.assign(arcade, { on: true, ladder: others.slice(0, ARCADE_FIGHTS), i: 0, continues: 0, score: 0, level: setup.difficulty });
    showLadder();
  }

  // The first two fights are one level gentler than the one picked.
  const arcadeLevel = () => LEVELS[Math.max(0, LEVELS.indexOf(arcade.level) - (arcade.i < 2 ? 1 : 0))];

  function showLadder() {
    setMatchUi(false);
    Sound.hush();
    // backdrop: you and the next opponent squaring up
    game.showcase(CHARS[setup.pick[0]], CHARS[arcade.ladder[arcade.i]]);
    const n = arcade.ladder.length;
    const last = arcade.i === n - 1;
    $('lad-kicker').textContent = last ? 'FINAL FIGHT' : `FIGHT ${arcade.i + 1} OF ${n}`;
    $('lad-kicker').className = 'result-kicker ' + (last ? 'lose' : 'win');
    $('lad-next').textContent = CHARS[arcade.ladder[arcade.i]].name;
    const top = best[setup.pick[0]];
    $('lad-score').textContent = `Score ${fmt(arcade.score)}` + (top ? `  ·  Best ${fmt(top)}` : '');
    const row = $('lad-row');
    row.innerHTML = '';
    arcade.ladder.forEach((id, k) => {
      const c = CHARS[id];
      const d = document.createElement('div');
      d.className = 'rung' + (k < arcade.i ? ' beaten' : k === arcade.i ? ' next' : '');
      const cv = document.createElement('canvas');
      cv.width = 88;
      cv.height = 104;
      d.appendChild(cv);
      row.appendChild(d);
      const g = cv.getContext('2d');
      g.imageSmoothingEnabled = false;
      const f = c.frames[c.anims.idle[0]];
      drawPreview(g, c, c.anims.idle[0], 44, 100, Math.min(80 / f.w, 92 / f.h) / c.scale, -1);
    });
    show('ladder');
  }

  function arcadeFight() {
    const id = arcade.ladder[arcade.i];
    startMatch({
      mode: 'cpu',
      difficulty: arcadeLevel(),
      p1: { name: myName(), ch: CHARS[setup.pick[0]] },
      p2: { name: CHARS[id].name, ch: CHARS[id] },
      stage: pick(stageIds()),
    });
  }

  $('btn-lad-fight').addEventListener('click', () => {
    Sound.init();
    Sound.ui();
    arcadeFight();
    fullscreen(true);
  });
  $('btn-lad-quit').addEventListener('click', () => go('title'));

  function pause(on) {
    if (!inMatch || game.phase === 'over') return;
    game.paused = on;
    touch.reset();
    game.inputs[0].reset();
    if (on) Sound.hush();
    show(on ? 'pause' : null);
  }

  $('btn-pause').addEventListener('click', (e) => {
    e.currentTarget.blur();
    pause(true);
  });
  $('btn-resume').addEventListener('click', () => pause(false));
  $('btn-restart').addEventListener('click', () => startMatch(setup.lastCfg));
  $('btn-quit').addEventListener('click', () => go('title'));
  // Result buttons: rematch / menu in versus. In arcade: next fight or continue,
  // and after the last win, a fresh run.
  $('btn-rematch').addEventListener('click', () => {
    if (!arcade.on) return startMatch(setup.lastCfg);
    if (arcade.result === 'won') {
      arcade.i++;
      showLadder();
    } else if (arcade.result === 'lost') {
      arcade.continues++;
      arcade.score = Math.round(arcade.score * (1 - CONTINUE_COST));
      arcadeFight();
    } else {
      startArcade();
    }
  });
  $('btn-menu').addEventListener('click', () => go('title'));
  $('btn-mute').addEventListener('click', (e) => {
    e.currentTarget.blur(); // keep Space (jump) from toggling it again
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
  // iOS Safari zoom guards for the fight (the controls cancel their own touches):
  // a second tap within 350 ms anywhere, Safari's pinch gesture, and dblclick.
  let lastTouchEnd = 0;
  document.addEventListener(
    'touchend',
    (e) => {
      const now = Date.now();
      const quick = now - lastTouchEnd < 350;
      lastTouchEnd = now;
      if (!inMatch || !quick || !e.cancelable || e.defaultPrevented) return;
      e.preventDefault(); // no double-tap zoom...
      const btn = e.target.closest && e.target.closest('button');
      if (btn && !btn.disabled) btn.click(); // ...but the tap still presses the button
    },
    { passive: false }
  );
  for (const ev of ['gesturestart', 'gesturechange', 'dblclick']) {
    document.addEventListener(ev, (e) => inMatch && e.cancelable && e.preventDefault(), { passive: false });
  }
  // If the page still ends up zoomed in mid-fight, snap it back (rewriting the
  // viewport tag makes Safari re-apply scale 1) and pause so nobody loses meanwhile.
  const viewportMeta = document.querySelector('meta[name="viewport"]');
  const viewportContent = viewportMeta.content;
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', () => {
      if (!inMatch || window.visualViewport.scale <= 1.01) return;
      if (!game.paused) pause(true);
      viewportMeta.content = viewportContent + ', minimum-scale=1';
      setTimeout(() => (viewportMeta.content = viewportContent), 300);
    });
  }

  // Phones turned upright mid-fight get the rotate cover; don't keep fighting under it.
  window.addEventListener('resize', () => {
    if (isTouch && inMatch && !game.paused && window.innerHeight > window.innerWidth) pause(true);
  });

  function showResult({ winner, p1, p2, won, rounds }) {
    const youWin = winner === p1;
    $('res-kicker').textContent = youWin ? 'VICTORY' : 'DEFEAT';
    $('res-kicker').className = 'result-kicker ' + (youWin ? 'win' : 'lose');
    $('res-name').textContent = `${winner.name} wins`;
    $('btn-rematch').textContent = 'Rematch';
    $('btn-menu').textContent = 'Main menu';
    let rows = [
      ['', p1.name, p2.name],
      ['Rounds won', won[0], won[1]],
      ['Hits landed', p1.stats.hits, p2.stats.hits],
      ['Damage dealt', p1.stats.dmg, p2.stats.dmg],
      ['Best combo', p1.stats.maxCombo, p2.stats.maxCombo],
      ['Supers used', p1.stats.supers, p2.stats.supers],
    ];
    if (arcade.on) {
      const champ = youWin && arcade.i === arcade.ladder.length - 1;
      arcade.result = champ ? 'champion' : youWin ? 'won' : 'lost';
      $('btn-rematch').textContent = champ ? 'Play again' : youWin ? 'Next fight' : 'Continue';
      $('btn-menu').textContent = 'Quit arcade';
      if (youWin) {
        const s = fightScore(p1, rounds || [], arcade.level);
        arcade.score += s.total;
        rows = [
          ['', 'Score'],
          ['Damage', fmt(s.parts.damage)],
          ['Combo bonus', fmt(s.parts.combo)],
          ['Health bonus', fmt(s.parts.health)],
          ['Time bonus', fmt(s.parts.time)],
        ];
        if (s.parts.perfect) rows.push(['Perfect bonus', fmt(s.parts.perfect)]);
        if (s.mult !== 1) rows.push([`${arcade.level[0].toUpperCase() + arcade.level.slice(1)} \u00d7${s.mult}`, `+${fmt(s.total - s.total / s.mult)}`]);
        rows.push(['This fight', fmt(s.total)], ['Total score', fmt(arcade.score)]);
      } else {
        rows.push(['Arcade score', fmt(arcade.score), `\u221220% to continue`]);
      }
      if (champ) {
        $('res-kicker').textContent = 'CHAMPION';
        const id = setup.pick[0];
        const record = arcade.score > (best[id] || 0);
        $('res-name').textContent = record ? `New best: ${fmt(arcade.score)}` : `${p1.name} beat them all`;
        if (record) best[id] = arcade.score;
        if (LEVELS.indexOf(arcade.level) > LEVELS.indexOf(cleared[id] || '')) cleared[id] = arcade.level;
        save();
        rows = [
          ['', 'Arcade'],
          ['Final score', fmt(arcade.score)],
          ['Best with ' + p1.name, fmt(best[id])],
          ['Fighters beaten', arcade.ladder.length],
          ['Continues used', arcade.continues],
          ['Difficulty', arcade.level],
        ];
      }
    }
    const esc = (v) => String(v).replace(/[&<>"]/g, (ch) => `&#${ch.charCodeAt(0)};`);
    const totals = new Set(['This fight', 'Total score', 'Final score']);
    $('res-stats').className = rows[0].length === 2 ? 'stats two' : 'stats';
    $('res-stats').innerHTML = rows
      .map((r, i) => `<tr${totals.has(r[0]) ? ' class="total"' : ''}>${r.map((c) => (i === 0 ? `<th>${esc(c)}</th>` : `<td>${esc(c)}</td>`)).join('')}</tr>`)
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
    $('btn-arcade').disabled = false;
    if (!Object.keys(CHARS).length) {
      document.querySelector('#scr-title .tag').textContent = 'No fighters found: run tools/slice_sprites.py build';
      return;
    }
    buildRoster();
    refreshSetup();
    go('title');
    Sound.preload(); // announcer clips, after the fighters so they never compete
    // Offline play and instant repeat visits: sw.js caches the whole game.
    if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
      // A new build took over (fixes shouldn't wait a visit): reload straight away on
      // a quiet menu, otherwise the next time the player is back on the title.
      const hadWorker = !!navigator.serviceWorker.controller;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (!hadWorker) return; // first install, nothing new to show
        if (!inMatch && ['title', 'howto', 'credits'].some((k) => !screens[k].classList.contains('hidden'))) location.reload();
        else updateReady = true;
      });
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }
  });
})();
