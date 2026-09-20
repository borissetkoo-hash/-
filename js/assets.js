/* =============================================================================
   assets.js — ЗАГРУЗЧИК КАРТИНОК С ЗАПАСНЫМ ВАРИАНТОМ
   -----------------------------------------------------------------------------
   Твоих ассетов пока нет, а играть хочется уже сейчас. Поэтому загрузчик
   устроен так, чтобы отсутствие файла НЕ ЛОМАЛО игру:

     файл есть  -> рисуем спрайт
     файла нет  -> рисуем ту же сущность кодом (кружок с глазами и клювом)

   Такой приём называется graceful degradation, "мягкая деградация": программа
   теряет красоту, но продолжает работать. Когда ты пришлёшь ассеты, я просто
   положу их по путям из manifest ниже, и картинки появятся сами. Менять
   остальной код не придётся вообще.
   ============================================================================= */

const Assets = {

  /* Карта "имя в коде" -> "путь к файлу".
     Единственное место, где живут пути. Захотим переименовать файл — правим
     только здесь. */
  manifest: {
    /* Птицы и свиньи сюда больше не входят: они рисуются НАБОРАМИ КАДРОВ,
       которые описаны в js/sprites.js и грузятся ниже. Здесь остались только
       одиночные картинки, у которых нет анимации. */
    block_wood:  'assets/blocks/wood.png',
    block_stone: 'assets/blocks/stone.png',
    block_ice:   'assets/blocks/ice.png',
    block_tnt:   'assets/blocks/tnt.png',

    /* Рогатка состоит из двух картинок. Между ними в игре оказывается птица:
       ствол с дальней веткой рисуется ПЕРЕД птицей, ближняя ветка ПОСЛЕ неё.
       Именно поэтому художник и отдал её двумя кусками, а не одним. */
    slingshot_back:  'assets/props/slingshot_back.png',
    slingshot_front: 'assets/props/slingshot_front.png',
    background:      'assets/background.png'
  },

  images: {},      // одиночные картинки
  sets: {},        // наборы кадров: имя -> { frames: [Image], size, bodyFraction, roles }
  missing: [],     // имена того, чего не нашлось
  ready: false,

  /* ---------------------------------------------------------------------------
     ЗАГРУЗКА
     ---------------------------------------------------------------------------
     Картинки грузятся АСИНХРОННО: строка new Image() выполняется мгновенно, а
     сам файл прилетает по сети потом. Поэтому нельзя просто написать загрузку
     подряд и сразу рисовать — картинок ещё не будет.

     Считаем счётчиком: каждая картинка при завершении (успех ИЛИ ошибка)
     уменьшает счётчик. Когда он дошёл до нуля — значит все ответили, можно
     стартовать игру. Обрати внимание: ошибку мы тоже считаем завершением,
     иначе игра зависла бы навсегда из-за одного ненайденного файла. */
  load(onReady) {
    /* Собираем ОДИН общий список задач: и одиночные картинки, и все кадры
       всех наборов. Считаем их одним счётчиком, иначе пришлось бы городить
       вложенные проверки «а все ли кадры птицы догрузились, а свиньи». */
    const jobs = [];

    for (const name of Object.keys(this.manifest)) {
      jobs.push({ kind: 'single', name, url: this.manifest[name] });
    }

    if (typeof SPRITES !== 'undefined') {
      for (const setName of Object.keys(SPRITES)) {
        const spec = SPRITES[setName];
        this.sets[setName] = {
          frames: new Array(spec.frames.length).fill(null),
          size: spec.size,
          bodyFraction: spec.bodyFraction,
          roles: spec.roles,
          loaded: 0
        };
        spec.frames.forEach((file, index) => {
          jobs.push({ kind: 'frame', set: setName, index, name: setName + '[' + index + ']', url: spec.dir + file });
        });
      }
    }

    let pending = jobs.length;
    if (pending === 0) { this.ready = true; onReady(); return; }

    const finish = () => {
      pending--;
      if (pending === 0) {
        this.ready = true;

        // Набор считается готовым, только если догрузились ВСЕ его кадры.
        // Половина кадров хуже, чем ноль: анимация будет мигать дырами.
        for (const name of Object.keys(this.sets)) {
          const set = this.sets[name];
          if (set.loaded < set.frames.length) {
            console.warn('[assets] Набор ' + name + ': загружено ' + set.loaded +
                         ' из ' + set.frames.length + ' кадров, рисую кодом.');
            delete this.sets[name];
          }
        }

        const ready = Object.keys(this.sets);
        if (ready.length) console.info('[assets] Наборы кадров готовы: ' + ready.join(', '));
        if (this.missing.length) {
          console.info('[assets] Нет файлов: ' + this.missing.join(', ') +
                       '. Эти объекты рисую кодом.');
        }
        onReady();
      }
    };

    for (const job of jobs) {
      const img = new Image();
      img.onload = () => {
        if (job.kind === 'single') {
          this.images[job.name] = img;
        } else {
          this.sets[job.set].frames[job.index] = img;
          this.sets[job.set].loaded++;
        }
        finish();
      };
      img.onerror = () => { this.missing.push(job.name); finish(); };
      img.src = job.url;
    }
  },

  /* Вернуть набор кадров или null, если его нет. */
  set(name) {
    return this.sets[name] || null;
  },

  /* ---------------------------------------------------------------------------
     НАРИСОВАТЬ КАДР НАБОРА
     ---------------------------------------------------------------------------
     bodySize это диаметр ФИЗИЧЕСКОГО тела. А картинка шире: у птицы за тело
     торчат хвост и клюв, у свиньи уши. Поэтому реальный размер отрисовки
     считается так:

         размер_картинки = диаметр_тела / bodyFraction

     где bodyFraction посчитан при нарезке и говорит, какую долю кадра занимает
     само туловище. Без этого деления птица рисовалась бы заметно меньше своего
     физического тела и визуально «проваливалась» бы в доски. */
  drawFrame(ctx, setName, frameIndex, x, y, bodySize, angle) {
    const set = this.sets[setName];
    if (!set) return false;

    const img = set.frames[frameIndex];
    if (!img) return false;

    const size = bodySize / set.bodyFraction;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle || 0);
    ctx.drawImage(img, -size / 2, -size / 2, size, size);
    ctx.restore();
    return true;
  },

  /* Вернуть картинку или null. Весь код рисования спрашивает через get()
     и сам решает, что делать при null. */
  get(name) {
    return this.images[name] || null;
  },

  has(name) {
    return !!this.images[name];
  },

  /* ---------------------------------------------------------------------------
     ВСПОМОГАТЕЛЬНАЯ ОТРИСОВКА СПРАЙТА
     ---------------------------------------------------------------------------
     Рисует картинку с центром в точке (x, y), повёрнутую на angle радиан и
     вписанную в размер width x height.

     Почему save/restore: методы translate и rotate меняют систему координат
     ВСЕГО холста, а не одной картинки. Если не вернуть всё обратно, следующий
     объект нарисуется криво. save() запоминает состояние, restore() его
     возвращает. Правило простое: сделал save — обязательно сделай restore. */
  drawSprite(ctx, name, x, y, width, height, angle) {
    const img = this.get(name);
    if (!img) return false;

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle || 0);
    ctx.drawImage(img, -width / 2, -height / 2, width, height);
    ctx.restore();
    return true;
  }
};
