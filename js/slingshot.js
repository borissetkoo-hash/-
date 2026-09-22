/* =============================================================================
   slingshot.js — РОГАТКА: ПРИЦЕЛИВАНИЕ И ВЫСТРЕЛ
   -----------------------------------------------------------------------------
   ГЛАВНАЯ ФОРМУЛА ВСЕЙ ИГРЫ

   Игрок тянет птицу мышкой в точку P. Рогатка закреплена в точке A (anchor).
   Вектор натяжения считается так:

       pull = A - P

   Вычитание именно в таком порядке, потому что птица летит В ПРОТИВОПОЛОЖНУЮ
   сторону от того, куда её оттянули. Оттянул влево-вниз — полетит вправо-вверх.

   Дальше натяжение переводится в скорость простым умножением:

       velocity = pull * power * bird.power

   power из config.js это и есть "жёсткость резинки". Хочешь, чтобы птицы
   летели дальше — увеличь его. Это одна строка в конфиге.

   И ещё одно ограничение: длину pull мы обрезаем до maxPull. Без этого можно
   было бы утащить мышку на километр за экран и получить бесконечную скорость.
   ============================================================================= */

const Slingshot = {

  anchor: { x: CONFIG.slingshot.x, y: CONFIG.slingshot.y },
  bird: null,          // птица, которая сейчас заряжена
  aiming: false,       // тянем ли мы прямо сейчас
  pointer: { x: 0, y: 0 },
  trajectory: [],      // точки пунктира

  /* Зарядить птицу. Она физически существует, но гравитация ей временно
     отключена, иначе она просто упала бы с рогатки на землю. */
  load(bird) {
    this.bird = bird;
    this.aiming = false;
    this.trajectory = [];
    Matter.Body.setPosition(bird.body, { x: this.anchor.x, y: this.anchor.y });
    Matter.Body.setVelocity(bird.body, { x: 0, y: 0 });
    Matter.Body.setAngularVelocity(bird.body, 0);

    /* КАК УДЕРЖАТЬ ПТИЦУ НА РОГАТКЕ
       Первая моя попытка была написать bird.body.gravityScale = 0. Так делают
       в некоторых движках, но в Matter.js 0.20 такого свойства НЕТ: гравитация
       применяется ко всем нестатичным телам без исключений. Строка молча не
       работала, и птица падала на землю. Автотест это поймал.

       Правильное решение: сделать тело СТАТИЧНЫМ. Статичное тело имеет
       бесконечную массу, на него не действует гравитация, и оно спокойно висит
       там, куда мы его поставили. При выстреле вернём его в обычное состояние.

       Мораль: не верь, что свойство существует, только потому что имя выглядит
       логично. Проверяй в документации или тестом. */
    Matter.Body.setStatic(bird.body, true);
  },

  isLoaded() {
    return this.bird !== null && !this.bird.launched;
  },

  /* Можно ли начать тянуть из этой точки?
     Требуем, чтобы клик был рядом с птицей — так игрок не выстрелит случайно,
     ткнув в противоположный край экрана. */
  canGrab(worldX, worldY) {
    if (!this.isLoaded()) return false;
    const dx = worldX - this.bird.x;
    const dy = worldY - this.bird.y;
    const grabRadius = this.bird.radius + 55;
    return (dx * dx + dy * dy) <= grabRadius * grabRadius;
  },

  startAim(worldX, worldY) {
    if (!this.canGrab(worldX, worldY)) return false;
    this.aiming = true;
    this.updateAim(worldX, worldY);
    return true;
  },

  /* ---------------------------------------------------------------------------
     ОБНОВЛЕНИЕ ПРИЦЕЛА
     Здесь происходит обрезка натяжения до maxPull. Смотри, как это делается:
     берём вектор, считаем его длину, и если она больше лимита — нормализуем
     вектор (делаем длину 1) и умножаем на лимит. Классический приём "clamp
     вектора по длине".
     --------------------------------------------------------------------------- */
  updateAim(worldX, worldY) {
    if (!this.aiming || !this.bird) return;

    let dx = worldX - this.anchor.x;
    let dy = worldY - this.anchor.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const max = CONFIG.slingshot.maxPull;

    if (dist > max) {
      dx = (dx / dist) * max;
      dy = (dy / dist) * max;
    }

    this.pointer.x = this.anchor.x + dx;
    this.pointer.y = this.anchor.y + dy;

    // Птица визуально едет за пальцем
    Matter.Body.setPosition(this.bird.body, { x: this.pointer.x, y: this.pointer.y });
    Matter.Body.setVelocity(this.bird.body, { x: 0, y: 0 });

    // И сразу пересчитываем пунктир
    const v = this.launchVelocity();
    /* 240 шагов, а не 110.

       Число шагов — это сколько кадров полёта просчитывается для пунктира.
       Раньше 110 хватало: при гравитации 1.15 птица за это время успевала
       упасть. После ослабления рогатки полёт стал длиннее, и пунктир начал
       обрываться в воздухе, не показывая точку падения. Прицеливаться стало
       не по чему.

       Ловушка в том, что ошибка не выглядит ошибкой: пунктир есть, он просто
       короче. Поймал её тест, который сравнивал конец пунктира с местом, куда
       птица падает на самом деле.

       Лишние шаги почти ничего не стоят: в мире-двойнике всего одно тело. */
    this.trajectory = Physics.predictTrajectory(
      this.pointer.x, this.pointer.y, v.x, v.y, 240, this.bird.body.frictionAir
    );
  },

  /* Та самая формула. Вынесена отдельно, потому что нужна в двух местах:
     для пунктира и для самого выстрела. Дублировать её было бы ошибкой —
     пунктир разошёлся бы с реальным полётом при первой же правке. */
  launchVelocity() {
    const pullX = this.anchor.x - this.pointer.x;
    const pullY = this.anchor.y - this.pointer.y;
    const p = CONFIG.slingshot.power * this.bird.spec.power;
    return { x: pullX * p, y: pullY * p };
  },

  // Насколько сильно натянуто, от 0 до 1. Удобно для звука и для подсветки.
  pullRatio() {
    if (!this.aiming) return 0;
    const dx = this.pointer.x - this.anchor.x;
    const dy = this.pointer.y - this.anchor.y;
    return Math.min(1, Math.sqrt(dx * dx + dy * dy) / CONFIG.slingshot.maxPull);
  },

  /* ---------------------------------------------------------------------------
     ВЫСТРЕЛ
     --------------------------------------------------------------------------- */
  release() {
    if (!this.aiming || !this.bird) return null;

    // Если игрок почти не тянул, считаем это промахом и отменяем выстрел.
    if (this.pullRatio() < 0.08) {
      this.aiming = false;
      this.trajectory = [];
      Matter.Body.setPosition(this.bird.body, { x: this.anchor.x, y: this.anchor.y });
      return null;
    }

    const v = this.launchVelocity();
    const bird = this.bird;

    // Возвращаем тело в обычный режим: снова есть масса и притяжение
    Matter.Body.setStatic(bird.body, false);
    Matter.Body.setVelocity(bird.body, v);

    // Закрутка: птица вращается тем быстрее, чем быстрее летит. Чисто для вида.
    Matter.Body.setAngularVelocity(bird.body, v.x * 0.004);

    bird.launched = true;
    this.aiming = false;
    this.bird = null;
    this.trajectory = [];

    return bird;
  },

  cancel() {
    if (!this.bird) return;
    this.aiming = false;
    this.trajectory = [];
    Matter.Body.setPosition(this.bird.body, { x: this.anchor.x, y: this.anchor.y });
  },

  /* ---------------------------------------------------------------------------
     ОТРИСОВКА
     Порядок важен: сначала ЗАДНЯЯ резинка, потом птица, потом ПЕРЕДНЯЯ.
     Тогда получается, что птица зажата между резинками, как в настоящей
     рогатке. Это называется послойной отрисовкой, painter's algorithm:
     рисуем как художник, от дальнего к ближнему.
     --------------------------------------------------------------------------- */
  /* ---------------------------------------------------------------------------
     РАСКЛАДКА СПРАЙТА РОГАТКИ
     ---------------------------------------------------------------------------
     Картинка не подгоняется под игру, а игра подстраивается под картинку.

     Известно две вещи: в мире рогатка стоит на земле, а птица лежит в развилке
     на высоте anchor. Значит, расстояние от развилки до земли задано игрой.
     В картинке это же расстояние известно в её собственных пикселях. Отношение
     одного к другому и есть масштаб:

         масштаб = (земля - развилка_в_мире) / (низ_картинки - развилка_в_картинке)

     Дальше по масштабу считается, куда положить левый верхний угол картинки,
     и где окажутся точки крепления резинок. Ни одного подобранного на глаз
     числа: замени картинку, перемерь пять координат в config.js, и всё сойдётся
     снова. */
  layout() {
    const sp = CONFIG.slingshot.sprite;

    // Базовый масштаб: от развилки до земли. Затем увеличение сверх него.
    const base = (CONFIG.ground.y - this.anchor.y) / (sp.bottomY - sp.anchorY);
    const scale = base * (sp.boost || 1);

    // Origin считается ОТ РАЗВИЛКИ, поэтому она не сдвигается при увеличении
    const originX = this.anchor.x - sp.anchorX * scale;
    const originY = this.anchor.y - sp.anchorY * scale;

    return {
      scale, originX, originY,
      w: sp.width * scale,
      h: sp.height * scale,
      left:  { x: originX + sp.leftBand.x * scale,  y: originY + sp.leftBand.y * scale },
      right: { x: originX + sp.rightBand.x * scale, y: originY + sp.rightBand.y * scale }
    };
  },

  // Есть ли присланные картинки. Если нет, рисуем рогатку кодом, как раньше.
  hasSprite() {
    return Assets.has('slingshot_back') && Assets.has('slingshot_front');
  },

  /* Куда цепляются резинки. Со спрайтом — по измеренным точкам, без него —
     по старым прикидкам. Вынесено в одно место, чтобы резинки и картинка
     не разъезжались. */
  forkPoints() {
    if (this.hasSprite()) {
      const L = this.layout();
      return { left: L.left, right: L.right };
    }
    const a = this.anchor;
    return {
      left:  { x: a.x - 40, y: a.y - 20 },
      right: { x: a.x + 34, y: a.y - 34 }
    };
  },

  bandTip() {
    return this.bird ? { x: this.bird.x, y: this.bird.y }
                     : { x: this.anchor.x, y: this.anchor.y - 6 };
  },

  /* ---------------------------------------------------------------------------
     ЗАДНИЙ СЛОЙ: ствол с дальней веткой и дальняя резинка.
     Рисуется ДО птицы.
     --------------------------------------------------------------------------- */
  /* ---------------------------------------------------------------------------
     ОБРЕЗКА ПО ЛИНИИ ЗЕМЛИ
     ---------------------------------------------------------------------------
     Рогатка нарочно увеличена, и её ствол уходит ниже земли. Но грунт рисуется
     РАНЬШЕ рогатки, поэтому торчащий низ ствола оказывался поверх грунта и
     выглядел как палка, воткнутая в стену.

     Перерисовывать грунт после рогатки нельзя: он закроет всё остальное.
     Поэтому ставится clip — прямоугольник, за пределами которого холст просто
     не принимает рисование. Всё, что ниже линии земли, обрезается.

     Правило то же, что и с save/restore: поставил clip — обязательно сними,
     иначе обрезаться начнёт и всё, что рисуется после. */
  _clipToGround(ctx) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(-20000, -20000, 40000, 20000 + CONFIG.ground.y + 6);
    ctx.clip();
  },

  drawBack(ctx) {
    const fork = this.forkPoints();
    const tip = this.bandTip();

    this._clipToGround(ctx);
    if (this.hasSprite()) {
      const L = this.layout();
      ctx.drawImage(Assets.get('slingshot_back'), L.originX, L.originY, L.w, L.h);
    } else {
      this._drawWoodenFallback(ctx, fork);
    }
    ctx.restore();

    // Дальняя резинка идёт от правой ветки к птице, позади неё
    this._drawBand(ctx, fork.right, tip, '#3b2314');
    this._drawPouch(ctx);
  },

  /* ---------------------------------------------------------------------------
     ПЕРЕДНИЙ СЛОЙ: ближняя ветка и ближняя резинка.
     Рисуется ПОСЛЕ птицы, поэтому птица оказывается зажата между слоями,
     как в настоящей рогатке. Ради этого художник и разделил картинку надвое.
     --------------------------------------------------------------------------- */
  drawFront(ctx) {
    const fork = this.forkPoints();
    const tip = this.bandTip();

    this._drawBand(ctx, fork.left, tip, '#4a2c19');

    if (this.hasSprite()) {
      const L = this.layout();
      this._clipToGround(ctx);
      ctx.drawImage(Assets.get('slingshot_front'), L.originX, L.originY, L.w, L.h);
      ctx.restore();
    }
  },

  /* Резинка. Чем сильнее натянута, тем тоньше: настоящая резина при растяжении
     утончается, и глаз это считывает как напряжение. */
  _drawBand(ctx, from, to, color) {
    const stretch = this.pullRatio();
    const w = CONFIG.slingshot.bandWidth * (1 - stretch * 0.35);

    ctx.lineCap = 'round';

    // Тёмная кайма под лентой: без неё резинка сливается с деревом рогатки
    ctx.strokeStyle = '#2b1a10';
    ctx.lineWidth = w + 2.5;
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();

    ctx.strokeStyle = color;
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
  },

  /* ---------------------------------------------------------------------------
     КОЖАНОЕ ЛОЖЕ
     ---------------------------------------------------------------------------
     Раньше резинка была просто двумя линиями, упирающимися в птицу. На
     присланном рисунке рогатки видно, как это устроено на самом деле: концы
     резинки держат не саму птицу, а кожаный лоскут, в который она уложена.

     Лоскут рисуется ДО птицы, то есть позади неё, и чуть смещён к развилке.
     Из-за птицы выглядывает только край — ровно столько, чтобы стало понятно,
     что снаряд лежит в коже, а не приклеен к резинкам.

     Пробовал рисовать его поверх птицы: при настоящем игровом масштабе птица
     размером сорок пикселей, и любое пятно поверх неё съедает лицо. Мелкий
     объект не терпит деталей сверху, только по краю.

     Как найти эту сторону: вектор от развилки к птице и есть направление
     оттяжки. Сдвигаем лоскут вдоль него, дальше от развилки. Когда птица лежит
     спокойно, вектор почти нулевой, поэтому берётся направление вниз-влево,
     чтобы ложе всё равно было видно. */
  _drawPouch(ctx) {
    if (!this.bird) return;

    const a = this.anchor;
    let dx = this.bird.x - a.x;
    let dy = this.bird.y - a.y;
    const len = Math.sqrt(dx * dx + dy * dy);

    if (len < 6) { dx = -0.5; dy = 0.86; }        // покой: чуть вниз и влево
    else { dx /= len; dy /= len; }

    const r = this.bird.radius;
    const angle = Math.atan2(dy, dx);

    ctx.save();
    /* Сдвиг ОТРИЦАТЕЛЬНЫЙ, то есть лоскут кладётся между птицей и развилкой.

       Сначала я сдвинул его в другую сторону и получил кожу прямо на морде.
       Причина в том, что птица на оттянутой рогатке развёрнута НАЗАД: её клюв
       смотрит прочь от цели, то есть как раз туда, куда я лоскут и двигал.

       Правильное место — там, где сходятся обе резинки, между птицей и
       развилкой. Заодно это честно: именно в этом месте ложе и держит снаряд. */
    ctx.translate(this.bird.x - dx * r * 0.5, this.bird.y - dy * r * 0.5);
    ctx.rotate(angle);

    ctx.fillStyle = '#4a2c19';
    ctx.strokeStyle = '#2b1a10';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    // Лоскут вытянут поперёк направления оттяжки: узкий вдоль, широкий поперёк
    ctx.ellipse(0, 0, r * 0.42, r * 1.05, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Светлая полоска: кожа не плоская
    ctx.fillStyle = 'rgba(255,255,255,0.13)';
    ctx.beginPath();
    ctx.ellipse(-r * 0.1, 0, r * 0.1, r * 0.7, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  },

  // Запасная отрисовка кодом, если картинок нет
  _drawWoodenFallback(ctx, fork) {
    const a = this.anchor;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#6b4423';
    ctx.lineWidth = 22;
    ctx.beginPath();
    ctx.moveTo(a.x, CONFIG.ground.y + 6);
    ctx.lineTo(a.x, a.y + 26);
    ctx.stroke();

    ctx.lineWidth = 17;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y + 30);
    ctx.lineTo(fork.left.x, fork.left.y);
    ctx.moveTo(a.x, a.y + 30);
    ctx.lineTo(fork.right.x, fork.right.y);
    ctx.stroke();
  },

  /* Пунктир траектории. Точки уменьшаются и бледнеют к концу — так глаз
     понимает направление полёта. Рисуем каждую четвёртую точку, иначе получится
     сплошная линия. */
  drawTrajectory(ctx) {
    if (!this.trajectory.length) return;

    for (let i = 0; i < this.trajectory.length; i += 4) {
      const p = this.trajectory[i];
      const t = i / this.trajectory.length;
      ctx.globalAlpha = 0.85 * (1 - t * 0.75);
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(p.x, p.y, 4.5 * (1 - t * 0.55), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
};
