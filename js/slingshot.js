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
    this.trajectory = Physics.predictTrajectory(
      this.pointer.x, this.pointer.y, v.x, v.y, 110, this.bird.body.frictionAir
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
  drawBack(ctx) {
    const a = this.anchor;
    const fork = this.forkPoints();
    const tip = this.bird ? { x: this.bird.x, y: this.bird.y } : { x: a.x, y: a.y - 6 };

    // Ствол рогатки: от земли до развилки
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#6b4423';
    ctx.lineWidth = 22;
    ctx.beginPath();
    ctx.moveTo(a.x, CONFIG.ground.y + 6);
    ctx.lineTo(a.x, a.y + 26);
    ctx.stroke();

    // Две ветки развилки
    ctx.lineWidth = 17;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y + 30);
    ctx.lineTo(fork.left.x, fork.left.y);
    ctx.moveTo(a.x, a.y + 30);
    ctx.lineTo(fork.right.x, fork.right.y);
    ctx.stroke();

    // Светлый блик, чтобы дерево не выглядело плоским
    ctx.strokeStyle = 'rgba(255,255,255,0.14)';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(a.x - 5, CONFIG.ground.y);
    ctx.lineTo(a.x - 5, a.y + 28);
    ctx.stroke();

    // Задняя резинка
    ctx.strokeStyle = '#3b2314';
    ctx.lineWidth = CONFIG.slingshot.bandWidth;
    ctx.beginPath();
    ctx.moveTo(fork.left.x, fork.left.y);
    ctx.lineTo(tip.x, tip.y);
    ctx.stroke();
  },

  /* Координаты концов развилки вынесены в отдельную функцию, потому что нужны
     и при рисовании задней резинки, и при рисовании передней. Одно определение
     вместо двух копий — правишь в одном месте. */
  forkPoints() {
    const a = this.anchor;
    return {
      left:  { x: a.x - 40, y: a.y - 20 },
      right: { x: a.x + 34, y: a.y - 34 }
    };
  },

  drawFront(ctx) {
    const a = this.anchor;
    const forkRight = this.forkPoints().right;
    const tip = this.bird ? { x: this.bird.x, y: this.bird.y } : { x: a.x, y: a.y - 6 };

    ctx.strokeStyle = '#563220';
    ctx.lineCap = 'round';
    ctx.lineWidth = CONFIG.slingshot.bandWidth;
    ctx.beginPath();
    ctx.moveTo(forkRight.x, forkRight.y);
    ctx.lineTo(tip.x, tip.y);
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
