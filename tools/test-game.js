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

  console.log('\n--- 1б. СПРАЙТЫ ЗАГРУЗИЛИСЬ? ---');
  const sprites = await page.evaluate(() => {
    const bird = Assets.set('bird_red');
    const pig = Assets.set('pig_green');
    return {
      birdFrames: bird ? bird.frames.filter(Boolean).length : 0,
      birdRoles: bird ? Object.keys(bird.roles) : [],
      birdFraction: bird ? bird.bodyFraction : null,
      pigFrames: pig ? pig.frames.filter(Boolean).length : 0,
      pigStages: pig && pig.roles.stages ? pig.roles.stages.length : 0
    };
  });
  console.log('  ' + JSON.stringify(sprites));
  check('кадры птицы загружены', sprites.birdFrames === 11, sprites.birdFrames + ' из 11');
  check('кадры свиньи загружены', sprites.pigFrames === 9, sprites.pigFrames + ' из 9');
  check('у свиньи три стадии повреждений', sprites.pigStages === 3, sprites.pigStages);
  check('у птицы описаны все роли', sprites.birdRoles.length === 5, sprites.birdRoles.join(','));

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
    const TARGET = 1300;
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
  const faceAim = await page.evaluate(() => ({
    state: Slingshot.bird ? Slingshot.bird.animState() : null,
    angle: Slingshot.bird ? Math.round(Slingshot.bird.visualAngle * 180 / Math.PI) : null
  }));
  console.log('  лицо при натяжении: ' + JSON.stringify(faceAim));
  check('при натяжении лицо злое (aim)', faceAim.state === 'aim', faceAim.state);
  check('на рогатке птица развёрнута назад', faceAim.angle !== null && Math.abs(faceAim.angle) > 90,
        'угол ' + faceAim.angle + ' градусов');
  check('режим прицеливания включился', aim.aiming === true);
  check('траектория посчитана', aim.traj > 10, aim.traj + ' точек');
  check('скорость направлена вправо-вверх', aim.v.x > 0 && aim.v.y < 0);
  check('траектория попадает в крепость', aim.lastPoint && aim.lastPoint.x > 1100 && aim.lastPoint.x < 1600,
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
  const faceFly = await page.evaluate(() => ({
    state: Game.activeBird ? Game.activeBird.animState() : null,
    angle: Game.activeBird ? Math.round(Game.activeBird.visualAngle * 180 / Math.PI) : null
  }));
  console.log('  лицо в полёте: ' + JSON.stringify(faceFly));
  check('в полёте лицо агрессивное (fly)', faceFly.state === 'fly', faceFly.state);
  check('в полёте птица смотрит вперёд', faceFly.angle !== null && Math.abs(faceFly.angle) < 90,
        'угол ' + faceFly.angle + ' градусов');
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

  console.log('\n--- 7в. НЕТ ЛИ ТЕЛ-ПРИЗРАКОВ ПОСЛЕ СМЕНЫ УРОВНЕЙ ---');
  // Регрессия на баг: птица на рогатке делалась статичной, а очистка уровня
  // удаляла только подвижные тела. У рогатки копились невидимые препятствия.
  const ghosts = await page.evaluate(() => {
    const rows = [];
    for (let i = 0; i < 5; i++) {
      Game.loadLevel(i % 3);
      const expected = Game.blocks.length + Game.pigs.length + Game.birds.length + 3;
      rows.push({ n: i, level: Game.level.name, bodies: Physics.allBodies().length, expected });
    }
    return rows;
  });
  for (const r of ghosts) {
    console.log('  загрузка ' + r.n + ' (' + r.level + '): тел ' + r.bodies + ', ожидалось ' + r.expected);
  }
  check('лишних тел в мире не остаётся',
        ghosts.every(r => r.bodies === r.expected),
        ghosts.map(r => r.bodies + '/' + r.expected).join(' '));

  console.log('\n--- 7г. НА КАЖДОМ УРОВНЕ ПТИЦА УЛЕТАЕТ СВОБОДНО ---');
  for (let lvl = 0; lvl < 3; lvl++) {
    const flight = await page.evaluate(async (index) => {
      Game.loadLevel(index);
      const bird = Slingshot.bird;
      Matter.Body.setStatic(bird.body, false);
      Matter.Body.setVelocity(bird.body, { x: 22, y: -6 });
      bird.launched = true;
      Slingshot.bird = null;
      Game.activeBird = bird;
      Game.state = 'flying';
      let maxX = bird.x;
      for (let i = 0; i < 90; i++) {
        Physics.step(16.7);
        if (bird.x > maxX) maxX = bird.x;
      }
      return { level: Game.level.name, start: Math.round(CONFIG.slingshot.x), maxX: Math.round(maxX) };
    }, lvl);
    console.log('  ' + flight.level + ': с ' + flight.start + ' улетела до ' + flight.maxX);
    check('на уровне ' + (lvl + 1) + ' рогатка не мешает выстрелу', flight.maxX > 700,
          'долетела до x=' + flight.maxX);
  }

  console.log('\n--- 7д. СВИНЬЯ ГИБНЕТ ПОД ЗАВАЛОМ ---');
  const crush = await page.evaluate(() => {
    Physics.clearWorld();
    Game.blocks = []; Game.pigs = []; Game.birds = [];

    const pig = new Pig(900, CONFIG.ground.y - 20, 20);
    Game.pigs.push(pig); Physics.add(pig.body);
    const slab = new Block(900, CONFIG.ground.y - 120, 200, 26, 'stone');
    Game.blocks.push(slab); Physics.add(slab.body);

    const steps = [];
    let died = null;
    for (let i = 0; i < 240; i++) {
      Physics.step(16.7);
      Game.processPending();
      Game._applyCrushDamage(16.7);
      if (i % 40 === 0) steps.push({ ms: Math.round(i * 16.7), hp: Math.round(pig.hp), load: +Physics.loadOn(pig.body).toFixed(1) });
      if (!pig.alive && died === null) died = Math.round(i * 16.7);
    }
    return { steps, died, pigsLeft: Game.pigs.length };
  });
  for (const st of crush.steps) console.log('  ' + st.ms + ' мс: здоровье ' + st.hp + ', давление ' + st.load);
  check('свинья под каменной плитой погибает', crush.died !== null,
        crush.died !== null ? 'через ' + crush.died + ' мс' : 'выжила');
  check('погибшая свинья убрана с поля', crush.pigsLeft === 0, 'осталось ' + crush.pigsLeft);

  console.log('\n--- 7е. ВРЕМЯ ПОЛЁТА И ДОСЯГАЕМОСТЬ ---');
  /* Две вещи проверяются вместе, потому что они тянут в разные стороны.

     Время полёта: если птица долетает за полсекунды, нажать способность
     невозможно. Меряем не один выстрел, а весь веер углов прицеливания, и
     смотрим на середину разброса: пологий выстрел всегда быстрый, и это
     нормально, это выбор игрока.

     Досягаемость: если усилить рогатку ради времени, дальние свиньи станут
     недостижимы и уровень нельзя будет пройти. Поэтому рядом проверяется,
     что максимальная дальность с запасом перекрывает дальний край уровня. */
  const timing = await page.evaluate(() => {
    const out = [];
    for (let lvl = 0; lvl < 3; lvl++) {
      Game.loadLevel(lvl);

      let fortX = Infinity, farX = 0;
      for (const bl of Game.level.blocks) {
        fortX = Math.min(fortX, bl.x - bl.w / 2);
        farX = Math.max(farX, bl.x + Math.max(bl.w, bl.h) / 2);
      }
      for (const pg of Game.level.pigs) farX = Math.max(farX, pg.x + pg.radius);

      const sx = CONFIG.slingshot.x, sy = CONFIG.slingshot.y;
      const pw = CONFIG.slingshot.power;
      const times = [];
      let maxReach = 0;

      for (let deg = 15; deg <= 65; deg += 5) {
        const a = deg * Math.PI / 180;
        const px = sx - Math.cos(a) * CONFIG.slingshot.maxPull;
        const py = sy + Math.sin(a) * CONFIG.slingshot.maxPull;
        const v = { x: (sx - px) * pw, y: (sy - py) * pw };
        const path = Physics.predictTrajectory(px, py, v.x, v.y, 600, CONFIG.world.airFriction);

        let steps = null;
        for (let i = 0; i < path.length; i++) {
          if (steps === null && path[i].x >= fortX) steps = i;
        }
        if (steps !== null) times.push(Math.round(steps * 16.67));
        if (path.length) maxReach = Math.max(maxReach, path[path.length - 1].x);
      }

      times.sort((a, b) => a - b);
      out.push({
        level: Game.level.name,
        fortX: Math.round(fortX),
        farX: Math.round(farX),
        fastest: times[0],
        median: times[Math.floor(times.length / 2)],
        slowest: times[times.length - 1],
        maxReach: Math.round(maxReach)
      });
    }
    return out;
  });

  for (const t of timing) {
    console.log('  ' + t.level + ': крепость с ' + t.fortX + ', дальний край ' + t.farX);
    console.log('      полёт до крепости: быстрее всего ' + t.fastest +
                ' мс, обычно ' + t.median + ' мс, навесом ' + t.slowest + ' мс');
    console.log('      дальность рогатки ' + t.maxReach + ', запас ' + (t.maxReach - t.farX));
  }
  check('обычного полёта хватает на способность', timing.every(t => t.median >= 950),
        timing.map(t => t.median).join(', ') + ' мс');
  check('навесом полёт длинный', timing.every(t => t.slowest >= 1400),
        timing.map(t => t.slowest).join(', ') + ' мс');
  check('дальние свиньи достижимы с запасом', timing.every(t => t.maxReach - t.farX >= 120),
        timing.map(t => t.maxReach - t.farX).join(', ') + ' px');

  console.log('\n--- 7ж. БЕЛАЯ ПТИЦА И ЯЙЦО ---');
  const egg = await page.evaluate(() => {
    Game.loadLevel(0);
    const before = { blocks: Game.blocks.length, pigs: Game.pigs.length };

    // Ставим белую птицу на рогатку принудительно
    for (const b of Game.birds.slice()) Game.destroyEntity(b);
    const bird = new Bird(CONFIG.slingshot.x, CONFIG.slingshot.y, 'white');
    Game.birds.push(bird); Physics.add(bird.body);
    Slingshot.load(bird);

    Matter.Body.setStatic(bird.body, false);
    Matter.Body.setVelocity(bird.body, { x: 21, y: -17 });
    bird.launched = true;
    Slingshot.bird = null; Game.activeBird = bird; Game.state = 'flying';

    // Летим до крепости, затем роняем яйцо
    let steps = 0;
    while (steps < 200 && bird.x < 1150) { Physics.step(16.7); steps++; }
    const ability = bird.useAbility();
    Game.activeBird = bird;
    bird.abilityUsed = false;           // чтобы triggerAbility отработал целиком
    Game.triggerAbility();

    const eggsNow = Game.blocks.filter(b => b.material === 'egg').length;

    let exploded = false;
    for (let i = 0; i < 180; i++) {
      Physics.step(16.7);
      if (Game.pendingExplosions.length) exploded = true;
      Game.processPending();
    }
    const eggsLeft = Game.blocks.filter(b => b.material === 'egg').length;

    return {
      abilityKind: ability ? ability.kind : null,
      eggsCreated: eggsNow, eggsLeft, exploded,
      blocksBefore: before.blocks, blocksAfter: Game.blocks.length,
      pigsBefore: before.pigs, pigsAfter: Game.pigs.length,
      score: Game.score
    };
  });
  console.log('  ' + JSON.stringify(egg));
  check('способность белой птицы это яйцо', egg.abilityKind === 'egg', egg.abilityKind);
  check('яйцо появилось', egg.eggsCreated >= 1, egg.eggsCreated);
  check('яйцо взорвалось', egg.exploded === true);
  check('яйцо не осталось лежать', egg.eggsLeft === 0, egg.eggsLeft);
  check('взрыв яйца нанёс урон',
        egg.blocksAfter < egg.blocksBefore || egg.pigsAfter < egg.pigsBefore,
        'блоки ' + egg.blocksBefore + '->' + egg.blocksAfter + ', свиньи ' + egg.pigsBefore + '->' + egg.pigsAfter);

  console.log('\n--- 7з. КАМЕРА МЕНЯЕТ МАСШТАБ ---');
  const zoom = await page.evaluate(async () => {
    Game.loadLevel(0);
    const aim = Game.zoomAim, fly = Game.zoomFly;
    const atRest = Game.camera.zoom;
    return { aim: +aim.toFixed(3), fly: +fly.toFixed(3), atRest: +atRest.toFixed(3), right: Math.round(Game.levelRight) };
  });
  console.log('  ' + JSON.stringify(zoom));
  check('боевой масштаб крупнее обзорного', zoom.fly > zoom.aim, zoom.aim + ' -> ' + zoom.fly);
  check('на старте камера в обзорном масштабе', Math.abs(zoom.atRest - zoom.aim) < 0.01);
  check('уровень целиком помещается в обзор', zoom.right >= 1700, 'правый край ' + zoom.right);

  console.log('\n--- 8. СКРИНШОТЫ ---');
  await page.evaluate(() => Game.loadLevel(0));
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
