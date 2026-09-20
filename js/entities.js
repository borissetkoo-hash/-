/* =============================================================================
   entities.js — ОБЪЕКТЫ ИГРЫ: БЛОКИ, СВИНЬИ, ПТИЦЫ
   -----------------------------------------------------------------------------
   Здесь мы используем КЛАССЫ. Класс это чертёж, по которому делают объекты.
   Один класс Pig — а свиней на уровне может быть десять, и каждая со своим
   здоровьем и положением.

   Важная идея всей архитектуры: у каждой сущности ДВА представления.
     1. body  — физическое тело внутри Matter.js. Движок двигает только его,
                про картинки он ничего не знает.
     2. draw  — как эта сущность выглядит. Рисование читает body.position и
                body.angle и рисует по ним.
   Физика и графика разделены. Поэтому можно поменять спрайт, не трогая физику,
   и наоборот. Это называется разделением ответственности.
   ============================================================================= */

/* -----------------------------------------------------------------------------
   БАЗОВЫЙ КЛАСС
   Общее для всех: здоровье, получение урона, смерть.
   Остальные классы его наследуют через extends и не переписывают это заново.
   ----------------------------------------------------------------------------- */
class Entity {
  constructor(body, hp) {
    this.body = body;
    this.hp = hp;
    this.maxHp = hp;
    this.alive = true;

    /* Обратная ссылка: из физического тела можно найти игровой объект.
       Это нужно в обработчике столкновений: Matter даёт нам body, а нам надо
       понять, свинья это или доска. */
    body.gameEntity = this;
  }

  takeDamage(amount) {
    if (!this.alive) return false;
    this.hp -= amount;
    if (this.hp <= 0) {
      this.alive = false;
      return true;         // true означает "объект только что уничтожен"
    }
    return false;
  }

  // Доля оставшегося здоровья от 0 до 1. Нужна для трещин и мигания.
  healthRatio() {
    return Math.max(0, this.hp / this.maxHp);
  }

  get x() { return this.body.position.x; }
  get y() { return this.body.position.y; }
  get angle() { return this.body.angle; }
}

/* =============================================================================
   БЛОК — доска, камень, лёд или ящик динамита
   ============================================================================= */
class Block extends Entity {
  constructor(x, y, w, h, materialName, angle = 0) {
    const mat = CONFIG.materials[materialName];

    /* Bodies.rectangle создаёт прямоугольное тело.
       Обрати внимание: координаты это ЦЕНТР прямоугольника, а не левый верхний
       угол. Это частый источник путаницы у новичков. */
    const body = Matter.Bodies.rectangle(x, y, w, h, {
      density: mat.density,
      friction: mat.friction,
      restitution: mat.restitution,
      frictionAir: 0.002,
      angle: angle,
      label: 'block'
    });

    // hp зависит от размера: длинная балка крепче короткого брусочка.
    const sizeFactor = Math.sqrt((w * h) / 2000);
    super(body, mat.hp * Math.max(0.6, sizeFactor));

    this.w = w;
    this.h = h;
    this.material = materialName;
    this.mat = mat;
  }

  draw(ctx) {
    const spriteName = 'block_' + this.material;
    if (Assets.drawSprite(ctx, spriteName, this.x, this.y, this.w, this.h, this.angle)) {
      return;   // спрайт нашёлся и уже нарисован
    }

    // Запасной вариант: рисуем блок кодом
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.angle);

    const hw = this.w / 2;
    const hh = this.h / 2;
    const r = Math.min(4, hw, hh);   // радиус скругления углов

    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(-hw, -hh, this.w, this.h, r);
    else ctx.rect(-hw, -hh, this.w, this.h);

    ctx.fillStyle = this.mat.color;
    if (this.material === 'ice') ctx.globalAlpha = 0.75;
    ctx.fill();
    ctx.globalAlpha = 1;

    ctx.lineWidth = 2;
    ctx.strokeStyle = this.mat.edge;
    ctx.stroke();

    // Фактура материала
    ctx.save();
    ctx.clip();                       // рисуем только внутри блока
    if (this.material === 'wood') {
      ctx.strokeStyle = 'rgba(0,0,0,0.13)';
      ctx.lineWidth = 1;
      const long = this.w >= this.h;
      const count = 3;
      for (let i = 1; i < count; i++) {
        ctx.beginPath();
        if (long) {
          const yy = -hh + (this.h * i) / count;
          ctx.moveTo(-hw, yy); ctx.lineTo(hw, yy);
        } else {
          const xx = -hw + (this.w * i) / count;
          ctx.moveTo(xx, -hh); ctx.lineTo(xx, hh);
        }
        ctx.stroke();
      }
    } else if (this.material === 'stone') {
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      for (let i = 0; i < 6; i++) {
        const px = -hw + ((i * 37) % Math.max(1, this.w));
        const py = -hh + ((i * 53) % Math.max(1, this.h));
        ctx.fillRect(px, py, 3, 3);
      }
    } else if (this.material === 'ice') {
      ctx.fillStyle = 'rgba(255,255,255,0.45)';
      ctx.fillRect(-hw + 3, -hh + 3, Math.max(2, this.w * 0.18), this.h - 6);
    } else if (this.material === 'tnt') {
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold ' + Math.max(8, Math.min(this.h * 0.55, this.w * 0.35)) + 'px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('TNT', 0, 0);
    }
    ctx.restore();

    this._drawCracks(ctx, hw, hh);
    ctx.restore();
  }

  /* Трещины. Появляются, когда блок повреждён больше чем на треть.
     Это не отдельная физика, а чисто визуальная подсказка игроку:
     "сюда ещё раз ударь, и сломается". */
  _drawCracks(ctx, hw, hh) {
    const ratio = this.healthRatio();
    if (ratio > 0.66) return;

    ctx.strokeStyle = 'rgba(0,0,0,' + (0.25 + (1 - ratio) * 0.4) + ')';
    ctx.lineWidth = 1.6;
    const lines = ratio > 0.33 ? 2 : 4;
    for (let i = 0; i < lines; i++) {
      const sx = -hw + (hw * 2 * ((i * 0.37 + 0.18) % 1));
      ctx.beginPath();
      ctx.moveTo(sx, -hh);
      ctx.lineTo(sx + hw * 0.22, 0);
      ctx.lineTo(sx - hw * 0.15, hh);
      ctx.stroke();
    }
  }
}

/* =============================================================================
   СВИНЬЯ — круглая цель, которую надо уничтожить
   ============================================================================= */
class Pig extends Entity {
  constructor(x, y, radius, kind = 'normal') {
    const p = CONFIG.pig;

    const body = Matter.Bodies.circle(x, y, radius, {
      density: p.density,
      friction: p.friction,
      restitution: p.restitution,
      frictionAir: 0.004,
      label: 'pig'
    });

    /* Прочность зависит ТОЛЬКО от размера. Раньше были ещё скрытые множители
       за каску и корону, но каски и короны нет на присланном листе, а значит
       игрок не мог бы увидеть разницу. Скрытая от игрока прочность — плохая
       механика: свинья выглядит как соседняя, а ломается вдвое дольше, и
       выглядит это как поломка игры, а не как замысел.
       Теперь всё честно: крупная свинья крепче, и это видно. */
    super(body, radius * CONFIG.pig.hpPerRadius * 10);

    this.radius = radius;
    this.kind = kind;
    this.hurtFlash = 0;    // счётчик реакции на попадание

    /* Моргание. Случайная пауза, а не одинаковая для всех: если все свиньи на
       уровне моргнут одновременно, получится жутковато и сразу видно, что это
       машина. Разброс делает их живыми. */
    this.blinking = false;
    this.blinkTimer = 800 + Math.random() * 3000;
  }

  /* spike отвечает за мимику. Резкий удар — свинья корчится (кадр реакции).
     Медленное придавливание — тоже больно, но рожу корчить незачем, иначе
     придавленная свинья застынет с одним и тем же выражением навсегда. */
  takeDamage(amount, spike = true) {
    if (spike) this.hurtFlash = 1;
    else this.hurtFlash = Math.max(this.hurtFlash, 0.5);
    return super.takeDamage(amount);
  }

  /* ---------------------------------------------------------------------------
     СТАДИЯ ПОВРЕЖДЕНИЙ
     ---------------------------------------------------------------------------
     На присланном листе девять кадров: три состояния по три кадра.
     Целая, с одним синяком, с двумя синяками и высунутым языком.
     Переводим оставшееся здоровье в номер стадии: выше двух третей — целая,
     выше трети — побитая, ниже — еле живая. Игрок видит по лицу, сколько ещё
     осталось, и это честная подсказка, а не украшение.
     --------------------------------------------------------------------------- */
  damageStage() {
    const ratio = this.healthRatio();
    if (ratio > 0.66) return 0;
    if (ratio > 0.33) return 1;
    return 2;
  }

  update(dt) {
    // Плавно гасим реакцию на удар
    if (this.hurtFlash > 0) this.hurtFlash *= 0.92;

    // Моргание: короткое закрытие глаз и длинная пауза
    this.blinkTimer -= dt;
    if (this.blinkTimer <= 0) {
      this.blinking = !this.blinking;
      this.blinkTimer = this.blinking ? 130 : 1600 + Math.random() * 3200;
    }
  }

  draw(ctx) {
    const set = Assets.set('pig_green');
    if (set && set.roles.stages) {
      const stage = set.roles.stages[this.damageStage()];
      // В каждой стадии три кадра: обычный, моргание, реакция на удар
      let frame = stage[0];
      if (this.hurtFlash > 0.35) frame = stage[2];
      else if (this.blinking) frame = stage[1];

      if (Assets.drawFrame(ctx, 'pig_green', frame,
                           this.x, this.y, this.radius * 2, this.angle)) {
        return;
      }
    }

    const r = this.radius;
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.angle);

    // Чем меньше здоровья, тем темнее и "побитее" свинья
    const hurt = 1 - this.healthRatio();

    // Уши
    ctx.fillStyle = CONFIG.pig.edge;
    ctx.beginPath();
    ctx.arc(-r * 0.62, -r * 0.62, r * 0.26, 0, Math.PI * 2);
    ctx.arc(r * 0.62, -r * 0.62, r * 0.26, 0, Math.PI * 2);
    ctx.fill();

    // Тело
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fillStyle = CONFIG.pig.color;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = CONFIG.pig.edge;
    ctx.stroke();

    // Затемнение от повреждений
    if (hurt > 0.05) {
      ctx.globalAlpha = hurt * 0.45;
      ctx.fillStyle = '#2c4a18';
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    // Пятачок
    ctx.beginPath();
    ctx.ellipse(0, r * 0.18, r * 0.42, r * 0.32, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#5fae37';
    ctx.fill();
    ctx.strokeStyle = CONFIG.pig.edge;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Ноздри
    ctx.fillStyle = '#35651c';
    ctx.beginPath();
    ctx.ellipse(-r * 0.15, r * 0.18, r * 0.08, r * 0.11, 0, 0, Math.PI * 2);
    ctx.ellipse(r * 0.15, r * 0.18, r * 0.08, r * 0.11, 0, 0, Math.PI * 2);
    ctx.fill();

    // Глаза
    const eyeY = -r * 0.28;
    const eyeX = r * 0.33;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(-eyeX, eyeY, r * 0.26, 0, Math.PI * 2);
    ctx.arc(eyeX, eyeY, r * 0.26, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#1b1b1b';
    ctx.beginPath();
    ctx.arc(-eyeX + r * 0.05, eyeY, r * 0.12, 0, Math.PI * 2);
    ctx.arc(eyeX + r * 0.05, eyeY, r * 0.12, 0, Math.PI * 2);
    ctx.fill();

    // Корона для короля и каска для бронированной
    if (this.kind === 'king') {
      ctx.fillStyle = '#ffd33a';
      ctx.strokeStyle = '#a8801a';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(-r * 0.6, -r * 0.85);
      ctx.lineTo(-r * 0.38, -r * 1.28);
      ctx.lineTo(-r * 0.12, -r * 0.95);
      ctx.lineTo(r * 0.12, -r * 1.35);
      ctx.lineTo(r * 0.38, -r * 0.95);
      ctx.lineTo(r * 0.6, -r * 1.25);
      ctx.lineTo(r * 0.62, -r * 0.8);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    } else if (this.kind === 'helmet') {
      ctx.fillStyle = '#b9c2cb';
      ctx.strokeStyle = '#6c757d';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, -r * 0.18, r * 1.02, Math.PI * 1.08, Math.PI * 1.92);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }

    // Белая вспышка в момент удара
    if (this.hurtFlash > 0.02) {
      ctx.globalAlpha = this.hurtFlash * 0.65;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    ctx.restore();
  }

}

/* =============================================================================
   ПТИЦА — снаряд игрока
   ============================================================================= */
class Bird extends Entity {
  constructor(x, y, type) {
    const spec = CONFIG.birds[type];

    const body = Matter.Bodies.circle(x, y, spec.radius, {
      density: spec.density,
      friction: spec.friction,
      restitution: spec.restitution,
      frictionAir: CONFIG.world.airFriction,   // см. пояснение в config.js
      label: 'bird'
    });

    /* Пока птица на рогатке, её тело делается статичным (см. slingshot.js).
       Так она висит в воздухе и не падает. При выстреле статичность снимается. */
    super(body, 100);

    this.type = type;
    this.spec = spec;
    this.radius = spec.radius;
    this.launched = false;     // уже выстрелили?
    this.abilityUsed = false;  // способность одноразовая
    this.restTimer = 0;        // сколько времени птица почти не двигается
    this.lifeTimer = 0;        // сколько всего живёт после выстрела

    /* УГОЛ ДЛЯ КАРТИНКИ, ОТДЕЛЬНЫЙ ОТ ФИЗИЧЕСКОГО
       Тело птицы — круг. Кругу всё равно, как он повёрнут: на столкновения это
       не влияет никак. Значит, поворот картинки можно считать самим, как
       удобнее для вида.

       В присланной записи настоящей игры видно: птица в полёте НЕ кувыркается,
       а всегда смотрит туда, куда летит. А на оттянутой рогатке она развёрнута
       назад, вдоль резинки. Ровно это здесь и воспроизводится. */
    this.visualAngle = 0;
    this.impactTimer = 0;      // сколько ещё показывать лицо удара, в мс
  }

  /* ---------------------------------------------------------------------------
     СОСТОЯНИЕ ЛИЦА
     Возвращает не номер кадра, а РОЛЬ. Номера кадров живут в js/sprites.js.
     Благодаря этому можно перенарезать спрайт-лист, и здесь ничего не менять.
     --------------------------------------------------------------------------- */
  animState() {
    if (this.impactTimer > 0) return 'impact';

    if (!this.launched) {
      // На рогатке: спокойное лицо, но при сильном натяжении птица злится
      const dx = this.x - CONFIG.slingshot.x;
      const dy = this.y - CONFIG.slingshot.y;
      const pull = Math.sqrt(dx * dx + dy * dy);
      return pull > CONFIG.slingshot.maxPull * 0.3 ? 'aim' : 'idle';
    }

    // Отлетала своё и лежит на земле — показываем помятую
    if (this.restTimer > 450) return 'dazed';
    return 'fly';
  }

  update(dt) {
    if (this.impactTimer > 0) this.impactTimer -= dt;

    if (this.launched) {
      const v = this.body.velocity;
      const speed = Math.sqrt(v.x * v.x + v.y * v.y);

      if (speed > 1.2) {
        /* atan2(y, x) даёт угол вектора скорости. Именно atan2, а не atan:
           обычный atan не различает направления «вправо-вверх» и «влево-вниз»,
           потому что не знает знаков по отдельности. atan2 знает и возвращает
           правильный угол во всех четырёх четвертях. */
        this.visualAngle = Math.atan2(v.y, v.x);
        this.restTimer = 0;
      } else {
        this.restTimer += dt;
      }
    } else {
      // На рогатке смотрим вдоль резинки, то есть назад от развилки
      const dx = this.x - CONFIG.slingshot.x;
      const dy = this.y - CONFIG.slingshot.y;
      this.visualAngle = (dx * dx + dy * dy) > 30 ? Math.atan2(dy, dx) : 0;
    }
  }

  // Вызывается игрой, когда птица во что-то врезалась
  registerHit() {
    this.impactTimer = 300;
  }

  /* ---------------------------------------------------------------------------
     СПОСОБНОСТЬ ПО ТАПУ
     Возвращает описание того, что произошло, чтобы игра могла отреагировать
     (например, создать три новые птицы или взрыв).
     --------------------------------------------------------------------------- */
  useAbility() {
    if (!this.launched || this.abilityUsed || !this.alive) return null;
    this.abilityUsed = true;

    const v = this.body.velocity;

    switch (this.spec.ability) {
      case 'dash': {
        /* Рывок: умножаем текущую скорость. Направление не меняем — птица
           ускоряется именно туда, куда уже летела. */
        const k = CONFIG.abilities.dashMultiplier;
        Matter.Body.setVelocity(this.body, { x: v.x * k, y: v.y * k });
        return { kind: 'dash' };
      }

      case 'split': {
        /* Деление: возвращаем углы, под которыми разлетятся копии.
           Поворот вектора скорости на угол a делается формулой поворота:
             x' = x*cos(a) - y*sin(a)
             y' = x*sin(a) + y*cos(a)
           Это обычная тригонометрия, и она пригодится тебе ещё сто раз. */
        return { kind: 'split', velocity: { x: v.x, y: v.y }, spread: CONFIG.abilities.splitSpread };
      }

      case 'bomb': {
        return { kind: 'bomb', x: this.x, y: this.y };
      }

      case 'egg': {
        /* Белая птица роняет яйцо ВНИЗ, а сама отскакивает вперёд-вверх.
           Это прямое следствие закона сохранения импульса: оттолкнув что-то
           вниз, сама получаешь толчок вверх. В игре это ещё и удобно —
           птица уходит из зоны собственного взрыва. */
        return { kind: 'egg', x: this.x, y: this.y, velocity: { x: v.x, y: v.y } };
      }

      default:
        return null;
    }
  }

  draw(ctx) {
    // Сначала пробуем нарисовать настоящий спрайт нужного выражения лица
    const set = Assets.set('bird_' + this.type);
    if (set) {
      const frame = set.roles[this.animState()];
      if (frame !== undefined &&
          Assets.drawFrame(ctx, 'bird_' + this.type, frame,
                           this.x, this.y, this.radius * 2, this.visualAngle)) {
        return;
      }
    }

    // Спрайтов нет — рисуем птицу кодом, как раньше
    const r = this.radius;
    const s = this.spec;

    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.angle);

    // Хвостовые перья
    ctx.fillStyle = s.edge;
    ctx.beginPath();
    ctx.moveTo(-r * 0.75, -r * 0.35);
    ctx.lineTo(-r * 1.5, -r * 0.75);
    ctx.lineTo(-r * 1.35, 0);
    ctx.lineTo(-r * 1.5, r * 0.7);
    ctx.lineTo(-r * 0.75, r * 0.35);
    ctx.closePath();
    ctx.fill();

    // Тело
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fillStyle = s.color;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = s.edge;
    ctx.stroke();

    // Светлое брюшко
    ctx.beginPath();
    ctx.ellipse(r * 0.1, r * 0.45, r * 0.5, r * 0.34, 0, 0, Math.PI * 2);
    ctx.fillStyle = s.belly;
    ctx.fill();

    // Глаза
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(r * 0.18, -r * 0.3, r * 0.3, 0, Math.PI * 2);
    ctx.arc(r * 0.62, -r * 0.28, r * 0.24, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#141414';
    ctx.beginPath();
    ctx.arc(r * 0.26, -r * 0.3, r * 0.13, 0, Math.PI * 2);
    ctx.arc(r * 0.66, -r * 0.28, r * 0.11, 0, Math.PI * 2);
    ctx.fill();

    // Злые брови — из-за них птица и выглядит сердитой
    ctx.strokeStyle = '#141414';
    ctx.lineWidth = Math.max(2, r * 0.16);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-r * 0.08, -r * 0.72);
    ctx.lineTo(r * 0.42, -r * 0.46);
    ctx.moveTo(r * 0.5, -r * 0.62);
    ctx.lineTo(r * 0.84, -r * 0.46);
    ctx.stroke();

    // Клюв
    ctx.fillStyle = '#f5a623';
    ctx.strokeStyle = '#b8761a';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(r * 0.72, -r * 0.02);
    ctx.lineTo(r * 1.42, r * 0.16);
    ctx.lineTo(r * 0.72, r * 0.38);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Значок неиспользованной способности: маленькая искра над птицей
    if (this.launched && !this.abilityUsed && this.spec.ability !== 'none') {
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.beginPath();
      ctx.arc(0, -r * 1.7, r * 0.18, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }
}
