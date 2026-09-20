#!/usr/bin/env python3
# =============================================================================
# tools/slice-sprites.py — НАРЕЗКА СПРАЙТ-ЛИСТОВ НА ОТДЕЛЬНЫЕ КАДРЫ
# -----------------------------------------------------------------------------
# Что такое спрайт-лист: одна картинка, на которой нарисовано много кадров
# подряд. Так делают, чтобы браузер скачал один файл вместо двадцати.
#
# Нам нужно обратное: разрезать лист на кадры. Наивный способ — поделить
# картинку на равные клетки — здесь не сработает: кадры на присланных листах
# стоят неровно, разного размера, в последнем ряду вообще один кадр.
#
# Поэтому применяется поиск СВЯЗНЫХ ОБЛАСТЕЙ (connected components). Идея:
#   1. считаем пиксель «своим», если он не фон,
#   2. берём любой такой пиксель и обходим всех его соседей вширь,
#      помечая как одну область (это поиск в ширину, BFS),
#   3. повторяем, пока непомеченные пиксели не кончатся.
# Каждая область — отдельный кадр. Его границы находятся сами, вручную ничего
# отмерять не нужно.
#
# Дальше кадры ВЫРАВНИВАЮТСЯ. Это важнее, чем кажется. Если просто обрезать
# каждый кадр по краям, то в кадре с широко открытым клювом птица окажется
# смещённой, и при смене кадров она будет дёргаться. Поэтому все кадры
# центрируются по центру масс ТУЛОВИЩА (самого распространённого цвета) и
# кладутся на общий квадратный холст одного размера.
#
# Запуск:  python3 tools/slice-sprites.py <лист_птицы.png> <лист_свиней.png>
# =============================================================================

import json
import os
import sys
import colorsys
from collections import deque, Counter

from PIL import Image

OUT_ROOT = os.path.join(os.path.dirname(__file__), '..', 'assets')
MIN_AREA = 120          # области мельче этого считаем мусором и выкидываем
ALPHA_MIN = 40          # пиксель считается непрозрачным начиная с этой альфы
COLOR_TOLERANCE = 70    # насколько цвет может отличаться, чтобы считаться «тем же»


# -----------------------------------------------------------------------------
# КАКОЙ КАДР ЗА ЧТО ОТВЕЧАЕТ
# -----------------------------------------------------------------------------
# Номера подобраны глазами по обзорным листам contact-*.png, которые делает
# этот же скрипт. Роли, а не номера, потому что номер — это деталь нарезки, а
# роль — это смысл. Если лист поменяется, править надо будет только здесь.
#
# Поведение подсмотрено в присланной записи настоящей игры:
#   на рогатке у птицы спокойное лицо, в полёте — злое с оскалом,
#   у свиньи по мере повреждений появляются синяки под глазами.
ROLES = {
    'bird_red': {
        'idle':   0,   # спокойная, сидит на рогатке
        'aim':    5,   # прицеливание, брови нахмурены
        'fly':    6,   # в полёте, оскал — самое злое лицо на листе
        'impact': 7,   # момент удара, глаза зажмурены
        'dazed':  8,   # приземлилась, синяк под глазом
    },
    'pig_green': {
        # Три стадии повреждений, в каждой: обычный кадр, моргание, реакция на удар
        'stages': [
            [0, 1, 2],   # целая
            [3, 4, 5],   # один синяк
            [6, 7, 8],   # оба глаза подбиты, язык наружу
        ]
    },
}


# -----------------------------------------------------------------------------
# ВАРИАНТЫ ОКРАСКИ ИЗ ОДНОГО ЛИСТА
# -----------------------------------------------------------------------------
# Прислан лист только красной птицы, а в игре их четыре. Рисовать остальных
# от руки нельзя: получится чужеродно рядом с настоящим ассетом.
#
# Поэтому жёлтая, синяя и чёрная делаются ИЗ ТОГО ЖЕ ЛИСТА перекраской. Так
# сохраняется и стиль, и все одиннадцать выражений лица.
#
# Перекрашиваются не все пиксели подряд, а только насыщенно-красные. Разбор по
# цветовому кругу (модель HSV):
#     тело        красное,  тон около 355 градусов, насыщенность высокая  -> красим
#     клюв        оранжевый, тон около 38 градусов                        -> не трогаем
#     брюшко      бежевое,  тон 38, но насыщенность низкая                -> не трогаем
#     глаза       белые,    насыщенность почти ноль                       -> не трогаем
#     обводка     чёрная,   яркость почти ноль                            -> не трогаем
# Без такого отбора у синей птицы позеленел бы клюв.
VARIANTS = {
    'yellow': {'hue': 0.13, 'sat': 1.00, 'val': 1.06},   # тон 47 градусов
    'blue':   {'hue': 0.55, 'sat': 0.92, 'val': 1.00},   # тон 198 градусов
    'black':  {'hue': 0.62, 'sat': 0.10, 'val': 0.30},   # почти чёрный
    'white':  {'hue': 0.11, 'sat': 0.09, 'val': 1.50},   # почти белый, тёплого оттенка
}


def recolor_frame(img, spec):
    """Перекрасить красные пиксели кадра, сохранив тени и блики.

    Важная деталь: новый тон задаётся жёстко, а ЯРКОСТЬ берётся исходная и лишь
    домножается. Благодаря этому светлые и тёмные места тела остаются светлыми и
    тёмными, то есть объём и тени никуда не деваются. Если бы мы просто залили
    тело одним цветом, птица превратилась бы в плоский кружок.
    """
    img = img.convert('RGBA')
    px = img.load()
    w, h = img.size

    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a < 8:
                continue

            hh, ss, vv = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
            degrees = hh * 360

            # Только насыщенный красный: тон у краёв круга, насыщенность высокая
            if ss < 0.5 or vv < 0.12:
                continue
            if not (degrees >= 330 or degrees <= 18):
                continue

            nr, ng, nb = colorsys.hsv_to_rgb(
                spec['hue'],
                min(1.0, ss * spec['sat']),
                min(1.0, vv * spec['val'])
            )
            px[x, y] = (int(nr * 255), int(ng * 255), int(nb * 255), a)

    return img


def make_variants(src_dir, info, out_root):
    """Создать цветные варианты птицы и вернуть описания наборов."""
    made = {}
    for name, spec in VARIANTS.items():
        out_dir = os.path.join(out_root, 'birds', name)
        os.makedirs(out_dir, exist_ok=True)
        for fname in info['frames']:
            src = Image.open(os.path.join(src_dir, fname))
            recolor_frame(src, spec).save(os.path.join(out_dir, fname))
        made['bird_' + name] = {
            'frames': list(info['frames']),
            'size': info['size'],
            'bodyFraction': info['bodyFraction'],
            'dir': 'assets/birds/' + name + '/',
            'roles': dict(info['roles']),
        }
        print('  вариант %-7s -> %s (%d кадров)' % (name, out_dir, len(info['frames'])))
    return made


def strip_white_background(img):
    """Сделать белый фон прозрачным, НЕ трогая белки глаз.

    Наивное «убрать все белые пиксели» испортило бы глаза: они тоже белые.
    Поэтому заливка идёт ОТ КРАЁВ картинки внутрь и останавливается на контуре
    персонажа. Белое, отрезанное чёрной обводкой, остаётся на месте.
    Это тот же алгоритм, что «заливка» в графическом редакторе.
    """
    img = img.convert('RGBA')
    w, h = img.size
    px = img.load()

    def is_white(p):
        return p[0] > 240 and p[1] > 240 and p[2] > 240

    seen = bytearray(w * h)
    queue = deque()

    for x in range(w):
        for y in (0, h - 1):
            if not seen[y * w + x] and is_white(px[x, y]):
                seen[y * w + x] = 1
                queue.append((x, y))
    for y in range(h):
        for x in (0, w - 1):
            if not seen[y * w + x] and is_white(px[x, y]):
                seen[y * w + x] = 1
                queue.append((x, y))

    while queue:
        x, y = queue.popleft()
        px[x, y] = (255, 255, 255, 0)
        for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
            if 0 <= nx < w and 0 <= ny < h and not seen[ny * w + nx] and is_white(px[nx, ny]):
                seen[ny * w + nx] = 1
                queue.append((nx, ny))

    return img


def find_components(img):
    """Найти связные области непрозрачных пикселей и вернуть их границы."""
    w, h = img.size
    px = img.load()
    seen = bytearray(w * h)
    boxes = []

    for sy in range(h):
        for sx in range(w):
            if seen[sy * w + sx] or px[sx, sy][3] < ALPHA_MIN:
                continue

            # Обход в ширину от стартового пикселя
            seen[sy * w + sx] = 1
            queue = deque([(sx, sy)])
            minx = maxx = sx
            miny = maxy = sy
            area = 0

            while queue:
                x, y = queue.popleft()
                area += 1
                if x < minx: minx = x
                if x > maxx: maxx = x
                if y < miny: miny = y
                if y > maxy: maxy = y

                for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
                    if 0 <= nx < w and 0 <= ny < h:
                        i = ny * w + nx
                        if not seen[i] and px[nx, ny][3] >= ALPHA_MIN:
                            seen[i] = 1
                            queue.append((nx, ny))

            if area >= MIN_AREA:
                boxes.append([minx, miny, maxx, maxy])

    return boxes


def merge_boxes(boxes):
    """Склеить рамки, которые относятся к одному персонажу.

    ПЕРВАЯ ВЕРСИЯ ЭТОЙ ФУНКЦИИ БЫЛА НЕПРАВИЛЬНОЙ, и это поучительно.
    Я склеивал рамки, расположенные ближе 6 пикселей друг к другу. На листе с
    птицами соседние птицы стоят почти вплотную, поэтому весь верхний ряд
    слипся в один «кадр» шириной 692 пикселя. Скрипт при этом не упал и ничего
    не сообщил: он честно сделал ровно то, что я написал.

    Правильная логика в два шага:
      1. склеиваем только рамки, которые РЕАЛЬНО пересекаются;
      2. отдельно цепляем мелкие детали (хохолок, перья хвоста), если они
         не касаются туловища ни одним пикселем. Мелкая деталь опознаётся по
         площади: она сильно меньше типичного кадра. Её отдаём ближайшему
         крупному кадру.

    Вывод на будущее: когда задаёшь порог «на глазок», всегда проверяй
    результат. Число 6 выглядело безобидно и испортило всю нарезку.
    """
    def area(b):
        return (b[2] - b[0]) * (b[3] - b[1])

    def overlaps(a, b):
        return a[0] <= b[2] and b[0] <= a[2] and a[1] <= b[3] and b[1] <= a[3]

    # Шаг 1: объединяем пересекающиеся
    changed = True
    while changed:
        changed = False
        for i in range(len(boxes)):
            for j in range(i + 1, len(boxes)):
                if overlaps(boxes[i], boxes[j]):
                    a, b = boxes[i], boxes[j]
                    boxes[i] = [min(a[0], b[0]), min(a[1], b[1]),
                                max(a[2], b[2]), max(a[3], b[3])]
                    boxes.pop(j)
                    changed = True
                    break
            if changed:
                break

    if len(boxes) < 2:
        return boxes

    # Шаг 2: мелочь прицепляем к ближайшему крупному кадру
    areas = sorted(area(b) for b in boxes)
    typical = areas[len(areas) // 2]
    big = [b for b in boxes if area(b) >= typical * 0.45]
    small = [b for b in boxes if area(b) < typical * 0.45]

    for sb in small:
        scx, scy = (sb[0] + sb[2]) / 2, (sb[1] + sb[3]) / 2
        best, best_d = None, None
        for bb in big:
            bcx, bcy = (bb[0] + bb[2]) / 2, (bb[1] + bb[3]) / 2
            d = abs(scx - bcx) + abs(scy - bcy)
            if best_d is None or d < best_d:
                best, best_d = bb, d
        if best is not None:
            best[0] = min(best[0], sb[0]); best[1] = min(best[1], sb[1])
            best[2] = max(best[2], sb[2]); best[3] = max(best[3], sb[3])

    return big


def sort_reading_order(boxes):
    """Отсортировать кадры так, как читают текст: слева направо, сверху вниз.

    Нельзя просто отсортировать по y: кадры в одном ряду стоят чуть на разной
    высоте, и порядок перемешается. Поэтому сначала кадры группируются в ряды
    по пересечению по вертикали, и уже внутри ряда сортируются по x.
    """
    rows = []
    for box in sorted(boxes, key=lambda b: b[1]):
        placed = False
        for row in rows:
            ref = row[0]
            overlap = min(ref[3], box[3]) - max(ref[1], box[1])
            if overlap > 0.4 * min(ref[3] - ref[1], box[3] - box[1]):
                row.append(box)
                placed = True
                break
        if not placed:
            rows.append([box])

    result = []
    for row in rows:
        result.extend(sorted(row, key=lambda b: b[0]))
    return result


def dominant_color(img, boxes):
    """Самый частый насыщенный цвет на листе — это цвет туловища.

    Определяется автоматически, а не задаётся вручную, чтобы скрипт одинаково
    работал и с красной птицей, и с зелёной свиньёй.
    """
    counter = Counter()
    px = img.load()
    for (x0, y0, x1, y1) in boxes:
        for y in range(y0, y1 + 1, 2):
            for x in range(x0, x1 + 1, 2):
                r, g, b, a = px[x, y]
                if a < 200:
                    continue
                mx, mn = max(r, g, b), min(r, g, b)
                if mx < 60 or mx - mn < 45:   # почти чёрный или почти серый
                    continue
                counter[(r // 12 * 12, g // 12 * 12, b // 12 * 12)] += 1
    return counter.most_common(1)[0][0]


def body_metrics(img, box, color):
    """Центр масс туловища и его радиус в пикселях."""
    px = img.load()
    x0, y0, x1, y1 = box
    sx = sy = n = 0
    for y in range(y0, y1 + 1):
        for x in range(x0, x1 + 1):
            r, g, b, a = px[x, y]
            if a < 200:
                continue
            d = abs(r - color[0]) + abs(g - color[1]) + abs(b - color[2])
            if d <= COLOR_TOLERANCE * 3:
                sx += x
                sy += y
                n += 1
    if n == 0:   # запасной вариант: центр рамки
        return ((x0 + x1) / 2, (y0 + y1) / 2, (x1 - x0) / 2)
    cx, cy = sx / n, sy / n
    radius = (n / 3.14159) ** 0.5        # площадь круга S = pi*r^2, отсюда r
    return (cx, cy, radius)


def slice_sheet(path, out_dir, name):
    print('\n=== ' + name + ' ===')
    img = Image.open(path).convert('RGBA')

    if img.getchannel('A').getextrema()[0] == 255:
        print('  фон непрозрачный, убираю белое заливкой от краёв')
        img = strip_white_background(img)

    boxes = merge_boxes(find_components(img))
    boxes = sort_reading_order(boxes)
    print('  найдено кадров: %d' % len(boxes))

    color = dominant_color(img, boxes)
    print('  цвет туловища: rgb%s' % (color,))

    metrics = [body_metrics(img, box, color) for box in boxes]
    radii = sorted(m[2] for m in metrics)
    body_r = radii[len(radii) // 2]        # медиана устойчивее среднего
    print('  радиус туловища: %.1f px' % body_r)

    # Холст должен вместить самый «размашистый» кадр относительно центра тела
    reach = 0
    for box, (cx, cy, _) in zip(boxes, metrics):
        reach = max(reach, cx - box[0], box[2] - cx, cy - box[1], box[3] - cy)
    canvas = int(reach * 2) + 8
    print('  размер кадра: %dx%d px' % (canvas, canvas))

    os.makedirs(out_dir, exist_ok=True)
    files = []
    for i, (box, (cx, cy, _)) in enumerate(zip(boxes, metrics)):
        frame = Image.new('RGBA', (canvas, canvas), (0, 0, 0, 0))
        part = img.crop((box[0], box[1], box[2] + 1, box[3] + 1))
        # Сдвиг такой, чтобы центр туловища оказался ровно в центре холста
        frame.paste(part, (int(canvas / 2 - (cx - box[0])),
                           int(canvas / 2 - (cy - box[1]))))
        fname = '%02d.png' % i
        frame.save(os.path.join(out_dir, fname))
        files.append(fname)
        print('    %s  рамка %s' % (fname, box))

    # Доля, которую занимает туловище в кадре. Игра по ней поймёт, насколько
    # увеличить картинку, чтобы туловище совпало с физическим телом.
    return {'frames': files, 'size': canvas, 'bodyFraction': round(body_r * 2 / canvas, 4)}


def contact_sheet(out_dir, info, path):
    """Собрать все кадры в один рядок с номерами — чтобы глазами выбрать,
    какой кадр за какое выражение лица отвечает."""
    from PIL import ImageDraw
    n = len(info['frames'])
    s = info['size']
    sheet = Image.new('RGBA', (s * n, s + 22), (255, 255, 255, 255))
    draw = ImageDraw.Draw(sheet)
    for i, f in enumerate(info['frames']):
        sheet.paste(Image.open(os.path.join(out_dir, f)), (i * s, 22), Image.open(os.path.join(out_dir, f)))
        draw.text((i * s + 6, 5), str(i), fill=(0, 0, 0, 255))
    sheet.save(path)
    print('  обзорный лист: %s' % path)


def write_sprites_js(result, path):
    """Записать манифест кадров в виде обычного JS-файла.

    Почему JS, а не JSON: JSON пришлось бы загружать запросом fetch, а это
    лишняя асинхронность и лишняя точка отказа. Обычный script-тег отдаёт
    готовый объект сразу, ещё до старта игры.
    """
    body = json.dumps(result, ensure_ascii=False, indent=2)
    text = (
        '/* =============================================================================\n'
        '   js/sprites.js — СОЗДАН АВТОМАТИЧЕСКИ, РУКАМИ НЕ ПРАВИТЬ\n'
        '   -----------------------------------------------------------------------------\n'
        '   Файл генерирует tools/slice-sprites.py при нарезке спрайт-листов.\n'
        '   Любая правка здесь потеряется при следующей нарезке: меняй ROLES в скрипте.\n'
        '\n'
        '   Что означают поля:\n'
        '     dir          — папка с кадрами\n'
        '     frames       — имена файлов по порядку\n'
        '     size         — сторона квадратного кадра в пикселях\n'
        '     bodyFraction — какую долю кадра занимает туловище. Нужна, чтобы игра\n'
        '                    масштабировала картинку так, чтобы туловище совпало с\n'
        '                    физическим телом, а хвост и клюв торчали за его пределы\n'
        '     roles        — какой кадр за какое состояние отвечает\n'
        '   ============================================================================= */\n\n'
        'const SPRITES = ' + body + ';\n'
    )
    with open(path, 'w', encoding='utf-8') as f:
        f.write(text)
    print('\nманифест записан: %s' % path)


if __name__ == '__main__':
    bird_sheet, pig_sheet = sys.argv[1], sys.argv[2]

    result = {}
    bird_dir = os.path.join(OUT_ROOT, 'birds', 'red')
    pig_dir = os.path.join(OUT_ROOT, 'pigs', 'green')

    result['bird_red'] = slice_sheet(bird_sheet, bird_dir, 'Красная птица')
    result['bird_red']['dir'] = 'assets/birds/red/'
    result['bird_red']['roles'] = ROLES['bird_red']
    contact_sheet(bird_dir, result['bird_red'], os.path.join(OUT_ROOT, '..', 'contact-birds.png'))

    print('\n=== Цветные варианты птицы из того же листа ===')
    result.update(make_variants(bird_dir, result['bird_red'], OUT_ROOT))

    result['pig_green'] = slice_sheet(pig_sheet, pig_dir, 'Свинья')
    result['pig_green']['dir'] = 'assets/pigs/green/'
    result['pig_green']['roles'] = ROLES['pig_green']
    contact_sheet(pig_dir, result['pig_green'], os.path.join(OUT_ROOT, '..', 'contact-pigs.png'))

    write_sprites_js(result, os.path.join(os.path.dirname(__file__), '..', 'js', 'sprites.js'))
