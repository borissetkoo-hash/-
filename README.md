# ESH•SETKO

Личный сайт Анечки Сетко: видео и AI-контент.

Страницы: `index.html` (главная), `works.html` (работы), `ai.html` (AI), `about.html` (обо мне), `contact.html` (контакты).
Общие стили лежат в `assets/css/style.css`, интерактив в `assets/js/main.js`. Сборка не нужна: достаточно открыть `index.html` в браузере.

## Как заменить заглушки на настоящие фото и видео

Каждый кадр на сайте — это блок `<div class="frame sc-…">`. Сейчас вместо картинок там цветные сцены в палитре ленты.
Положите файл в `assets/media/` и вставьте его внутрь блока:

```html
<div class="frame sc-sunset"><img src="assets/media/egypt-sunset.jpg" alt="Закат в Египте"></div>
<div class="frame sc-pool"><video src="assets/media/pool.mp4" autoplay muted loop playsinline></video></div>
```

Шоурил на главной вставляется так же: внутрь `.hero .frame` и внутрь `.player .screen`.
