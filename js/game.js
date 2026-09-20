/* =============================================================================
   game.js — МОЗГ ИГРЫ
   -----------------------------------------------------------------------------
   Этот файл связывает всё остальное:
     физику      (physics.js)
     объекты     (entities.js)
     рогатку     (slingshot.js)
     эффекты     (effects.js)
     данные      (levels.js)

   Главная структура здесь — ИГРОВОЙ ЦИКЛ. Он крутится 60 раз в секунду и
   каждый раз делает ровно три вещи:

       1. ВВОД    — что нажал игрок (это обрабатывается по событиям)
       2. ОБНОВИТЬ— посчитать физику, урон, состояние игры
       3. НАРИСОВАТЬ — показать результат

   Такой цикл лежит в основе вообще любой игры, от тетриса до трёхмерных.
   ============================================================================= */

const Game = {

  canvas: null,
  ctx: null,
  dpr: 1,

  // Все живые объекты уровня
  blocks: [],
  pigs: [],
  birds: [],          // птицы в полёте и лежащие на земле
  queue: [],          // типы птиц, которые ещё не вылетали

  activeBird: null,   // за кем следит камера
  levelIndex: 0,
  level: null,
  theme: null,

  state: 'ready',     // ready | flying | settling | won | lost
  score: 0,
  highscore: 0,

  settleTimer: 0,
  lastTime: 0,

  // Очереди отложенных действий (объясняю ниже, в разделе про урон)
  pendingRemoval: [],
  pendingExplosions: [],

  camera: { x: 0, y: 0, zoom: 1, targetX: 0 },
  shake: 0,

  /* ===========================================================================
     ЗАПУСК
     =========================================================================== */
  init() {
    this.canvas = document.getElementById('game');
    this.ctx = this.canvas.getContext('2d');

    this.highscore = parseInt(localStorage.getItem('ab_highscore') || '0', 10);

    Physics.create();

    /* Подписываемся на удары. Physics не знает про свиней и доски, он просто
       сообщает: "тела A и B столкнулись с энергией E". Решение, что с этим
       делать, принимается здесь. Это называется callback, обратный вызов. */
    Physics.onImpact = (a, bBody, energy) => this.handleImpact(a, bBody, energy);

    this._bindInput();
    this._bindUI();

    window.addEventListener('resize', () => this.resize());
    this.resize();

    this.loadLevel(0);

    this.lastTime = performance.now();
    requestAnimationFrame((t) => this.frame(t));
  },

  /* ---------------------------------------------------------------------------
     РАЗМЕР ХОЛСТА И РЕТИНА-ЭКРАНЫ
     ---------------------------------------------------------------------------
     devicePixelRatio это сколько физических точек экрана приходится на один
     "логический" пиксель CSS. На обычном мониторе 1, на телефоне и на маке 2-3.
     Если это не учесть, картинка будет мыльной. Поэтому холст делаем в dpr раз
     больше, а через CSS показываем в исходном размере.
     --------------------------------------------------------------------------- */
  resize() {
    const rect = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);

    this.canvas.width  = Math.round(rect.width  * this.dpr);
    this.canvas.height = Math.round(rect.height * this.dpr);

    this.cssWidth = rect.width;
    this.cssHeight = rect.height;

    this._computeZooms();
    if (!this.camera.zoom) this.camera.zoom = this.zoomAim;
  },

  /* ---------------------------------------------------------------------------
     ДВА МАСШТАБА: ОБЗОРНЫЙ И БОЕВОЙ
     ---------------------------------------------------------------------------
     Раньше зум был один и подбирался под фиксированную ширину 1520 пикселей.
     Как только крепости отъехали дальше, такой кадр перестал их вмещать.

     Простое решение «отдалить сильнее» плохое: птицы и свиньи станут мелкими, и
     на телефоне в них будет не попасть.

     Поэтому масштабов теперь два, как в настоящей игре:
       zoomAim — пока целишься. Вмещает весь уровень от рогатки до дальнего края,
                 чтобы было видно, куда стрелять.
       zoomFly — пока птица летит. Ближе примерно в полтора раза, камера едет
                 за птицей, и попадание видно во всех подробностях.
     Переключение плавное, тем же приёмом линейной интерполяции, что и движение
     камеры.

     Обрати внимание: ширина считается по САМОМУ уровню, а не задана числом.
     Поэтому новый уровень с постройками подальше сам себя правильно покажет. */
  _computeZooms() {
    if (!this.cssWidth || !this.cssHeight) return;

    const FIT_H = 760;

    /* Ширину обзора ограничиваем сверху. Если вписывать уровень целиком любой
       ценой, на длинном уровне всё становится мелким и на телефоне в птицу уже
       не попасть пальцем. Поэтому дальний край уровня может оставаться за
       кадром: камера догонит его вместе с птицей. */
    const MAX_SPAN = 1750;
    const span = Math.min(this.levelRight || 1600, MAX_SPAN);

    this.zoomAim = Math.max(0.26, Math.min(1.25,
      Math.min(this.cssWidth / span, this.cssHeight / FIT_H)
    ));
    this.zoomFly = Math.min(1.35, this.zoomAim * 1.45);
  },

  /* Где заканчивается уровень по горизонтали: правый край самой дальней
     постройки плюс запас. Считается один раз при загрузке уровня. */
  _measureLevel() {
    let right = CONFIG.slingshot.x + 300;
    for (const b of this.level.blocks) {
      right = Math.max(right, b.x + Math.max(b.w, b.h) / 2);
    }
    for (const p of this.level.pigs) {
      right = Math.max(right, p.x + p.radius);
    }
    this.levelRight = right + 140;
  },

  viewWidth()  { return this.cssWidth  / this.camera.zoom; },
  viewHeight() { return this.cssHeight / this.camera.zoom; },

  /* ===========================================================================
     ЗАГРУЗКА УРОВНЯ
     Берём данные из levels.js и превращаем их в настоящие объекты с телами.
     =========================================================================== */
  loadLevel(index) {
    this.levelIndex = ((index % LEVELS.length) + LEVELS.length) % LEVELS.length;
    this.level = LEVELS[this.levelIndex];
    this.theme = THEMES[this.level.theme] || THEMES.day;

    /* Чистим прошлый уровень. Важно: удалять надо ВСЁ, кроме земли и стен,
       а не только подвижное. Подробности и история бага — в physics.js. */
    Physics.clearWorld();
    Slingshot.bird = null;
    Slingshot.aiming = false;
    Slingshot.trajectory = [];

    this.blocks = [];
    this.pigs = [];
    this.birds = [];
    this.pendingRemoval = [];
    this.pendingExplosions = [];
    Effects.clear();

    for (const data of this.level.blocks) {
      const block = new Block(data.x, data.y, data.w, data.h, data.material, data.angle);
      this.blocks.push(block);
      Physics.add(block.body);
    }

    for (const data of this.level.pigs) {
      const pig = new Pig(data.x, data.y, data.radius, data.kind);
      this.pigs.push(pig);
      Physics.add(pig.body);
    }

    // Копия массива птиц. Именно копия: slice() нужен, чтобы не испортить
    // исходные данные уровня при повторном запуске.
    this.queue = this.level.birds.slice();

    this.score = 0;
    this.state = 'ready';
    this.activeBird = null;
    this.settleTimer = 0;
    this.shake = 0;

    this.camera.x = 0;
    this.camera.targetX = 0;

    // Уровень поменялся — пересчитываем, насколько далеко он тянется
    this._measureLevel();
    this._computeZooms();
    this.camera.zoom = this.zoomAim;

    this._hideOverlay();
    this.nextBird();
    this._updateHUD();
  },

  restart() { this.loadLevel(this.levelIndex); },
  nextLevel() { this.loadLevel(this.levelIndex + 1); },

  /* Достать следующую птицу из очереди и положить на рогатку */
  nextBird() {
    if (this.queue.length === 0) return false;

    const type = this.queue.shift();          // shift берёт первый элемент
    const bird = new Bird(CONFIG.slingshot.x, CONFIG.slingshot.y, type);

    this.birds.push(bird);
    Physics.add(bird.body);
    Slingshot.load(bird);

    this.state = 'ready';
    this.camera.targetX = 0;
    this._updateHUD();
    return true;
  },

  /* ===========================================================================
     УРОН ОТ УДАРА
     ---------------------------------------------------------------------------
     Physics уже посчитал энергию удара. Здесь мы переводим её в урон с учётом
     того, КТО ударил и КОГО ударили:

         урон = энергия * бонус_атакующего * хрупкость_цели

     Бонус атакующего: птица бьёт сильнее, чем просто падающая доска, иначе
     играть было бы невозможно. Хрупкость цели берётся из материала: лёд
     разлетается от того же удара, который камню почти не вредит.
     --------------------------------------------------------------------------- */
  handleImpact(bodyA, bodyB, energy) {
    this._damageOne(bodyA, bodyB, energy);
    this._damageOne(bodyB, bodyA, energy);

    /* Птица сама урона не получает, но на момент удара должна скорчить
       соответствующую рожу. Порог по энергии нужен, чтобы лицо не дёргалось,
       когда птица просто катится по земле и задевает мелочь. */
    if (energy > 40) {
      if (bodyA.gameEntity instanceof Bird) bodyA.gameEntity.registerHit();
      if (bodyB.gameEntity instanceof Bird) bodyB.gameEntity.registerHit();
    }

    // Пыль в месте сильного удара — чисто для ощущения веса
    if (energy > 60) {
      const mx = (bodyA.position.x + bodyB.position.x) / 2;
      const my = (bodyA.position.y + bodyB.position.y) / 2;
      Effects.dust(mx, my, 3);
    }
  },

  _damageOne(target, source, energy) {
    const entity = target.gameEntity;
    if (!entity || !entity.alive) return;

    // Птицы неуязвимы: они снаряд, а не цель.
    if (entity instanceof Bird) return;

    let multiplier = 1;
    const sourceEntity = source.gameEntity;
    if (sourceEntity instanceof Bird) {
      multiplier = CONFIG.damage.birdBonus * sourceEntity.spec.damage;
    }

    const fragility = (entity instanceof Block) ? entity.mat.fragility
                    : (entity instanceof Pig) ? CONFIG.pig.fragility : 1.0;
    const damage = energy * multiplier * fragility;

    if (entity.takeDamage(damage)) {
      this.queueDestroy(entity);
    }
  },

  /* ---------------------------------------------------------------------------
     ПОЧЕМУ УДАЛЕНИЕ ОТЛОЖЕННОЕ
     ---------------------------------------------------------------------------
     Обработчик столкновений вызывается ВНУТРИ шага физики: движок в этот
     момент как раз перебирает список тел. Если удалить тело прямо оттуда,
     список изменится посреди перебора, и движок может упасть или пропустить
     столкновения.

     Поэтому мы не удаляем сразу, а кладём объект в очередь pendingRemoval и
     разбираем её ПОСЛЕ шага физики, когда движок уже закончил работу.
     Тот же приём используют почти все игровые движки; он называется
     "отложенное удаление" (deferred destruction).
     --------------------------------------------------------------------------- */
  queueDestroy(entity) {
    if (entity._queued) return;      // защита от двойного попадания в очередь
    entity._queued = true;
    this.pendingRemoval.push(entity);
  },

  processPending() {
    // 1. Сначала взрывы: они могут добавить в очередь новые разрушения
    while (this.pendingExplosions.length) {
      const e = this.pendingExplosions.shift();
      Physics.explode(e.x, e.y, e.radius, e.force, e.damage, (body, dmg) => {
        const ent = body.gameEntity;
        if (!ent || !ent.alive || ent instanceof Bird) return;
        if (ent.takeDamage(dmg)) this.queueDestroy(ent);
      });
      Effects.explosion(e.x, e.y, e.radius);
      this.shake = Math.max(this.shake, 16);
    }

    // 2. Потом удаления
    while (this.pendingRemoval.length) {
      const entity = this.pendingRemoval.shift();
      this.destroyEntity(entity);
    }
  },

  destroyEntity(entity) {
    if (entity instanceof Pig) {
      this.addScore(CONFIG.score.perPig, entity.x, entity.y);
      Effects.pop(entity.x, entity.y, CONFIG.pig.color);
      this.shake = Math.max(this.shake, 6);
      this.pigs = this.pigs.filter(p => p !== entity);

    } else if (entity instanceof Block) {
      // За яйцо очки не начисляются: это свой снаряд, а не постройка врага
      if (entity.material !== 'egg') {
        this.addScore(CONFIG.score.perBlock, entity.x, entity.y);
      }
      Effects.debris(entity.x, entity.y, entity.mat.color, 9, 5);

      // Динамит и яйцо не просто ломаются, а взрываются
      if (entity.material === 'tnt') {
        this.pendingExplosions.push({
          x: entity.x, y: entity.y,
          radius: CONFIG.abilities.bombRadius,
          force: CONFIG.abilities.bombForce,
          damage: CONFIG.abilities.bombDamage
        });
      } else if (entity.material === 'egg') {
        this.pendingExplosions.push({
          x: entity.x, y: entity.y,
          radius: CONFIG.abilities.eggRadius,
          force: CONFIG.abilities.eggForce,
          damage: CONFIG.abilities.eggDamage
        });
      }
      this.blocks = this.blocks.filter(b => b !== entity);

    } else if (entity instanceof Bird) {
      this.birds = this.birds.filter(b => b !== entity);
      if (this.activeBird === entity) this.activeBird = null;
    }

    Physics.remove(entity.body);
  },

  /* ---------------------------------------------------------------------------
     УРОН ОТ ПРИДАВЛИВАНИЯ
     ---------------------------------------------------------------------------
     Physics считает, с какой силой на каждое тело давят соседи. Здесь эта сила
     превращается в урон свиньям.

     Ключевой момент — вычитание порога:

         урон = (давление - порог) * скорость * время

     Без вычитания свинья медленно умирала бы просто от того, что стоит на
     земле: контакт с землёй тоже даёт давление. Порог отсекает нормальное
     «стою и ничего не происходит» и оставляет только настоящий завал.

     Умножение на время кадра нужно, чтобы урон не зависел от частоты кадров:
     на экране 144 Гц свинья должна умирать за то же время, что и на 60 Гц. */
  _applyCrushDamage(dt) {
    const threshold = CONFIG.damage.crushThreshold;
    const rate = CONFIG.damage.crushRate;

    for (const pig of this.pigs.slice()) {
      if (!pig.alive) continue;
      const load = Physics.loadOn(pig.body);
      if (load <= threshold) continue;

      const damage = (load - threshold) * rate * dt;
      if (pig.takeDamage(damage, false)) {
        this.queueDestroy(pig);
      }
    }
  },

  addScore(points, x, y) {
    this.score += points;
    if (x !== undefined) Effects.scorePopup(x, y, '+' + points);
    this._updateHUD();
  },

  /* ===========================================================================
     ВВОД: МЫШЬ И ПАЛЕЦ ОДНИМ КОДОМ
     ---------------------------------------------------------------------------
     Pointer Events это современный стандарт, который объединяет мышь, палец и
     стилус. Вместо того чтобы писать отдельно mousedown и touchstart, пишем
     один pointerdown. Меньше кода и меньше багов.
     =========================================================================== */
  _bindInput() {
    const c = this.canvas;

    c.addEventListener('pointerdown', (e) => {
      c.setPointerCapture(e.pointerId);   // продолжаем получать события, даже
                                          // если палец уехал за край холста
      const w = this.screenToWorld(e.clientX, e.clientY);

      if (this.state === 'ready' && Slingshot.startAim(w.x, w.y)) {
        return;
      }
      // Тап в полёте = способность птицы
      if (this.state === 'flying' && this.activeBird) {
        this.triggerAbility();
      }
    });

    c.addEventListener('pointermove', (e) => {
      if (!Slingshot.aiming) return;
      const w = this.screenToWorld(e.clientX, e.clientY);
      Slingshot.updateAim(w.x, w.y);
    });

    const endAim = () => {
      if (!Slingshot.aiming) return;
      const launched = Slingshot.release();
      if (launched) {
        this.activeBird = launched;
        this.state = 'flying';
        this.settleTimer = 0;
      }
    };

    c.addEventListener('pointerup', endAim);
    c.addEventListener('pointercancel', endAim);

    // Клавиатура: пробел это способность, R перезапуск
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space') { e.preventDefault(); this.triggerAbility(); }
      if (e.code === 'KeyR') this.restart();
      if (e.code === 'KeyD') CONFIG.debug = !CONFIG.debug;
    });
  },

  _bindUI() {
    document.getElementById('btn-restart').addEventListener('click', () => this.restart());
    document.getElementById('btn-next').addEventListener('click', () => this.nextLevel());
    document.getElementById('btn-overlay-restart').addEventListener('click', () => this.restart());
    document.getElementById('btn-overlay-next').addEventListener('click', () => this.nextLevel());
  },

  /* Перевод координат экрана в координаты мира.
     Обратная операция к тому, что делает камера при отрисовке. */
  screenToWorld(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: (clientX - rect.left) / this.camera.zoom + this.camera.x,
      y: (clientY - rect.top)  / this.camera.zoom + this.camera.y
    };
  },

  /* ===========================================================================
     СПОСОБНОСТИ ПТИЦ
     =========================================================================== */
  triggerAbility() {
    if (this.state !== 'flying' || !this.activeBird) return;

    const result = this.activeBird.useAbility();
    if (!result) return;

    if (result.kind === 'split') {
      /* Делим синюю птицу на три. Две копии получают ту же скорость,
         повёрнутую на +spread и -spread. Формула поворота вектора:
             x' = x*cos(a) - y*sin(a)
             y' = x*sin(a) + y*cos(a) */
      const v = result.velocity;
      for (const a of [-result.spread, result.spread]) {
        const cos = Math.cos(a), sin = Math.sin(a);
        const clone = new Bird(this.activeBird.x, this.activeBird.y, 'blue');
        clone.launched = true;
        clone.abilityUsed = true;
        this.birds.push(clone);
        Physics.add(clone.body);
        Matter.Body.setVelocity(clone.body, {
          x: v.x * cos - v.y * sin,
          y: v.x * sin + v.y * cos
        });
      }
      Effects.dust(this.activeBird.x, this.activeBird.y, 4);

    } else if (result.kind === 'bomb') {
      this.pendingExplosions.push({
        x: result.x, y: result.y,
        radius: CONFIG.abilities.bombRadius,
        force: CONFIG.abilities.bombForce,
        damage: CONFIG.abilities.bombDamage
      });
      this.queueDestroy(this.activeBird);

    } else if (result.kind === 'egg') {
      const bird = this.activeBird;
      const v = result.velocity;

      // Яйцо появляется ПОД птицей, с запасом, чтобы не задеть её саму
      const egg = new Block(bird.x, bird.y + bird.radius + 16, 15, 19, 'egg');
      this.blocks.push(egg);
      Physics.add(egg.body);
      Matter.Body.setVelocity(egg.body, {
        x: v.x * 0.35,
        y: Math.abs(v.y) * 0.25 + 5
      });

      // Отдача: птица уходит вперёд и вверх, прочь от собственного взрыва
      const recoil = CONFIG.abilities.eggRecoil;
      Matter.Body.setVelocity(bird.body, {
        x: v.x * 0.75,
        y: -Math.abs(v.y) * recoil - 5
      });

      Effects.dust(bird.x, bird.y + bird.radius, 4);

    } else if (result.kind === 'dash') {
      Effects.dust(this.activeBird.x, this.activeBird.y, 3);
    }
  },

  /* ===========================================================================
     ИГРОВОЙ ЦИКЛ
     ---------------------------------------------------------------------------
     requestAnimationFrame просит браузер вызвать нашу функцию перед следующей
     перерисовкой экрана. Это лучше, чем setInterval: браузер сам подбирает
     момент, синхронизирует с частотой монитора и тормозит цикл в фоновой
     вкладке, экономя батарею.
     =========================================================================== */
  frame(now) {
    const dt = now - this.lastTime;
    this.lastTime = now;

    this.update(dt);
    this.render();

    requestAnimationFrame((t) => this.frame(t));
  },

  update(dt) {
    // 1. Физика
    Physics.step(dt);

    // 2. Разбираем очереди разрушений и взрывов (см. пояснение выше)
    this.processPending();

    // 3. Урон от придавливания: свинья под завалом должна погибать
    this._applyCrushDamage(dt);

    // 4. Обновляем персонажей: моргание свиней, выражение лица и поворот птиц
    for (const pig of this.pigs) pig.update(dt);
    for (const bird of this.birds) bird.update(dt);

    // 5. Частицы
    Effects.update();

    // 6. Логика хода
    this._updateTurn(dt);

    // 7. Камера
    this._updateCamera();

    // 8. Тряска экрана затухает
    if (this.shake > 0) this.shake *= 0.9;
  },

  /* ---------------------------------------------------------------------------
     ЛОГИКА ХОДА: КОГДА ДАВАТЬ СЛЕДУЮЩУЮ ПТИЦУ
     ---------------------------------------------------------------------------
     Нельзя просто ждать секунду после выстрела: обвал может длиться и пять
     секунд. Поэтому ждём, пока мир успокоится. "Успокоился" значит: самое
     быстрое подвижное тело движется медленнее порога, и держится это состояние
     уже некоторое время подряд (settleTime).

     Таймер birdTimeout — страховка на случай, если что-то катится по земле
     бесконечно. Без такой страховки игра могла бы зависнуть навсегда.
     --------------------------------------------------------------------------- */
  _updateTurn(dt) {
    if (this.state === 'won' || this.state === 'lost') return;

    // Победа: свиней не осталось
    if (this.pigs.length === 0 && this.state !== 'ready') {
      this._win();
      return;
    }

    if (this.state !== 'flying') return;

    if (this.activeBird) {
      this.activeBird.lifeTimer += dt;

      // Птица улетела за пределы мира
      if (this.activeBird.x > CONFIG.world.width - 40 || this.activeBird.y > CONFIG.world.height) {
        this.queueDestroy(this.activeBird);
        this.activeBird = null;
      }
    }

    const speed = Physics.maxSpeed();
    if (speed < CONFIG.loop.settleSpeed) {
      this.settleTimer += dt;
    } else {
      this.settleTimer = 0;
    }

    const timedOut = this.activeBird && this.activeBird.lifeTimer > CONFIG.loop.birdTimeout;

    if (this.settleTimer > CONFIG.loop.settleTime || timedOut) {
      this._endTurn();
    }
  },

  _endTurn() {
    if (this.pigs.length === 0) { this._win(); return; }

    // Убираем отработавших птиц с поля
    for (const bird of this.birds.slice()) {
      if (bird.launched) this.destroyEntity(bird);
    }
    this.activeBird = null;
    this.settleTimer = 0;

    if (!this.nextBird()) {
      this._lose();
    }
  },

  _win() {
    if (this.state === 'won') return;
    this.state = 'won';

    // Бонус за каждую неиспользованную птицу
    const unused = this.queue.length;
    if (unused > 0) this.score += unused * CONFIG.score.perUnusedBird;

    if (this.score > this.highscore) {
      this.highscore = this.score;
      localStorage.setItem('ab_highscore', String(this.highscore));
    }
    this._updateHUD();
    this._showOverlay('Уровень пройден!',
      'Очки: ' + this.score + (unused ? '  (бонус за ' + unused + ' птиц)' : ''), true);
  },

  _lose() {
    this.state = 'lost';
    this._showOverlay('Птицы кончились', 'Осталось свиней: ' + this.pigs.length, false);
  },

  /* ---------------------------------------------------------------------------
     КАМЕРА
     ---------------------------------------------------------------------------
     Камера не прыгает к цели мгновенно, а ПЛАВНО к ней едет. Приём называется
     линейная интерполяция, сокращённо lerp:

         позиция += (цель - позиция) * k

     При k = 0.085 камера за кадр проходит 8.5% оставшегося расстояния. Получается
     мягкое торможение: сначала быстро, потом всё медленнее. Одна строка, а
     ощущение от игры меняется полностью.
     --------------------------------------------------------------------------- */
  _updateCamera() {
    const flying = this.activeBird && this.state === 'flying';

    // Плавно переезжаем между обзорным и боевым масштабом
    const targetZoom = flying ? this.zoomFly : this.zoomAim;
    this.camera.zoom += (targetZoom - this.camera.zoom) * CONFIG.camera.zoomSpeed;

    const viewW = this.viewWidth();
    const viewH = this.viewHeight();

    let target;
    let k;

    if (flying) {
      target = this.activeBird.x - viewW * 0.4;
      k = CONFIG.camera.follow;
    } else {
      target = 0;                       // возвращаемся к рогатке
      k = CONFIG.camera.returnFollow;
    }

    // Не выпускаем камеру за края мира
    const maxX = Math.max(0, CONFIG.world.width - viewW);
    target = Math.max(0, Math.min(maxX, target));

    this.camera.x += (target - this.camera.x) * k;

    /* По вертикали земля держится на 82% высоты экрана.

       Раньше было «90 пикселей мира ниже земли», и на широком экране это
       означало почти 92% высоты: небо занимало три четверти кадра впустую.
       Доля вместо фиксированного числа даёт одинаковую композицию на любом
       экране: сверху воздух для навесных выстрелов, снизу полоса грунта. */
    this.camera.y = CONFIG.ground.y - viewH * 0.82;
  },

  /* ===========================================================================
     ОТРИСОВКА
     =========================================================================== */
  render() {
    const ctx = this.ctx;
    const z = this.camera.zoom * this.dpr;

    // Тряска экрана: случайное смещение, затухающее со временем
    const sx = this.shake > 0.2 ? (Math.random() - 0.5) * this.shake : 0;
    const sy = this.shake > 0.2 ? (Math.random() - 0.5) * this.shake : 0;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    this._drawBackground(ctx);

    /* setTransform задаёт сразу и масштаб, и сдвиг камеры.
       Дальше мы рисуем всё в координатах МИРА, а браузер сам переводит их в
       координаты экрана. Это избавляет от ручного вычитания камеры в каждой
       функции рисования. */
    ctx.setTransform(z, 0, 0, z, (-this.camera.x + sx) * z, (-this.camera.y + sy) * z);

    this._drawGround(ctx);

    Slingshot.drawBack(ctx);

    for (const block of this.blocks) block.draw(ctx);
    for (const pig of this.pigs) pig.draw(ctx);
    for (const bird of this.birds) bird.draw(ctx);

    Slingshot.drawFront(ctx);
    Slingshot.drawTrajectory(ctx);

    Effects.draw(ctx);

    this._drawBirdQueue(ctx);

    if (CONFIG.debug) this._drawDebug(ctx);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
  },

  /* Фон с параллаксом. Дальние слои сдвигаются медленнее ближних — именно так
     работает зрение, когда едешь в поезде: столбы мелькают, а лес почти стоит.
     Множитель 0.25 значит "этот слой едет вчетверо медленнее камеры". */
  _drawBackground(ctx) {
    const W = this.canvas.width;
    const H = this.canvas.height;
    const t = this.theme;

    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, t.skyTop);
    sky.addColorStop(1, t.skyBottom);
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);

    const d = this.dpr;
    const camOffset = this.camera.x * this.camera.zoom * d;

    // Облака
    ctx.fillStyle = t.cloud;
    for (let i = 0; i < 6; i++) {
      const cx = ((i * 520 + 120) - camOffset * 0.18) % (W + 700) - 200;
      const cy = 60 * d + (i % 3) * 55 * d;
      const r = (34 + (i % 3) * 16) * d;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.arc(cx + r * 0.9, cy + r * 0.16, r * 0.78, 0, Math.PI * 2);
      ctx.arc(cx - r * 0.85, cy + r * 0.2, r * 0.66, 0, Math.PI * 2);
      ctx.fill();
    }

    // Дальние холмы
    const baseY = H * 0.78;
    ctx.fillStyle = t.hillDark;
    ctx.beginPath();
    ctx.moveTo(0, H);
    for (let i = 0; i <= 8; i++) {
      const hx = (i * 340 * d - camOffset * 0.25) % (W + 700) - 250;
      ctx.moveTo(hx - 220 * d, H);
      ctx.quadraticCurveTo(hx, baseY - 110 * d, hx + 220 * d, H);
    }
    ctx.fill();

    ctx.fillStyle = t.hill;
    for (let i = 0; i <= 8; i++) {
      const hx = (i * 280 * d - camOffset * 0.42) % (W + 600) - 200;
      ctx.beginPath();
      ctx.moveTo(hx - 170 * d, H);
      ctx.quadraticCurveTo(hx, baseY - 40 * d, hx + 170 * d, H);
      ctx.fill();
    }
  },

  _drawGround(ctx) {
    const t = this.theme;
    const W = CONFIG.world.width + 600;
    const gy = CONFIG.ground.y;

    ctx.fillStyle = t.groundBody;
    ctx.fillRect(-300, gy, W, CONFIG.world.height - gy + 400);

    ctx.fillStyle = t.groundTop;
    ctx.fillRect(-300, gy - 8, W, 20);

    // Штрихи на грунте, чтобы земля не выглядела пустой заливкой
    ctx.strokeStyle = 'rgba(0,0,0,0.12)';
    ctx.lineWidth = 2;
    for (let x = -300; x < W; x += 60) {
      ctx.beginPath();
      ctx.moveTo(x, gy + 26);
      ctx.lineTo(x + 26, gy + 52);
      ctx.stroke();
    }
  },

  /* Очередь птиц слева от рогатки, как в оригинале.
     В присланной записи настоящей игры видно именно это: птицы, ждущие
     своей очереди, сидят на земле слева и подпрыгивают к рогатке по одной. */
  _drawBirdQueue(ctx) {
    /* Очередь идёт влево от рогатки. Шаг и отступ подобраны так, чтобы даже
       шесть птиц целиком помещались в кадр: при отступе 120 и шаге 46 пятая
       птица уезжала за левый край экрана. */
    const baseX = CONFIG.slingshot.x - 92;
    const baseY = CONFIG.ground.y - 18;

    for (let i = 0; i < this.queue.length; i++) {
      const type = this.queue[i];
      const spec = CONFIG.birds[type];
      const x = baseX - i * 36;

      // Если есть настоящий спрайт этой птицы — рисуем спокойное лицо
      const set = Assets.set('bird_' + type);
      if (set && set.roles.idle !== undefined) {
        if (Assets.drawFrame(ctx, 'bird_' + type, set.roles.idle,
                             x, baseY, spec.radius * 1.5, 0)) {
          continue;
        }
      }

      // Иначе кружок с клювом, как раньше
      ctx.save();
      ctx.globalAlpha = 0.95;
      ctx.beginPath();
      ctx.arc(x, baseY, spec.radius * 0.85, 0, Math.PI * 2);
      ctx.fillStyle = spec.color;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = spec.edge;
      ctx.stroke();

      ctx.fillStyle = '#f5a623';
      ctx.beginPath();
      ctx.moveTo(spec.radius * 0.5 + x, baseY - 2);
      ctx.lineTo(spec.radius * 1.05 + x, baseY + 2);
      ctx.lineTo(spec.radius * 0.5 + x, baseY + 7);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  },

  // Отладочный режим: показывает настоящие физические контуры (клавиша D)
  _drawDebug(ctx) {
    ctx.strokeStyle = '#00ff88';
    ctx.lineWidth = 1;
    for (const body of Physics.allBodies()) {
      ctx.beginPath();
      const v = body.vertices;
      ctx.moveTo(v[0].x, v[0].y);
      for (let i = 1; i < v.length; i++) ctx.lineTo(v[i].x, v[i].y);
      ctx.closePath();
      ctx.stroke();
    }
  },

  /* ===========================================================================
     ИНТЕРФЕЙС (обычный HTML поверх холста)
     Кнопки и счёт проще и правильнее делать обычными HTML-элементами:
     их видно скринридерам, они сами масштабируются и не надо вручную
     вычислять попадание клика в прямоугольник.
     =========================================================================== */
  _updateHUD() {
    document.getElementById('score').textContent = this.score;
    document.getElementById('highscore').textContent = this.highscore;
    document.getElementById('level-name').textContent = this.level ? this.level.name : '';
    document.getElementById('birds-left').textContent = this.queue.length;
    document.getElementById('pigs-left').textContent = this.pigs.length;
  },

  _showOverlay(title, text, won) {
    const el = document.getElementById('overlay');
    document.getElementById('overlay-title').textContent = title;
    document.getElementById('overlay-text').textContent = text;
    document.getElementById('btn-overlay-next').style.display = won ? 'inline-block' : 'none';
    el.classList.add('visible');
  },

  _hideOverlay() {
    document.getElementById('overlay').classList.remove('visible');
  }
};

/* Точка входа. Сначала грузим картинки (если их нет — не страшно, см.
   assets.js), и только потом запускаем игру. */
window.addEventListener('DOMContentLoaded', () => {
  Assets.load(() => Game.init());
});
