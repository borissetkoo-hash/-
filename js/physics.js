/* =============================================================================
   physics.js — ФИЗИЧЕСКИЙ СЛОЙ ИГРЫ
   -----------------------------------------------------------------------------
   ПОЧЕМУ МЫ БЕРЁМ ГОТОВЫЙ ДВИЖОК (Matter.js), А НЕ ПИШЕМ СВОЙ

   Физика "твёрдых тел" — это не формула из учебника, это большая инженерная
   задача. Чтобы башня из досок стояла и не дрожала, нужно уметь:
     - быстро находить пары тел, которые МОГУТ столкнуться (broad-phase),
     - точно считать место и глубину касания (narrow-phase),
     - разруливать столкновение так, чтобы тела не проваливались друг в друга,
     - гасить накопленную ошибку, иначе стопка кубиков "взрывается" сама.
   Это тысячи строк и месяцы отладки. Поэтому берём проверенный Matter.js.

   А ВОТ ЭТО МЫ ПИШЕМ САМИ, И ЭТО НАСТОЯЩАЯ ФИЗИКА ИГРЫ:
     - как натяжение рогатки превращается в скорость птицы,
     - как из силы удара получается урон,
     - как считается взрыв,
     - как предсказать траекторию полёта заранее.
   Всё это ниже.
   ============================================================================= */

/* Достаём из Matter.js только те модули, которые нам нужны.
   Это называется деструктуризация: вместо Matter.Engine пишем просто Engine. */
const { Engine, World, Bodies, Body, Composite, Events, Vector, Query } = Matter;

const Physics = {

  engine: null,
  world: null,
  ghostEngine: null,     // отдельный мирок только для предсказания траектории
  ghostBody: null,
  accumulator: 0,        // копилка времени для фиксированного шага
  onImpact: null,        // сюда игра подставит свою функцию обработки урона

  /* ---------------------------------------------------------------------------
     СОЗДАНИЕ МИРА
     --------------------------------------------------------------------------- */
  create() {
    this.engine = Engine.create();
    this.world = this.engine.world;

    // Гравитация. В Matter это ускорение по оси Y, вниз.
    this.engine.gravity.y = CONFIG.world.gravity;

    /* Итерации решателя. Простыми словами: сколько раз за один кадр движок
       перепроверяет и уточняет столкновения. Больше итераций = стабильнее
       башни, но дороже по процессору. Значения по умолчанию 6 и 4, мы их
       поднимаем, потому что у нас высокие стопки из досок. */
    this.engine.positionIterations = 10;
    this.engine.velocityIterations = 8;

    this._createBounds();
    this._createGhostEngine();
    this._listenCollisions();

    return this;
  },

  /* Земля и невидимые стены по краям, чтобы тела не улетали в бесконечность.
     isStatic: true означает "тело не двигается и имеет бесконечную массу".
     Земля не падает вниз именно поэтому. */
  _createBounds() {
    const W = CONFIG.world.width;
    const H = CONFIG.world.height;
    const gy = CONFIG.ground.y;

    const ground = Bodies.rectangle(W / 2, gy + 60, W + 400, 120, {
      isStatic: true,
      friction: CONFIG.ground.friction,
      label: 'ground'
    });

    const leftWall  = Bodies.rectangle(-60, H / 2, 120, H * 3, { isStatic: true, label: 'wall' });
    const rightWall = Bodies.rectangle(W + 60, H / 2, 120, H * 3, { isStatic: true, label: 'wall' });

    Composite.add(this.world, [ground, leftWall, rightWall]);
    this.ground = ground;
  },

  /* ---------------------------------------------------------------------------
     ШАГ СИМУЛЯЦИИ С ФИКСИРОВАННЫМ ВРЕМЕНЕМ
     ---------------------------------------------------------------------------
     Проблема: кадры идут неравномерно. То 16 мс, то 40 мс, если браузер
     отвлёкся. Если кормить движок разным временем, физика будет вести себя
     по-разному на разных компьютерах, а иногда и просто ломаться.

     Решение — "накопитель" (accumulator):
       1. прибавляем реальное прошедшее время в копилку,
       2. пока в копилке есть целый шаг (16.666 мс) — делаем ровно один шаг
          физики и вычитаем это время,
       3. остаток переносим на следующий кадр.
     Так физика всегда считается одинаковыми порциями. Это стандартный приём,
     он называется fixed timestep.
     --------------------------------------------------------------------------- */
  step(realDeltaMs) {
    const fixed = CONFIG.loop.fixedStep;

    // Защита от "спирали смерти": если вкладка была свёрнута и накопилось
    // 10 секунд, мы не будем считать 600 шагов подряд, просто обрежем.
    this.accumulator += Math.min(realDeltaMs, fixed * CONFIG.loop.maxStepsPerFrame);

    let steps = 0;
    while (this.accumulator >= fixed && steps < CONFIG.loop.maxStepsPerFrame) {
      Engine.update(this.engine, fixed);
      this.accumulator -= fixed;
      steps++;
    }
    return steps;
  },

  /* ---------------------------------------------------------------------------
     СТОЛКНОВЕНИЯ И УРОН — САМАЯ ИНТЕРЕСНАЯ ЧАСТЬ
     ---------------------------------------------------------------------------
     Как честно посчитать "силу удара"?

     Наивный вариант — взять скорость. Плохо: пушинка на скорости 30 не должна
     ломать доску, а валун на скорости 5 должен.

     Правильнее взять КИНЕТИЧЕСКУЮ ЭНЕРГИЮ удара. Формула из физики:

         E = 0.5 * m * v^2

     где v — это ОТНОСИТЕЛЬНАЯ скорость сближения двух тел (важно: если оба
     летят рядом с одной скоростью, они друг друга не бьют, и относительная
     скорость равна нулю), а m — "приведённая масса" двух тел:

         m = (m1 * m2) / (m1 + m2)

     Приведённая масса нужна, чтобы лёгкое тело не могло сильно ударить другое
     лёгкое тело, но при этом удар о неподвижную стену (бесконечная масса)
     считался по массе того, кто летит. Проверь сам: если m2 стремится к
     бесконечности, формула превращается просто в m1.
     --------------------------------------------------------------------------- */
  _listenCollisions() {
    Events.on(this.engine, 'collisionStart', (event) => {
      for (const pair of event.pairs) {
        const a = pair.bodyA;
        const b = pair.bodyB;

        // Относительная скорость сближения
        const rvx = a.velocity.x - b.velocity.x;
        const rvy = a.velocity.y - b.velocity.y;
        const relSpeed = Math.sqrt(rvx * rvx + rvy * rvy);

        // Приведённая масса. Статичные тела считаем бесконечно тяжёлыми.
        let m;
        if (a.isStatic) m = b.mass;
        else if (b.isStatic) m = a.mass;
        else m = (a.mass * b.mass) / (a.mass + b.mass);

        const energy = 0.5 * m * relSpeed * relSpeed * CONFIG.damage.energyScale;

        // Слабые касания игнорируем, иначе постройка разрушится сама от того,
        // что доски лежат друг на друге и чуть-чуть подрагивают.
        if (energy < CONFIG.damage.minImpactEnergy) continue;

        // Передаём наружу: пусть игра решает, кому и сколько отнять здоровья.
        if (this.onImpact) {
          this.onImpact(a, b, energy, pair);
        }
      }
    });
  },

  /* ---------------------------------------------------------------------------
     ВЗРЫВ
     ---------------------------------------------------------------------------
     Взрыв это не отдельная "магия", а обычный импульс, применённый ко всем
     телам вокруг точки. Логика:
       1. находим все тела в радиусе,
       2. считаем вектор от центра взрыва к телу,
       3. чем ближе тело, тем сильнее толчок — это затухание falloff,
       4. применяем силу и наносим урон по той же пропорции.

     Body.applyForce принимает силу, а не скорость. Умножаем на массу, чтобы
     тяжёлый камень и лёгкая щепка получили примерно одинаковое УСКОРЕНИЕ,
     иначе камни просто не сдвинулись бы. */
  explode(x, y, radius, forceScale, maxDamage, onDamage) {
    const center = { x, y };
    const bodies = Composite.allBodies(this.world);

    for (const body of bodies) {
      if (body.isStatic) continue;

      const dx = body.position.x - x;
      const dy = body.position.y - y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > radius) continue;

      // Затухание: 1.0 в эпицентре, 0.0 на краю радиуса.
      const falloff = 1 - (dist / radius);

      // Нормализуем направление (делаем длину вектора равной 1).
      // Math.max(dist, 1) страхует от деления на ноль, если тело ровно в центре.
      const safeDist = Math.max(dist, 1);
      const nx = dx / safeDist;
      const ny = dy / safeDist;

      const magnitude = forceScale * falloff * body.mass * 0.02;
      Body.applyForce(body, body.position, { x: nx * magnitude, y: ny * magnitude });

      if (onDamage) onDamage(body, maxDamage * falloff);
    }
  },

  /* ---------------------------------------------------------------------------
     ПРЕДСКАЗАНИЕ ТРАЕКТОРИИ (пунктирные точки при прицеливании)
     ---------------------------------------------------------------------------
     Можно было бы взять школьную формулу параболы. Но тогда пунктир слегка
     не совпал бы с реальным полётом: движок интегрирует численно, у него своё
     сопротивление воздуха (frictionAir) и свой порядок вычислений.

     Приём надёжнее: завести ВТОРОЙ, пустой физический мир-двойник с той же
     гравитацией, запустить в нём одно тело-призрак с той же скоростью и
     прокрутить его вперёд на N шагов, записывая позиции. Получается ровно та
     траектория, которая случится на самом деле. Это дёшево: тело всего одно. */
  _createGhostEngine() {
    this.ghostEngine = Engine.create();
    this.ghostEngine.gravity.y = CONFIG.world.gravity;
    this.ghostBody = Bodies.circle(0, 0, 10, { frictionAir: 0.006 });
    Composite.add(this.ghostEngine.world, this.ghostBody);
  },

  predictTrajectory(startX, startY, velX, velY, steps, frictionAir) {
    const points = [];

    Body.setPosition(this.ghostBody, { x: startX, y: startY });
    Body.setVelocity(this.ghostBody, { x: velX, y: velY });
    Body.setAngularVelocity(this.ghostBody, 0);
    this.ghostBody.frictionAir = frictionAir;

    for (let i = 0; i < steps; i++) {
      Engine.update(this.ghostEngine, CONFIG.loop.fixedStep);
      points.push({ x: this.ghostBody.position.x, y: this.ghostBody.position.y });

      // Дальше земли рисовать смысла нет.
      if (this.ghostBody.position.y > CONFIG.ground.y) break;
    }
    return points;
  },

  /* ---------------------------------------------------------------------------
     ПРОВЕРКА "ВСЁ УСПОКОИЛОСЬ"
     ---------------------------------------------------------------------------
     Нужна, чтобы понять, когда выдавать следующую птицу. Смотрим на самую
     быструю из подвижных частей мира. Если даже она еле шевелится, значит
     обвал закончился. */
  maxSpeed() {
    const bodies = Composite.allBodies(this.world);
    let max = 0;
    for (const body of bodies) {
      if (body.isStatic) continue;
      const v = body.velocity;
      const speed = Math.sqrt(v.x * v.x + v.y * v.y);
      if (speed > max) max = speed;
    }
    return max;
  },

  add(body)    { Composite.add(this.world, body); },
  remove(body) { Composite.remove(this.world, body); },
  allBodies()  { return Composite.allBodies(this.world); }
};
