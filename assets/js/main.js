/* ESH•SETKO — интерактив сайта. Без библиотек. */
(() => {
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const finePointer = matchMedia('(hover: hover) and (pointer: fine)').matches;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

  /* ---------- Прелоадер: счётчик 0 → 100 ---------- */
  const plCount = $('.pl-count');
  if (plCount && document.documentElement.classList.contains('preload')) {
    const t0 = performance.now();
    const tick = (t) => {
      const p = clamp((t - t0) / 2000, 0, 1);
      plCount.textContent = String(Math.round(p * 100)).padStart(3, '0');
      if (p < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    setTimeout(() => document.documentElement.classList.remove('preload'), 3200);
  }

  /* ---------- Шторка при переходе на другую страницу ---------- */
  const curtain = $('.curtain');
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a');
    if (!a || !curtain || reduced) return;
    const href = a.getAttribute('href') || '';
    if (a.target === '_blank' || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    if (!/\.html(#.*)?$/.test(href) || href.startsWith('http')) return;
    if (a.pathname === location.pathname) return;
    e.preventDefault();
    try { sessionStorage.setItem('nav', '1'); } catch (_) {}
    curtain.classList.add('cover');
    setTimeout(() => { location.href = a.href; }, 600);
  });
  addEventListener('pageshow', (e) => { if (e.persisted && curtain) curtain.classList.remove('cover'); });

  /* ---------- Шапка: фон после прокрутки, прячется при скролле вниз ---------- */
  const header = $('.site-header');
  let lastY = scrollY;
  addEventListener('scroll', () => {
    const y = scrollY;
    header.classList.toggle('scrolled', y > 30);
    header.classList.toggle('hide', y > lastY && y > 400 && !document.body.classList.contains('menu-open'));
    lastY = y;
  }, { passive: true });

  /* ---------- Мобильное меню ---------- */
  const menuBtn = $('.menu-btn');
  if (menuBtn) {
    menuBtn.addEventListener('click', () => {
      const open = document.body.classList.toggle('menu-open');
      menuBtn.setAttribute('aria-expanded', open);
    });
    $$('.mobile-menu a').forEach((a) => a.addEventListener('click', () => document.body.classList.remove('menu-open')));
  }

  /* ---------- Курсор ---------- */
  if (finePointer && !reduced) {
    const ring = $('.cursor'), dot = $('.cursor-dot'), label = $('.cursor span');
    let x = innerWidth / 2, y = innerHeight / 2, rx = x, ry = y;
    ring.classList.add('idle'); dot.classList.add('idle');
    addEventListener('mousemove', (e) => {
      if (ring.classList.contains('idle')) { rx = e.clientX; ry = e.clientY; ring.classList.remove('idle'); dot.classList.remove('idle'); }
      x = e.clientX; y = e.clientY; dot.style.transform = `translate(${x}px, ${y}px)`;
    });
    const loop = () => {
      rx += (x - rx) * .18; ry += (y - ry) * .18;
      ring.style.transform = `translate(${rx}px, ${ry}px)`;
      requestAnimationFrame(loop);
    };
    loop();
    document.addEventListener('mouseover', (e) => {
      const t = e.target.closest('[data-cursor]');
      ring.classList.toggle('big', !!t);
      dot.classList.toggle('hidden', !!t);
      if (t) label.textContent = t.dataset.cursor;
    });
    document.addEventListener('mouseleave', () => { ring.classList.add('hidden'); dot.classList.add('hidden'); });
    document.addEventListener('mouseenter', () => { ring.classList.remove('hidden'); dot.classList.remove('hidden'); });
  }

  /* ---------- Разбивка заголовков на буквы ---------- */
  $$('.split').forEach((el) => {
    let i = 0;
    const walk = (node) => {
      [...node.childNodes].forEach((n) => {
        if (n.nodeType === 3) {
          const frag = document.createDocumentFragment();
          n.textContent.split(/(\s+)/).forEach((word) => {
            if (!word) return;
            if (!word.trim()) { frag.append(' '); return; }
            const wd = document.createElement('span');
            wd.className = 'wd';
            [...word].forEach((c) => {
              const outer = document.createElement('span');
              outer.className = 'ch';
              const inner = document.createElement('span');
              inner.textContent = c;
              inner.style.setProperty('--i', i++);
              outer.append(inner);
              wd.append(outer);
            });
            frag.append(wd);
          });
          n.replaceWith(frag);
        } else if (n.nodeType === 1 && n.tagName !== 'BR') walk(n);
      });
    };
    walk(el);
  });

  /* ---------- Появление при прокрутке ---------- */
  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } });
  }, { threshold: .15, rootMargin: '0px 0px -5% 0px' });
  $$('.reveal, .split').forEach((el) => io.observe(el));

  /* ---------- Текст, который проявляется по словам ---------- */
  const scrubs = $$('.scrub-text').map((el) => {
    const words = [];
    const walk = (node) => {
      [...node.childNodes].forEach((n) => {
        if (n.nodeType === 3) {
          const frag = document.createDocumentFragment();
          n.textContent.split(/(\s+)/).forEach((part) => {
            if (!part.trim()) { frag.append(part); return; }
            const s = document.createElement('span');
            s.className = 'w'; s.textContent = part; words.push(s); frag.append(s);
          });
          n.replaceWith(frag);
        } else if (n.nodeType === 1) walk(n);
      });
    };
    walk(el);
    return { el, words };
  });

  /* ---------- Горизонтальная лента (на компьютере закреплена, на телефоне свайп) ---------- */
  const hs = $('.hscroll');
  const hsTrack = hs && $('.hs-track', hs);
  const hsBar = hs && $('.hs-progress i', hs);
  const pinQuery = matchMedia('(min-width: 900px) and (min-height: 600px) and (hover: hover)');
  const setupHs = () => {
    if (!hs) return;
    const pin = pinQuery.matches && !reduced;
    hs.classList.toggle('pinned', pin);
    hsTrack.style.transform = '';
    hs.style.height = pin ? `${hsTrack.scrollWidth - innerWidth + innerHeight}px` : '';
  };
  if (hs) {
    setupHs();
    addEventListener('resize', setupHs);
    addEventListener('load', setupHs);
    hsTrack.addEventListener('scroll', () => {
      if (!hs.classList.contains('pinned')) hsBar.style.width = `${hsTrack.scrollLeft / (hsTrack.scrollWidth - hsTrack.clientWidth) * 100}%`;
    }, { passive: true });
  }

  /* ---------- Параллакс ---------- */
  const parallax = $$('[data-speed]');

  const onScroll = () => {
    const vh = innerHeight;
    scrubs.forEach(({ el, words }) => {
      const r = el.getBoundingClientRect();
      const p = clamp((vh * .85 - r.top) / (r.height + vh * .35), 0, 1);
      const n = Math.round(p * words.length);
      words.forEach((w, i) => w.classList.toggle('on', i < n));
    });
    if (hs && hs.classList.contains('pinned')) {
      const r = hs.getBoundingClientRect();
      const p = clamp(-r.top / (hs.offsetHeight - vh), 0, 1);
      hsTrack.style.transform = `translate3d(${-p * (hsTrack.scrollWidth - innerWidth)}px, 0, 0)`;
      hsBar.style.width = `${p * 100}%`;
    }
    if (!reduced) parallax.forEach((el) => {
      const r = el.parentElement.getBoundingClientRect();
      const off = (r.top + r.height / 2 - vh / 2) * parseFloat(el.dataset.speed);
      el.style.transform = `translate3d(0, ${off}px, 0)`;
    });
  };
  addEventListener('scroll', onScroll, { passive: true });
  addEventListener('resize', onScroll);
  onScroll();

  /* ---------- Видоискатель: таймкод и фокус за мышью ---------- */
  const tc = $('[data-timecode]');
  if (tc) {
    const t0 = performance.now();
    const pad = (n) => String(n).padStart(2, '0');
    const step = () => {
      const s = (performance.now() - t0) / 1000;
      tc.textContent = `${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(Math.floor(s) % 60)}:${pad(Math.floor((s % 1) * 24))}`;
      requestAnimationFrame(step);
    };
    step();
  }
  const focus = $('.vf .focus');
  if (focus && finePointer && !reduced) {
    const hero = $('.hero');
    hero.addEventListener('mousemove', (e) => {
      const r = hero.getBoundingClientRect();
      focus.style.transform = `translate(${(e.clientX - r.width / 2) * .35}px, ${(e.clientY - r.top - r.height / 2) * .35}px)`;
    });
  }

  /* ---------- Плеер шоурила ---------- */
  const player = $('.player');
  if (player) {
    const frame = $('iframe', player);
    const open = () => {
      player.classList.add('open');
      if (frame && frame.dataset.src) frame.src = frame.dataset.src;
      const v = $('video', player); if (v) v.play().catch(() => {});
    };
    const close = () => {
      player.classList.remove('open');
      if (frame && frame.dataset.src) frame.src = 'about:blank';
      const v = $('video', player); if (v) v.pause();
    };
    $$('[data-open-player]').forEach((b) => b.addEventListener('click', open));
    $('.close', player).addEventListener('click', close);
    player.addEventListener('click', (e) => { if (e.target === player) close(); });
    addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  }

  /* ---------- Первый экран: слайдер проектов ---------- */
  const bgs = $$('.hs-bg'), infos = $$('.slide-info'), dotBtns = $$('.dots button'), reels = $$('.rs-item'), cnt = $('.counter .mono-big');
  if (bgs.length > 1) {
    let cur = 0, timer;
    const go = (i) => {
      cur = (i + bgs.length) % bgs.length;
      [bgs, infos, dotBtns, reels].forEach((list) => list.forEach((el, k) => el.classList.toggle('on', k === cur)));
      cnt.textContent = String(cur + 1).padStart(2, '0');
    };
    const auto = () => { clearInterval(timer); if (!reduced) timer = setInterval(() => go(cur + 1), 5500); };
    dotBtns.forEach((b, k) => b.addEventListener('click', () => { go(k); auto(); }));
    let sx = null;
    const card = $('.hero-card');
    card.addEventListener('touchstart', (e) => { sx = e.touches[0].clientX; }, { passive: true });
    card.addEventListener('touchend', (e) => {
      if (sx === null) return;
      const dx = e.changedTouches[0].clientX - sx;
      if (Math.abs(dx) > 50) { go(cur + (dx < 0 ? 1 : -1)); auto(); }
      sx = null;
    });
    auto();
  }

  /* ---------- Список мест: кадр летит за курсором ---------- */
  const ff = $('.float-frame');
  if (ff && finePointer) {
    let fx = 0, fy = 0, cx = 0, cy = 0, run = false;
    const follow = () => {
      cx += (fx - cx) * .15; cy += (fy - cy) * .15;
      ff.style.left = `${cx}px`; ff.style.top = `${cy}px`;
      if (run) requestAnimationFrame(follow);
    };
    $$('.places li a').forEach((a) => {
      a.addEventListener('mouseenter', (e) => {
        ff.className = `float-frame frame show ${a.dataset.scene}`;
        ff.style.background = a.dataset.img ? `url("${a.dataset.img}") center / cover` : '';
        if (!run) { cx = fx = e.clientX; cy = fy = e.clientY; run = true; follow(); }
      });
      a.addEventListener('mousemove', (e) => { fx = e.clientX; fy = e.clientY; });
      a.addEventListener('mouseleave', () => { ff.classList.remove('show'); run = false; });
    });
  }

  /* ---------- Работы: фильтры ---------- */
  const tiles = $$('.tile');
  const filterBtns = $$('.filters button');
  if (filterBtns.length) {
    filterBtns.forEach((b) => {
      const f = b.dataset.f;
      const sup = document.createElement('sup');
      sup.textContent = f === 'all' ? tiles.length : tiles.filter((t) => t.dataset.c === f).length;
      b.append(sup);
      b.addEventListener('click', () => {
        filterBtns.forEach((x) => x.classList.toggle('active', x === b));
        tiles.forEach((t, i) => {
          const show = f === 'all' || t.dataset.c === f;
          t.classList.toggle('out', !show);
          t.classList.remove('pop');
          if (show) { void t.offsetWidth; t.style.animationDelay = `${(i % 6) * 50}ms`; t.classList.add('pop'); }
        });
      });
    });
  }

  /* ---------- Лайтбокс ---------- */
  const lb = $('.lightbox');
  if (lb && tiles.length) {
    const stage = $('.lb-stage .frame', lb);
    const title = $('.lb-bottom h3', lb), cat = $('.lb-bottom .cat', lb), count = $('.lb-count', lb);
    let list = [], idx = 0;
    const show = (i) => {
      idx = (i + list.length) % list.length;
      const t = list[idx];
      const src = $('.frame', t);
      stage.className = `frame ${[...src.classList].filter((c) => c.startsWith('sc-')).join(' ')} r-${t.dataset.r || 'std'}`;
      stage.innerHTML = '';
      const media = $('img, video', src);
      if (media) stage.append(media.cloneNode(true));
      title.textContent = $('h3', t).textContent;
      const c = $('.cat', t);
      cat.textContent = c ? c.textContent : '';
      count.textContent = `${String(idx + 1).padStart(2, '0')} / ${String(list.length).padStart(2, '0')}`;
    };
    const open = (t) => {
      list = tiles.filter((x) => !x.classList.contains('out'));
      show(list.indexOf(t));
      lb.classList.add('open');
      document.body.style.overflow = 'hidden';
    };
    const close = () => { lb.classList.remove('open'); document.body.style.overflow = ''; };
    tiles.forEach((t) => t.addEventListener('click', () => open(t)));
    $('.lb-close', lb).addEventListener('click', close);
    $('.lb-prev', lb).addEventListener('click', () => show(idx - 1));
    $('.lb-next', lb).addEventListener('click', () => show(idx + 1));
    addEventListener('keydown', (e) => {
      if (!lb.classList.contains('open')) return;
      if (e.key === 'Escape') close();
      if (e.key === 'ArrowLeft') show(idx - 1);
      if (e.key === 'ArrowRight') show(idx + 1);
    });
    let sx = null;
    lb.addEventListener('touchstart', (e) => { sx = e.touches[0].clientX; }, { passive: true });
    lb.addEventListener('touchend', (e) => {
      if (sx === null) return;
      const dx = e.changedTouches[0].clientX - sx;
      if (Math.abs(dx) > 50) show(idx + (dx < 0 ? 1 : -1));
      sx = null;
    });
  }

  /* ---------- AI: слайдер «до / после» ---------- */
  $$('.ba').forEach((ba) => {
    const input = $('input', ba);
    input.addEventListener('input', () => ba.style.setProperty('--pos', `${input.value}%`));
  });

  /* ---------- AI: наклон карточек ---------- */
  if (finePointer && !reduced) {
    $$('.ai-card').forEach((c) => {
      c.addEventListener('mousemove', (e) => {
        const r = c.getBoundingClientRect();
        const px = (e.clientX - r.left) / r.width - .5, py = (e.clientY - r.top) / r.height - .5;
        c.style.transform = `rotateY(${px * 12}deg) rotateX(${-py * 12}deg)`;
      });
      c.addEventListener('mouseleave', () => { c.style.transform = ''; });
    });
  }

  /* ---------- Бриф: собираем заявку в текст ---------- */
  const form = $('#brief');
  if (form) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const d = new FormData(form);
      const what = d.getAll('what').join(', ') || '—';
      const text = `Привет! Меня зовут ${d.get('name') || '—'}.\nХочу: ${what}.\nКогда и где: ${d.get('when') || '—'}.\n${d.get('msg') || ''}`.trim();
      const note = $('.form-note', form);
      const email = form.dataset.email;
      if (email) {
        location.href = `mailto:${email}?subject=${encodeURIComponent('Заявка на съёмку')}&body=${encodeURIComponent(text)}`;
        return;
      }
      const done = () => { note.textContent = 'Текст заявки скопирован. Вставь его в директ: открываю Instagram.'; note.classList.add('ok'); setTimeout(() => window.open('https://ig.me/m/esh_setko', '_blank', 'noopener'), 900); };
      if (navigator.clipboard) navigator.clipboard.writeText(text).then(done, () => { note.textContent = text; });
      else note.textContent = text;
    });
  }

  /* ---------- Год в подвале ---------- */
  $$('[data-year]').forEach((el) => { el.textContent = new Date().getFullYear(); });
})();
