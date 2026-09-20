/* =============================================================================
   js/sprites.js — СОЗДАН АВТОМАТИЧЕСКИ, РУКАМИ НЕ ПРАВИТЬ
   -----------------------------------------------------------------------------
   Файл генерирует tools/slice-sprites.py при нарезке спрайт-листов.
   Любая правка здесь потеряется при следующей нарезке: меняй ROLES в скрипте.

   Что означают поля:
     dir          — папка с кадрами
     frames       — имена файлов по порядку
     size         — сторона квадратного кадра в пикселях
     bodyFraction — какую долю кадра занимает туловище. Нужна, чтобы игра
                    масштабировала картинку так, чтобы туловище совпало с
                    физическим телом, а хвост и клюв торчали за его пределы
     roles        — какой кадр за какое состояние отвечает
   ============================================================================= */

const SPRITES = {
  "bird_red": {
    "frames": [
      "00.png",
      "01.png",
      "02.png",
      "03.png",
      "04.png",
      "05.png",
      "06.png",
      "07.png",
      "08.png",
      "09.png",
      "10.png"
    ],
    "size": 168,
    "bodyFraction": 0.6229,
    "dir": "assets/birds/red/",
    "roles": {
      "idle": 0,
      "aim": 5,
      "fly": 6,
      "impact": 7,
      "dazed": 8
    }
  },
  "bird_black": {
    "frames": [
      "00.png",
      "01.png",
      "02.png",
      "03.png",
      "04.png",
      "05.png",
      "06.png",
      "07.png",
      "08.png",
      "09.png",
      "10.png",
      "11.png"
    ],
    "size": 192,
    "bodyFraction": 0.5531,
    "dir": "assets/birds/black/",
    "roles": {
      "idle": 0,
      "aim": 5,
      "fly": 6,
      "impact": 10,
      "dazed": 11,
      "ignite": [
        7,
        8,
        9
      ]
    }
  },
  "bird_yellow": {
    "frames": [
      "00.png",
      "01.png",
      "02.png",
      "03.png",
      "04.png",
      "05.png",
      "06.png",
      "07.png",
      "08.png",
      "09.png",
      "10.png"
    ],
    "size": 186,
    "bodyFraction": 0.4866,
    "dir": "assets/birds/yellow/",
    "roles": {
      "idle": 0,
      "aim": 3,
      "fly": 6,
      "impact": 7,
      "dazed": 8
    }
  },
  "bird_blue": {
    "frames": [
      "00.png",
      "01.png",
      "02.png",
      "03.png",
      "04.png",
      "05.png",
      "06.png",
      "07.png",
      "08.png",
      "09.png",
      "10.png",
      "11.png"
    ],
    "size": 224,
    "bodyFraction": 0.6873,
    "dir": "assets/birds/blue/",
    "roles": {
      "idle": 1,
      "aim": 0,
      "fly": 6,
      "impact": 4,
      "dazed": 9
    }
  },
  "bird_white": {
    "frames": [
      "00.png",
      "01.png",
      "02.png",
      "03.png",
      "04.png",
      "05.png",
      "06.png",
      "07.png",
      "08.png",
      "09.png",
      "10.png"
    ],
    "size": 187,
    "bodyFraction": 0.5294,
    "dir": "assets/birds/white/",
    "roles": {
      "idle": 1,
      "aim": 0,
      "fly": 6,
      "impact": 4,
      "dazed": 8
    }
  },
  "pig_green": {
    "frames": [
      "00.png",
      "01.png",
      "02.png",
      "03.png",
      "04.png",
      "05.png",
      "06.png",
      "07.png",
      "08.png"
    ],
    "size": 121,
    "bodyFraction": 0.748,
    "dir": "assets/pigs/green/",
    "roles": {
      "stages": [
        [
          0,
          1,
          2
        ],
        [
          3,
          4,
          5
        ],
        [
          6,
          7,
          8
        ]
      ]
    }
  }
};
