/* =============================================================================
   tools/check-levels.js — ПРОВЕРКА ГЕОМЕТРИИ УРОВНЕЙ
   -----------------------------------------------------------------------------
   Зачем это нужно.

   Физический движок считает, что тела в момент старта НЕ ПЕРЕСЕКАЮТСЯ. Если две
   доски пересекаются хотя бы на пару пикселей, движок обязан их растолкать, и
   делает он это резко. Со стороны выглядит как "конструкция сама взорвалась".
   Искать такое глазами по координатам — мучение.

   Поэтому здесь автоматическая проверка. Она находит:
     1. пересечения тел при старте,
     2. тела, висящие в воздухе без опоры.

   Запуск:  node tools/check-levels.js

   Это называется линтер или валидатор данных. Очень полезная привычка: если
   данные можно проверить программой, проверяй программой, а не глазами.
   ============================================================================= */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

// Загружаем config.js и levels.js так, как это сделал бы браузер
const root = path.join(__dirname, '..');
const ctx = {};
vm.createContext(ctx);
/* Хвостик "this.CONFIG = CONFIG" обязателен. Причина тонкая, но важная:
   const на верхнем уровне скрипта НЕ создаёт свойство глобального объекта.
   В браузере это неважно, там все скрипты делят общую область видимости.
   А здесь каждый файл запускается отдельно, и без этой строки Node просто
   не увидит CONFIG из следующего файла. */
vm.runInContext(
  fs.readFileSync(path.join(root, 'js/config.js'), 'utf8') + '\nthis.CONFIG = CONFIG;',
  ctx
);
vm.runInContext(
  fs.readFileSync(path.join(root, 'js/levels.js'), 'utf8') + '\nthis.LEVELS = LEVELS;',
  ctx
);
const { CONFIG, LEVELS } = ctx;

/* --- ГЕОМЕТРИЯ ------------------------------------------------------------ */

// Четыре угла прямоугольника с учётом поворота
function corners(b) {
  const hw = b.w / 2, hh = b.h / 2;
  const a = b.angle || 0;
  const cos = Math.cos(a), sin = Math.sin(a);
  return [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([x, y]) => ({
    x: b.x + x * cos - y * sin,
    y: b.y + x * sin + y * cos
  }));
}

function project(poly, axis) {
  let min = Infinity, max = -Infinity;
  for (const p of poly) {
    const d = p.x * axis.x + p.y * axis.y;
    if (d < min) min = d;
    if (d > max) max = d;
  }
  return [min, max];
}

/* Теорема о разделяющей оси (SAT).
   Идея простая и красивая: два выпуклых многоугольника НЕ пересекаются тогда и
   только тогда, когда существует прямая, которая их разделяет. Достаточно
   проверить прямые, параллельные сторонам фигур. Если по какой-то оси их
   проекции не перекрываются — фигуры точно не касаются. */
function polyOverlap(A, B) {
  let min = Infinity;
  for (const poly of [A, B]) {
    for (let i = 0; i < poly.length; i++) {
      const p1 = poly[i], p2 = poly[(i + 1) % poly.length];
      let ax = -(p2.y - p1.y), ay = p2.x - p1.x;
      const len = Math.hypot(ax, ay) || 1;
      const axis = { x: ax / len, y: ay / len };
      const [minA, maxA] = project(A, axis);
      const [minB, maxB] = project(B, axis);
      const o = Math.min(maxA, maxB) - Math.max(minA, minB);
      if (o <= 0) return 0;              // нашли разделяющую ось — не пересекаются
      if (o < min) min = o;
    }
  }
  return min;
}

function circleRectOverlap(c, rect) {
  const poly = corners(rect);
  const a = rect.angle || 0;
  // Переводим центр круга в систему координат прямоугольника
  const dx = c.x - rect.x, dy = c.y - rect.y;
  const lx =  dx * Math.cos(-a) - dy * Math.sin(-a);
  const ly =  dx * Math.sin(-a) + dy * Math.cos(-a);
  const hw = rect.w / 2, hh = rect.h / 2;
  const nx = Math.max(-hw, Math.min(hw, lx));
  const ny = Math.max(-hh, Math.min(hh, ly));
  const dist = Math.hypot(lx - nx, ly - ny);
  if (dist === 0) return c.radius;       // центр внутри прямоугольника
  return Math.max(0, c.radius - dist);
}

function circleCircleOverlap(a, b) {
  const d = Math.hypot(a.x - b.x, a.y - b.y);
  return Math.max(0, a.radius + b.radius - d);
}

function bottomOf(b) { return Math.max(...corners(b).map(p => p.y)); }
function topOf(b)    { return Math.min(...corners(b).map(p => p.y)); }
function leftOf(b)   { return Math.min(...corners(b).map(p => p.x)); }
function rightOf(b)  { return Math.max(...corners(b).map(p => p.x)); }

/* --- ПРОВЕРКА ------------------------------------------------------------- */

const EPS = 0.6;        // пересечение меньше этого считаем погрешностью
const GAP = 8;          // допустимый зазор до опоры

let problems = 0;

for (let li = 0; li < LEVELS.length; li++) {
  const level = LEVELS[li];
  console.log('\n=== Уровень ' + (li + 1) + ': ' + level.name + ' ===');
  console.log('    блоков: ' + level.blocks.length + ', свиней: ' + level.pigs.length);

  const blocks = level.blocks;
  const pigs = level.pigs;
  let levelProblems = 0;

  // 1. Блок с блоком
  for (let i = 0; i < blocks.length; i++) {
    for (let j = i + 1; j < blocks.length; j++) {
      const o = polyOverlap(corners(blocks[i]), corners(blocks[j]));
      if (o > EPS) {
        console.log('  ПЕРЕСЕЧЕНИЕ блоков #' + i + ' и #' + j +
          ' на ' + o.toFixed(1) + ' px  (' + blocks[i].material + ' в ' +
          Math.round(blocks[i].x) + ',' + Math.round(blocks[i].y) + '  и  ' +
          blocks[j].material + ' в ' + Math.round(blocks[j].x) + ',' + Math.round(blocks[j].y) + ')');
        levelProblems++;
      }
    }
  }

  // 2. Свинья с блоком
  for (let i = 0; i < pigs.length; i++) {
    for (let j = 0; j < blocks.length; j++) {
      const o = circleRectOverlap(pigs[i], blocks[j]);
      if (o > EPS) {
        console.log('  ПЕРЕСЕЧЕНИЕ свиньи #' + i + ' (' + Math.round(pigs[i].x) + ',' +
          Math.round(pigs[i].y) + ') с блоком ' + blocks[j].material + ' в ' +
          Math.round(blocks[j].x) + ',' + Math.round(blocks[j].y) + ' на ' + o.toFixed(1) + ' px');
        levelProblems++;
      }
    }
  }

  // 3. Свинья со свиньёй
  for (let i = 0; i < pigs.length; i++) {
    for (let j = i + 1; j < pigs.length; j++) {
      const o = circleCircleOverlap(pigs[i], pigs[j]);
      if (o > EPS) {
        console.log('  ПЕРЕСЕЧЕНИЕ свиней #' + i + ' и #' + j + ' на ' + o.toFixed(1) + ' px');
        levelProblems++;
      }
    }
  }

  // 4. Висит ли тело в воздухе без опоры
  const all = blocks.map((b, i) => ({ ...b, tag: 'блок #' + i + ' (' + b.material + ')' }))
    .concat(pigs.map((p, i) => ({
      x: p.x, y: p.y, w: p.radius * 2, h: p.radius * 2, angle: 0,
      tag: 'свинья #' + i
    })));

  for (const item of all) {
    const bot = bottomOf(item);
    const l = leftOf(item), r = rightOf(item);

    let support = CONFIG.ground.y;    // земля это опора по умолчанию
    for (const other of all) {
      if (other === item) continue;
      if (rightOf(other) < l + 1 || leftOf(other) > r - 1) continue;  // не под нами
      const t = topOf(other);
      if (t >= bot - 1 && t < support) support = t;
    }

    const gap = support - bot;
    if (gap > GAP) {
      console.log('  ВИСИТ В ВОЗДУХЕ: ' + item.tag + ' в ' + Math.round(item.x) + ',' +
        Math.round(item.y) + ' — под ним пустота ' + Math.round(gap) + ' px');
      levelProblems++;
    }
  }

  if (levelProblems === 0) console.log('  чисто: пересечений и висящих тел нет');
  problems += levelProblems;
}

console.log('\n=====================================');
if (problems === 0) {
  console.log('ВСЕ УРОВНИ ГЕОМЕТРИЧЕСКИ КОРРЕКТНЫ');
  process.exit(0);
} else {
  console.log('НАЙДЕНО ПРОБЛЕМ: ' + problems);
  process.exit(1);
}
