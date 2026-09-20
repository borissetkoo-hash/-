/* =============================================================================
   tools/test-game.js — АВТОТЕСТ ИГРЫ В НАСТОЯЩЕМ БРАУЗЕРЕ
   -----------------------------------------------------------------------------
   Зачем нужен автотест игре, в которую и так можно просто поиграть?

   Потому что глазами не видно половины проблем. Этот тест уже нашёл три
   настоящих бага, которые я сам бы пропустил:
     1. птица падала с рогатки, потому что свойства gravityScale в Matter.js
        просто не существует, и строка молча ничего не делала;
     2. ледяные колонны разъезжались под весом камня и форт рушился сам;
     3. скаты крыши съезжали с 60 градусов до 15 за три секунды.

   КАК ЗАПУСТИТЬ
     1. поставить браузер для тестов:  npm install
     2. запустить сервер:              npm run serve
     3. в другом терминале:            npm test

   Почему нужен сервер, а не просто открыть файл: браузер запрещает странице,
   открытой через file://, загружать соседние файлы (защита от чтения твоего
   диска чужой страницей). Локальный сервер решает это.
   ============================================================================= */

const { chromium } = require('playwright');

// Адрес можно переопределить: BASE_URL=http://localhost:3000 npm test
const BASE = process.env.BASE_URL || 'http://127.0.0.1:8123';
const fail = [];
function check(name, ok, extra) {
  console.log((ok ? '  OK   ' : '  ПРОВАЛ ') + name + (extra !== undefined ? '  -> ' + extra : ''));
  if (!ok) fail.push(name);
}

(async () => {
    // CHROME_PATH нужен, только если браузер лежит в нестандартном месте
  const launchOptions = process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {};
  const browser = await chromium.launch(launchOptions);
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

  const errors = [];
  page.on('console', m => { const t = m.text(); if (m.type() === 'error' && !/404/.test(t)) errors.push(t); });
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));

  await page.goto(BASE + '/index.html', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => typeof Game !== 'undefined' && Game.level !== null, null, { timeout: 15000 });

  console.log('\n--- 1. ЗАГРУЗКА ---');
  const init = await page.evaluate(() => ({
    level: Game.level.name,
    blocks: Game.blocks.length,
    pigs: Game.pigs.length,
    queue: Game.queue.length,
    state: Game.state,
    slingLoaded: Slingshot.isLoaded(),
    bodies: Physics.allBodies().length
  }));
  console.log('  ' + JSON.stringify(init));
  check('уровень загрузился', init.blocks > 0 && init.pigs > 0);
  check('птица заряжена на рогатке', init.slingLoaded === true);
  check('нет ошибок в консоли', errors.length === 0, errors.join(' | '));

  console.log('\n--- 2. УСТОЙЧИВОСТЬ КОНСТРУКЦИИ (не разваливается сама) ---');
  const before = await page.evaluate(() => ({ p: Game.pigs.length, b: Game.blocks.length }));
  await page.waitForTimeout(3000);
  const after = await page.evaluate(() => ({
    p: Game.pigs.length, b: Game.blocks.length,
    speed: Physics.maxSpeed(), score: Game.score
  }));
  console.log('  до: ' + JSON.stringify(before) + '   после 3 сек: ' + JSON.stringify(after));
  check('свиньи не умерли сами', after.p === before.p, after.p + ' из ' + before.p);
  check('блоки не развалились сами', after.b === before.b, after.b + ' из ' + before.b);
  check('мир успокоился', after.speed < 1.0, 'макс. скорость = ' + after.speed.toFixed(3));

  console.log('\n--- 3. ПРИЦЕЛИВАНИЕ И ТРАЕКТОРИЯ ---');
  // Подбираем прицел перебором: ищем натяжение, при котором предсказанная
  // траектория падает примерно в середину крепости. Так тест не сломается,
  // если потом поменять силу рогатки или расстояние до построек.
  const pts = await page.evaluate(() => {
    const TARGET = 1020;
    const sx = CONFIG.slingshot.x, sy = CONFIG.slingshot.y;
    const power = CONFIG.slingshot.power * CONFIG.birds.red.power;
    let best = null;
    for (let dx = -150; dx <= -40; dx += 4) {
      for (let dy = 8; dy <= 150; dy += 4) {
        if (Math.hypot(dx, dy) > CONFIG.slingshot.maxPull) continue;
        const px = sx + dx, py = sy + dy;
        const v = { x: (sx - px) * power, y: (sy - py) * power };
        const path = Physics.predictTrajectory(px, py, v.x, v.y, 300, 0.006);
        const last = path[path.length - 1];
        if (!last) continue;
        const err = Math.abs(last.x - TARGET);
        if (!best || err < best.err) best = { dx, dy, err, landX: Math.round(last.x) };
      }
    }
    const r = Game.canvas.getBoundingClientRect();
    const toScreen = (wx, wy) => ({
      x: (wx - Game.camera.x) * Game.camera.zoom + r.left,
      y: (wy - Game.camera.y) * Game.camera.zoom + r.top
    });
    return {
      anchor: toScreen(sx, sy),
      pull:   toScreen(sx + best.dx, sy + best.dy),
      best
    };
  });
  console.log('  подобранный прицел: ' + JSON.stringify(pts.best));

  await page.mouse.move(pts.anchor.x, pts.anchor.y);
  await page.mouse.down();
  await page.mouse.move(pts.pull.x, pts.pull.y, { steps: 12 });
  await page.waitForTimeout(120);

  const aim = await page.evaluate(() => ({
    aiming: Slingshot.aiming,
    traj: Slingshot.trajectory.length,
    ratio: Slingshot.pullRatio(),
    v: Slingshot.launchVelocity(),
    lastPoint: Slingshot.trajectory[Slingshot.trajectory.length - 1]
  }));
  console.log('  ' + JSON.stringify(aim));
  check('режим прицеливания включился', aim.aiming === true);
  check('траектория посчитана', aim.traj > 10, aim.traj + ' точек');
  check('скорость направлена вправо-вверх', aim.v.x > 0 && aim.v.y < 0);
  check('траектория попадает в крепость', aim.lastPoint && aim.lastPoint.x > 850 && aim.lastPoint.x < 1300,
        'конец пунктира x=' + (aim.lastPoint ? Math.round(aim.lastPoint.x) : '?'));

  console.log('\n--- 4. ВЫСТРЕЛ ---');
  await page.mouse.up();
  await page.waitForTimeout(80);
  const launched = await page.evaluate(() => ({
    state: Game.state,
    hasActive: !!Game.activeBird,
    v: Game.activeBird ? Game.activeBird.body.velocity : null,
    x: Game.activeBird ? Game.activeBird.x : null
  }));
  console.log('  ' + JSON.stringify(launched));
  check('состояние стало flying', launched.state === 'flying');
  check('птица получила скорость', launched.v && launched.v.x > 5);

  await page.waitForTimeout(1200);
  const mid = await page.evaluate(() => ({
    x: Game.activeBird ? Math.round(Game.activeBird.x) : null,
    camX: Math.round(Game.camera.x)
  }));
  console.log('  через 1.2 сек полёта: ' + JSON.stringify(mid));
  check('птица улетела далеко вправо', mid.x === null || mid.x > 700, 'x = ' + mid.x);
  check('камера поехала за птицей', mid.camX > 50, 'camera.x = ' + mid.camX);

  console.log('\n--- 5. ПОПАДАНИЕ И УРОН ---');
  await page.waitForTimeout(6000);
  const hit = await page.evaluate(() => ({
    pigs: Game.pigs.length, blocks: Game.blocks.length,
    score: Game.score, state: Game.state, queue: Game.queue.length
  }));
  console.log('  ' + JSON.stringify(hit));
  check('урон нанесён (очки выросли)', hit.score > 0, 'очки = ' + hit.score);
  check('ход завершился, дали новую птицу', hit.state === 'ready' || hit.state === 'won',
        'state = ' + hit.state);

  console.log('\n--- 6. ВЗРЫВ И СПОСОБНОСТИ (прямой вызов) ---');
  const boom = await page.evaluate(() => {
    const before = Game.blocks.length + Game.pigs.length;
    Game.pendingExplosions.push({ x: 1380, y: 700, radius: 260, force: 1.2, damage: 500 });
    Game.processPending();
    return { before, after: Game.blocks.length + Game.pigs.length, particles: Effects.particles.length };
  });
  console.log('  ' + JSON.stringify(boom));
  check('взрыв что-то разрушил', boom.after < boom.before, boom.before + ' -> ' + boom.after);
  check('частицы взрыва созданы', boom.particles > 10, boom.particles);

  console.log('\n--- 7. ПРОВЕРКА ВСЕХ УРОВНЕЙ ---');
  for (let i = 0; i < 3; i++) {
    const lv = await page.evaluate((idx) => {
      Game.loadLevel(idx);
      return { name: Game.level.name, blocks: Game.blocks.length, pigs: Game.pigs.length };
    }, i);
    await page.waitForTimeout(2500);
    const st = await page.evaluate(() => ({
      pigs: Game.pigs.length, blocks: Game.blocks.length, speed: Physics.maxSpeed()
    }));
    console.log('  уровень ' + (i + 1) + ' "' + lv.name + '": блоков ' + lv.blocks +
                ', свиней ' + lv.pigs + ' -> через 2.5с: блоков ' + st.blocks +
                ', свиней ' + st.pigs + ', скорость ' + st.speed.toFixed(2));
    check('уровень ' + (i + 1) + ' стоит устойчиво', st.pigs === lv.pigs && st.blocks >= lv.blocks - 1);
  }

  console.log('\n--- 7б. КРЫША ДОМИКОМ НА УРОВНЕ 3 УСТОЯЛА? ---');
  await page.evaluate(() => Game.loadLevel(2));
  await page.waitForTimeout(3000);
  const roof = await page.evaluate(() => {
    // Сравниваем фактический угол каждой доски с тем, который задан в уровне.
    // Ничего не уехало, если разница маленькая.
    const rows = Game.blocks.map((blk, i) => {
      const want = (Game.level.blocks[i].angle || 0) * 180 / Math.PI;
      const got = blk.body.angle * 180 / Math.PI;
      return { want: Math.round(want), got: Math.round(got), diff: Math.abs(want - got) };
    }).filter(o => Math.abs(o.want) > 3);
    return { rows, worst: rows.length ? Math.max(...rows.map(r => r.diff)) : 0 };
  });
  console.log('  скаты (задано -> стало): ' +
    roof.rows.map(r => r.want + ' -> ' + r.got).join(', '));
  check('оба ската крыши на месте', roof.rows.length === 2, 'найдено: ' + roof.rows.length);
  check('скаты не съехали', roof.worst < 10, 'макс. отклонение ' + roof.worst.toFixed(1) + ' градусов');

  console.log('\n--- 8. СКРИНШОТЫ ---');
  await page.evaluate(() => Game.loadLevel(0));
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'shot-level1.png' });
  await page.evaluate(() => Game.loadLevel(2));
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'shot-level3.png' });
  console.log('  скриншоты сохранены');

  console.log('\n--- ОШИБКИ В КОНСОЛИ ЗА ВЕСЬ ТЕСТ ---');
  console.log(errors.length ? errors.join('\n') : '  нет');
  check('консоль чистая', errors.length === 0);

  await browser.close();

  console.log('\n=============================');
  console.log(fail.length === 0 ? 'ВСЕ ПРОВЕРКИ ПРОЙДЕНЫ' : 'ПРОВАЛЕНО: ' + fail.length + '\n - ' + fail.join('\n - '));
  process.exit(fail.length ? 1 : 0);
})().catch(e => { console.error('ТЕСТ УПАЛ:', e); process.exit(2); });
