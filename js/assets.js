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
    bird_red:    'assets/birds/red.png',
    bird_yellow: 'assets/birds/yellow.png',
    bird_blue:   'assets/birds/blue.png',
    bird_black:  'assets/birds/black.png',

    pig_small:   'assets/pigs/small.png',
    pig_normal:  'assets/pigs/normal.png',
    pig_king:    'assets/pigs/king.png',
    pig_helmet:  'assets/pigs/helmet.png',

    block_wood:  'assets/blocks/wood.png',
    block_stone: 'assets/blocks/stone.png',
    block_ice:   'assets/blocks/ice.png',
    block_tnt:   'assets/blocks/tnt.png',

    slingshot:   'assets/slingshot.png',
    background:  'assets/background.png'
  },

  images: {},      // сюда попадут успешно загруженные картинки
  missing: [],     // а сюда имена тех, которых не нашлось
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
    const names = Object.keys(this.manifest);
    let pending = names.length;

    if (pending === 0) { this.ready = true; onReady(); return; }

    const finish = () => {
      pending--;
      if (pending === 0) {
        this.ready = true;
        if (this.missing.length) {
          console.info(
            '[assets] Нет файлов: ' + this.missing.join(', ') +
            '. Рисую их кодом. Это нормально, пока ассеты не добавлены.'
          );
        }
        onReady();
      }
    };

    for (const name of names) {
      const img = new Image();
      img.onload  = () => { this.images[name] = img; finish(); };
      img.onerror = () => { this.missing.push(name); finish(); };
      img.src = this.manifest[name];
    }
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
