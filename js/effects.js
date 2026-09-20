/* =============================================================================
   effects.js — ЧАСТИЦЫ И ВИЗУАЛЬНЫЕ ЭФФЕКТЫ
   -----------------------------------------------------------------------------
   Обломки, пыль, взрывы и всплывающие очки НЕ участвуют в физике Matter.js.
   И это сделано специально.

   Почему? Если каждую щепку сделать настоящим физическим телом, движку придётся
   проверять её столкновения со всеми остальными телами. Сто щепок — и игра
   начнёт тормозить, хотя игрок этой разницы даже не заметит.

   Поэтому у частиц СВОЯ упрощённая физика, в три строки:
       скорость += гравитация
       позиция  += скорость
       жизнь    -= время
   Ни с чем не сталкиваются, просто летят и гаснут. Это стандартный компромисс
   в геймдеве: честно считаем только то, что влияет на игру.
   ============================================================================= */

const Effects = {

  particles: [],
  popups: [],      // всплывающие надписи с очками

  /* Обломки при разрушении блока. Разлетаются во все стороны:
     угол берём случайный от 0 до 2*PI (полный круг), скорость тоже случайную. */
  debris(x, y, color, count = 10, power = 5) {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = power * (0.4 + Math.random() * 0.9);
      this.particles.push({
        x, y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - power * 0.5,   // небольшой подброс вверх
        size: 2 + Math.random() * 5,
        life: 1,
        decay: 0.012 + Math.random() * 0.016,
        color,
        spin: (Math.random() - 0.5) * 0.4,
        angle: 0,
        shape: 'rect'
      });
    }
  },

  // Облачко пыли: медленное, полупрозрачное, расширяется
  dust(x, y, count = 6) {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      this.particles.push({
        x, y,
        vx: Math.cos(angle) * (0.6 + Math.random()),
        vy: Math.sin(angle) * (0.6 + Math.random()) - 0.6,
        size: 8 + Math.random() * 14,
        life: 1,
        decay: 0.02,
        color: 'rgba(210,195,170,0.55)',
        spin: 0, angle: 0,
        shape: 'circle',
        grow: 0.35,
        gravity: 0.02
      });
    }
  },

  // Взрыв: яркие быстрые искры
  explosion(x, y, radius) {
    for (let i = 0; i < 34; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = (radius / 14) * (0.5 + Math.random());
      this.particles.push({
        x, y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        size: 3 + Math.random() * 7,
        life: 1,
        decay: 0.022 + Math.random() * 0.02,
        color: i % 3 === 0 ? '#ffd23f' : (i % 3 === 1 ? '#ff7b24' : '#ff3b30'),
        spin: 0, angle: 0,
        shape: 'circle',
        gravity: 0.05
      });
    }
    this.particles.push({
      x, y, vx: 0, vy: 0,
      size: radius * 0.35, life: 1, decay: 0.07,
      color: 'rgba(255,220,120,0.6)',
      spin: 0, angle: 0, shape: 'circle', grow: radius * 0.09, gravity: 0
    });
  },

  // Перья, когда свинья лопается
  pop(x, y, color) {
    this.debris(x, y, color, 16, 7);
    this.dust(x, y, 5);
  },

  scorePopup(x, y, text) {
    this.popups.push({ x, y, text, life: 1 });
  },

  /* ---------------------------------------------------------------------------
     ОБНОВЛЕНИЕ
     Идём по массиву С КОНЦА. Это важный приём: мы удаляем элементы прямо во
     время перебора. Если идти с начала, то после splice все следующие элементы
     сдвинутся влево, и один из них мы пропустим. При обходе с конца сдвиг
     затрагивает только уже пройденные элементы, и проблемы нет.
     --------------------------------------------------------------------------- */
  update() {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];

      p.vy += (p.gravity !== undefined ? p.gravity : 0.22);
      p.vx *= 0.99;
      p.x += p.vx;
      p.y += p.vy;
      p.angle += p.spin;
      p.life -= p.decay;
      if (p.grow) p.size += p.grow;

      // Отскок от земли, чтобы обломки не проваливались
      if (p.y > CONFIG.ground.y && p.vy > 0) {
        p.y = CONFIG.ground.y;
        p.vy *= -0.32;
        p.vx *= 0.7;
      }

      if (p.life <= 0) this.particles.splice(i, 1);
    }

    for (let i = this.popups.length - 1; i >= 0; i--) {
      const s = this.popups[i];
      s.y -= 0.9;
      s.life -= 0.014;
      if (s.life <= 0) this.popups.splice(i, 1);
    }
  },

  draw(ctx) {
    for (const p of this.particles) {
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.fillStyle = p.color;

      if (p.shape === 'circle') {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size / 2, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.angle);
        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
        ctx.restore();
      }
    }
    ctx.globalAlpha = 1;

    ctx.textAlign = 'center';
    ctx.font = 'bold 26px "Trebuchet MS", sans-serif';
    for (const s of this.popups) {
      ctx.globalAlpha = Math.max(0, s.life);
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(0,0,0,0.55)';
      ctx.strokeText(s.text, s.x, s.y);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(s.text, s.x, s.y);
    }
    ctx.globalAlpha = 1;
  },

  clear() {
    this.particles.length = 0;
    this.popups.length = 0;
  }
};
