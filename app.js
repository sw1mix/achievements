/* Слой представления: рендер сетки, диаграмм и обработка ввода.
   Вся расчётная логика — в core.js. */
(function (core) {
  const STORAGE_KEY = 'achievements.v1';
  const THEME_KEY = 'achievements.theme';
  const PREFS_KEY = 'achievements.prefs';
  const SVG_NS = 'http://www.w3.org/2000/svg';

  const {
    PALETTE, ICONS, DAY_NAMES, DAY_LETTERS, MONTHS_GEN, MONTHS_SHORT, RHYTHM_WEEKS,
    iso, addDays, weekday, isWeekend, startOfWeek, sameDay,
    periodDays, shiftPeriod, normalizeAnchor, formatPeriod,
    sanitizeName, createHabit, initialState, migrate,
    isDone, setDone, removeHabit,
    dayCount, periodStats, streak, percent, plural,
    weekdayTotals, weeklyTotals, yearGrid,
  } = core;

  const el = {
    grid: document.getElementById('grid'),
    charts: document.getElementById('charts'),
    summary: document.getElementById('summary-line'),
    periodRange: document.getElementById('period-range'),
    periodSub: document.getElementById('period-sub'),
    addForm: document.getElementById('add-form'),
    addInput: document.getElementById('add-input'),
    importFile: document.getElementById('import-file'),
    modeButtons: Array.from(document.querySelectorAll('.segmented__btn')),
    rose: document.getElementById('weekday-rose'),
    weekBars: document.getElementById('week-bars'),
    heatmap: document.getElementById('heatmap'),
    yearLabel: document.getElementById('year-label'),
    popover: document.getElementById('popover'),
    themeBtn: document.getElementById('theme-btn'),
  };

  let state = loadState();
  let prefs = loadPrefs();
  let anchor = normalizeAnchor(prefs.mode, new Date());
  let year = prefs.year;

  /* --- Хранилище --- */

  function loadState() {
    try {
      const migrated = migrate(JSON.parse(localStorage.getItem(STORAGE_KEY)));
      if (migrated) return migrated;
    } catch (e) { /* повреждённые данные — начинаем заново */ }
    return initialState();
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      console.warn('Не удалось сохранить данные:', e);
    }
  }

  function loadPrefs() {
    const fallback = { mode: 'week', year: new Date().getFullYear() };
    try {
      const raw = JSON.parse(localStorage.getItem(PREFS_KEY));
      return {
        mode: raw && raw.mode === 'month' ? 'month' : fallback.mode,
        year: raw && Number.isInteger(raw.year) ? raw.year : fallback.year,
      };
    } catch (e) {
      return fallback;
    }
  }

  function savePrefs() {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({ mode: prefs.mode, year }));
    } catch (e) { /* приватный режим — просто не запоминаем */ }
  }

  /* --- Хелперы разметки --- */

  function node(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function svgNode(tag, attrs = {}) {
    const element = document.createElementNS(SVG_NS, tag);
    Object.entries(attrs).forEach(([key, value]) => element.setAttribute(key, value));
    return element;
  }

  /* --- Рендер --- */

  function render() {
    renderModeSwitch();
    renderPeriodLabel();
    renderGrid();
    renderStats();
    renderRhythm();
    renderYear();
  }

  // Панели статистики зависят только от отметок — при клике по чекбоксу сетку не пересобираем.
  function renderStats() {
    renderCharts();
    renderSummary();
  }

  function renderModeSwitch() {
    el.modeButtons.forEach((button) => {
      const active = button.dataset.mode === prefs.mode;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    });
  }

  function renderPeriodLabel() {
    const { range, sub } = formatPeriod(prefs.mode, anchor);
    el.periodRange.textContent = range;
    el.periodSub.textContent = sub;
  }

  function renderGrid() {
    const days = periodDays(prefs.mode, anchor);
    const today = iso(new Date());
    const month = prefs.mode === 'month';

    el.grid.textContent = '';
    el.grid.classList.toggle('grid--month', month);
    el.grid.style.setProperty('--days', days.length);

    const head = node('div', 'grid__row');
    head.append(node('div', 'cell cell--head'));

    days.forEach((day) => {
      const cell = node('div', 'cell cell--head'
        + (isWeekend(day) ? ' cell--weekend' : '')
        + (iso(day) === today ? ' cell--today' : ''));
      cell.append(
        node('span', null, month ? DAY_LETTERS[weekday(day)] : DAY_NAMES[weekday(day)]),
        node('span', 'day-num', day.getDate()),
      );
      head.append(cell);
    });

    head.append(node('div', 'cell cell--head', 'Итог'));
    el.grid.append(head);

    if (!state.habits.length) {
      el.grid.append(node('div', 'empty', 'Пока нет ни одного достижения. Добавьте первое ниже.'));
      return;
    }

    state.habits.forEach((habit) => {
      el.grid.append(habitRow(habit, days, today));
    });
  }

  function habitRow(habit, days, today) {
    const row = node('div', 'grid__row');
    const nameCell = node('div', 'cell cell--name');

    const badge = node('button', 'habit-badge');
    badge.type = 'button';
    badge.title = 'Цвет, иконка, удаление';
    badge.setAttribute('aria-label', `Настроить «${habit.name}»`);
    paintBadge(badge, habit);
    badge.addEventListener('click', () => openPopover(badge, habit));

    const nameInput = node('input', 'habit-name');
    nameInput.value = habit.name;
    nameInput.maxLength = core.MAX_NAME;
    nameInput.setAttribute('aria-label', 'Название достижения');
    nameInput.addEventListener('change', () => {
      habit.name = sanitizeName(nameInput.value, habit.name);
      nameInput.value = habit.name;
      badge.setAttribute('aria-label', `Настроить «${habit.name}»`);
      saveState();
      renderStats();
    });
    nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') nameInput.blur(); });

    nameCell.append(badge, nameInput);
    row.append(nameCell);

    const totalCell = node('div', 'cell cell--total');

    days.forEach((day) => {
      const cell = node('div', 'cell'
        + (isWeekend(day) ? ' cell--weekend' : '')
        + (iso(day) === today ? ' cell--today' : ''));

      const box = node('input', 'check');
      box.type = 'checkbox';
      box.style.setProperty('--habit-color', habit.color);
      box.checked = isDone(state, habit.id, day);
      box.setAttribute('aria-label', `${habit.name}, ${day.getDate()} ${MONTHS_GEN[day.getMonth()]}`);
      box.addEventListener('change', () => {
        setDone(state, habit.id, day, box.checked);
        saveState();
        updateTotal(habit, totalCell, days);
        renderStats();
        renderRhythm();
        renderYear();
      });

      cell.append(box);
      row.append(cell);
    });

    updateTotal(habit, totalCell, days);
    row.append(totalCell);
    return row;
  }

  function paintBadge(badge, habit) {
    badge.textContent = '';
    if (habit.icon) {
      badge.style.background = `${habit.color}1f`;
      badge.append(node('span', null, habit.icon));
      return;
    }
    badge.style.background = 'transparent';
    const dot = node('span', 'habit-badge__dot');
    dot.style.background = habit.color;
    badge.append(dot);
  }

  function updateTotal(habit, cell, days) {
    const done = days.filter((day) => isDone(state, habit.id, day)).length;
    cell.textContent = `${done}/${days.length}`;
  }

  /* --- Диаграммы периода --- */

  function renderCharts() {
    const days = periodDays(prefs.mode, anchor);
    el.charts.textContent = '';
    if (!state.habits.length) return;

    const { perHabit, total, possible } = periodStats(state, days);

    el.charts.append(donutCard({
      value: total,
      max: possible,
      color: 'var(--accent)',
      label: prefs.mode === 'month' ? 'Всего за месяц' : 'Всего за неделю',
      sub: `${total} из ${possible} отметок`,
      size: 148,
      large: true,
    }));

    perHabit.forEach(({ habit, done }) => {
      el.charts.append(donutCard({
        value: done,
        max: days.length,
        color: habit.color,
        label: habit.name,
        icon: habit.icon,
        sub: `${done} из ${days.length} ${plural(days.length, 'дня', 'дней', 'дней')}`,
        size: 104,
      }));
    });
  }

  function renderSummary() {
    const days = periodDays(prefs.mode, anchor);
    if (!state.habits.length) {
      el.summary.textContent = '';
      return;
    }

    const { total, possible, bestDay } = periodStats(state, days);
    const parts = [`${percent(total, possible)}% ${prefs.mode === 'month' ? 'месяца' : 'недели'}`];

    if (bestDay) {
      const label = prefs.mode === 'month'
        ? `${bestDay.day.getDate()} ${MONTHS_GEN[bestDay.day.getMonth()]}`
        : DAY_NAMES[weekday(bestDay.day)];
      parts.push(`лучший день — ${label} (${bestDay.count})`);
    }

    const streakDays = streak(state);
    if (streakDays > 0) parts.push(`серия — ${streakDays} ${plural(streakDays, 'день', 'дня', 'дней')}`);

    el.summary.textContent = parts.join(' · ');
  }

  function donutCard({ value, max, color, label, icon, sub, size, large }) {
    const card = node('div', 'chart' + (large ? ' chart--main' : ''));

    const width = large ? 10 : 8;
    const radius = size / 2 - width;
    const circumference = 2 * Math.PI * radius;
    const ratio = max ? value / max : 0;

    const svg = svgNode('svg', {
      viewBox: `0 0 ${size} ${size}`,
      width: size,
      height: size,
      role: 'img',
      'aria-label': `${label}: ${percent(value, max)}%`,
    });

    svg.append(
      svgNode('circle', {
        cx: size / 2, cy: size / 2, r: radius, fill: 'none',
        'stroke-width': width, class: 'donut__track',
      }),
      svgNode('circle', {
        cx: size / 2, cy: size / 2, r: radius, fill: 'none',
        'stroke-width': width, class: 'donut__value', stroke: color,
        'stroke-dasharray': circumference,
        'stroke-dashoffset': circumference * (1 - ratio),
        transform: `rotate(-90 ${size / 2} ${size / 2})`,
      }),
    );

    const text = svgNode('text', {
      x: size / 2, y: size / 2,
      'text-anchor': 'middle',
      'dominant-baseline': 'central',
      class: 'donut__text' + (large ? ' donut__text--lg' : ''),
    });
    text.textContent = `${percent(value, max)}%`;
    svg.append(text);

    const title = node('div', 'chart__label');
    title.title = label;
    if (icon) title.append(node('span', null, icon));
    title.append(node('span', null, label));

    card.append(svg, title, node('div', 'chart__sub', sub));
    return card;
  }

  /* --- Ритм: роза по дням недели и столбцы по неделям --- */

  function renderRhythm() {
    renderRose();
    renderWeekBars();
  }

  function renderRose() {
    const totals = weekdayTotals(state, { weeks: RHYTHM_WEEKS });
    const max = Math.max(...totals, 1);
    const size = 168;
    const center = size / 2;
    const maxRadius = center - 20;
    const step = (Math.PI * 2) / 7;
    const gap = 0.03;

    const svg = svgNode('svg', {
      viewBox: `0 0 ${size} ${size}`,
      width: size,
      height: size,
      role: 'img',
      'aria-label': 'Распределение отметок по дням недели',
    });

    [0.5, 1].forEach((fraction) => {
      svg.append(svgNode('circle', {
        cx: center, cy: center, r: maxRadius * fraction, class: 'rose__grid',
      }));
    });

    totals.forEach((value, index) => {
      const start = -Math.PI / 2 + index * step + gap;
      const end = start + step - gap * 2;
      // Радиус по корню, чтобы площадь сектора была пропорциональна числу отметок.
      const radius = maxRadius * Math.sqrt(value / max);

      if (radius > 0.5) {
        const x1 = center + radius * Math.cos(start);
        const y1 = center + radius * Math.sin(start);
        const x2 = center + radius * Math.cos(end);
        const y2 = center + radius * Math.sin(end);

        const sector = svgNode('path', {
          d: `M ${center} ${center} L ${x1.toFixed(2)} ${y1.toFixed(2)} `
            + `A ${radius.toFixed(2)} ${radius.toFixed(2)} 0 0 1 ${x2.toFixed(2)} ${y2.toFixed(2)} Z`,
          class: 'rose__sector',
          fill: 'var(--accent)',
          'fill-opacity': 0.82,
        });
        const tooltip = svgNode('title');
        tooltip.textContent = `${DAY_NAMES[index]}: ${value} ${plural(value, 'отметка', 'отметки', 'отметок')}`;
        sector.append(tooltip);
        svg.append(sector);
      }

      const middle = start + (step - gap * 2) / 2;
      const label = svgNode('text', {
        x: (center + (maxRadius + 12) * Math.cos(middle)).toFixed(2),
        y: (center + (maxRadius + 12) * Math.sin(middle)).toFixed(2),
        'text-anchor': 'middle',
        'dominant-baseline': 'central',
        class: 'rose__label',
      });
      label.textContent = DAY_NAMES[index];
      svg.append(label);
    });

    el.rose.textContent = '';
    el.rose.append(svg);
  }

  function renderWeekBars() {
    const weeks = weeklyTotals(state, { weeks: RHYTHM_WEEKS });
    const max = Math.max(...weeks.map((week) => week.count), 1);

    el.weekBars.textContent = '';

    weeks.forEach((week) => {
      const bar = node('div', 'bar' + (week.isCurrent ? ' is-current' : ''));
      bar.title = `${week.start.getDate()} ${MONTHS_GEN[week.start.getMonth()]}`
        + ` — ${week.count} ${plural(week.count, 'отметка', 'отметки', 'отметок')}`;

      const fill = node('div', 'bar__fill');
      fill.style.height = `${(week.count / max) * 100}%`;
      fill.style.opacity = week.isCurrent ? '1' : '0.55';

      bar.append(fill, node('div', 'bar__tick', week.start.getDate()));
      el.weekBars.append(bar);
    });
  }

  /* --- Год --- */

  function renderYear() {
    const { columns, labels, activeDays } = yearGrid(state, year);

    el.yearLabel.textContent = year;
    el.heatmap.textContent = '';

    const months = node('div', 'heatmap__months');
    labels.forEach((label) => months.append(node('div', 'heatmap__month', label)));

    const body = node('div', 'heatmap__body');
    columns.forEach((column) => {
      const week = node('div', 'heatmap__week');
      column.days.forEach((day) => {
        if (!day.inYear) {
          week.append(node('span', 'hm-cell hm-cell--empty'));
          return;
        }
        const cell = node('span', 'hm-cell');
        cell.dataset.level = day.level;
        cell.title = `${day.date.getDate()} ${MONTHS_GEN[day.date.getMonth()]}`
          + `: ${day.count} ${plural(day.count, 'отметка', 'отметки', 'отметок')}`;
        if (day.isFuture) cell.classList.add('hm-cell--future');
        if (day.isToday) cell.classList.add('hm-cell--today');
        week.append(cell);
      });
      body.append(week);
    });

    el.heatmap.append(months, body);
    el.yearLabel.title = `${activeDays} ${plural(activeDays, 'активный день', 'активных дня', 'активных дней')} в ${year}`;
  }

  /* --- Поповер настройки достижения --- */

  let popoverHabit = null;

  function openPopover(anchorEl, habit) {
    if (popoverHabit === habit.id) {
      closePopover();
      return;
    }
    popoverHabit = habit.id;
    el.popover.textContent = '';

    const colors = node('div', 'popover__group');
    colors.append(node('div', 'popover__title', 'Цвет'));
    const swatches = node('div', 'swatches');
    PALETTE.forEach((color) => {
      const swatch = node('button', 'swatch' + (habit.color === color ? ' is-active' : ''));
      swatch.type = 'button';
      swatch.style.background = color;
      swatch.setAttribute('aria-label', `Цвет ${color}`);
      swatch.addEventListener('click', () => {
        habit.color = color;
        saveState();
        closePopover();
        render();
      });
      swatches.append(swatch);
    });
    colors.append(swatches);

    const iconGroup = node('div', 'popover__group');
    iconGroup.append(node('div', 'popover__title', 'Иконка'));
    const icons = node('div', 'icons');
    ICONS.forEach((icon) => {
      const button = node('button', 'icon-btn' + (habit.icon === icon ? ' is-active' : ''), icon || '•');
      button.type = 'button';
      button.setAttribute('aria-label', icon ? `Иконка ${icon}` : 'Без иконки');
      button.addEventListener('click', () => {
        habit.icon = icon;
        saveState();
        closePopover();
        render();
      });
      icons.append(button);
    });
    iconGroup.append(icons);

    const remove = node('button', 'popover__delete', 'Удалить достижение');
    remove.type = 'button';
    remove.addEventListener('click', () => {
      closePopover();
      if (!confirm(`Удалить «${habit.name}» вместе с отметками?`)) return;
      removeHabit(state, habit.id);
      saveState();
      render();
    });

    el.popover.append(colors, iconGroup, remove);
    el.popover.hidden = false;
    placePopover(anchorEl);
  }

  function placePopover(anchorEl) {
    const rect = anchorEl.getBoundingClientRect();
    const width = el.popover.offsetWidth;
    const left = Math.min(
      Math.max(8, rect.left + window.scrollX),
      window.scrollX + document.documentElement.clientWidth - width - 8,
    );
    el.popover.style.left = `${left}px`;
    el.popover.style.top = `${rect.bottom + window.scrollY + 6}px`;
  }

  function closePopover() {
    popoverHabit = null;
    el.popover.hidden = true;
    el.popover.textContent = '';
  }

  document.addEventListener('click', (e) => {
    if (!popoverHabit) return;
    const target = e.target instanceof Element ? e.target : null;
    if (target && (el.popover.contains(target) || target.closest('.habit-badge'))) return;
    closePopover();
  });

  window.addEventListener('resize', closePopover);

  /* --- Управление --- */

  el.addForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = sanitizeName(el.addInput.value);
    if (!name) return;
    state.habits.push(createHabit(name, state.habits.length));
    el.addInput.value = '';
    saveState();
    render();
  });

  el.modeButtons.forEach((button) => {
    button.addEventListener('click', () => setMode(button.dataset.mode));
  });

  function setMode(mode) {
    if (mode !== 'week' && mode !== 'month') return;
    // Если сегодня видно в текущем периоде, после смены режима остаёмся на сегодняшнем дне.
    const showsToday = periodDays(prefs.mode, anchor).some((day) => sameDay(day, new Date()));
    prefs.mode = mode;
    anchor = normalizeAnchor(mode, showsToday ? new Date() : anchor);
    savePrefs();
    render();
  }

  function movePeriod(direction) {
    anchor = shiftPeriod(prefs.mode, anchor, direction);
    closePopover();
    render();
  }

  function goToday() {
    anchor = normalizeAnchor(prefs.mode, new Date());
    year = new Date().getFullYear();
    savePrefs();
    render();
  }

  function moveYear(direction) {
    year += direction;
    savePrefs();
    renderYear();
  }

  document.getElementById('prev-period').addEventListener('click', () => movePeriod(-1));
  document.getElementById('next-period').addEventListener('click', () => movePeriod(1));
  document.getElementById('today-btn').addEventListener('click', goToday);
  document.getElementById('prev-year').addEventListener('click', () => moveYear(-1));
  document.getElementById('next-year').addEventListener('click', () => moveYear(1));

  function isTextField(target) {
    return target instanceof Element && target.matches('input, textarea');
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { closePopover(); return; }
    if (isTextField(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;

    const key = e.key.toLowerCase();
    if (e.key === 'ArrowLeft') movePeriod(-1);
    else if (e.key === 'ArrowRight') movePeriod(1);
    else if (key === 't' || key === 'е') goToday();
    else if (key === 'w' || key === 'ц') setMode('week');
    else if (key === 'm' || key === 'ь') setMode('month');
  });

  document.getElementById('export-btn').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `achievements-${iso(new Date())}.json`;
    link.click();
    URL.revokeObjectURL(link.href);
  });

  document.getElementById('import-btn').addEventListener('click', () => el.importFile.click());

  el.importFile.addEventListener('change', async () => {
    const file = el.importFile.files[0];
    if (!file) return;
    try {
      const imported = migrate(JSON.parse(await file.text()));
      if (!imported) throw new Error('bad format');
      state = imported;
      saveState();
      render();
    } catch (e) {
      alert('Не удалось прочитать файл: нужен JSON, полученный через «Экспорт».');
    }
    el.importFile.value = '';
  });

  /* --- Тема --- */

  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    el.themeBtn.textContent = theme === 'dark' ? '☀' : '☾';
    el.themeBtn.setAttribute('aria-pressed', String(theme === 'dark'));
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch (e) { /* приватный режим */ }
  }

  el.themeBtn.addEventListener('click', () => {
    applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
  });

  let storedTheme = null;
  try {
    storedTheme = localStorage.getItem(THEME_KEY);
  } catch (e) { /* приватный режим */ }

  applyTheme(storedTheme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));

  // Данные могли измениться в другой вкладке — подхватываем без перезагрузки.
  window.addEventListener('storage', (e) => {
    if (e.key !== STORAGE_KEY) return;
    state = loadState();
    render();
  });

  render();
})(window.AchievementsCore);
