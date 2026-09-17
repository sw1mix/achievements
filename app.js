/* Слой представления: рендер сетки, диаграмм и обработка ввода.
   Вся расчётная логика — в core.js. */
(function (core) {
  const STORAGE_KEY = 'achievements.v1';
  const THEME_KEY = 'achievements.theme';
  const PREFS_KEY = 'achievements.prefs';
  const SVG_NS = 'http://www.w3.org/2000/svg';

  const {
    PALETTE, EMOJI, DAY_NAMES, DAY_LETTERS, MONTHS_GEN, RHYTHM_WEEKS, MAX_GOAL, DEFAULT_GOAL,
    iso, addDays, weekday, isWeekend, sameDay,
    periodDays, shiftPeriod, normalizeAnchor, formatPeriod,
    sanitizeName, autoBadge, emojiBadge, textBadge, clampGoal,
    createHabit, initialState, migrate,
    activeHabits, archivedHabits, isDone, setDone,
    archiveHabit, restoreHabit, removeHabit, reorderHabits, moveHabit,
    goalForDays, periodStats, streak, percent, plural,
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
    addBadge: document.getElementById('add-badge'),
    importFile: document.getElementById('import-file'),
    modeButtons: Array.from(document.querySelectorAll('.segmented__btn')),
    rose: document.getElementById('weekday-rose'),
    weekBars: document.getElementById('week-bars'),
    heatmap: document.getElementById('heatmap'),
    yearLabel: document.getElementById('year-label'),
    popover: document.getElementById('popover'),
    themeBtn: document.getElementById('theme-btn'),
    archivePanel: document.getElementById('archive-panel'),
    archiveList: document.getElementById('archive-list'),
    archiveCount: document.getElementById('archive-count'),
  };

  let state = loadState();
  let prefs = loadPrefs();
  let anchor = normalizeAnchor(prefs.mode, new Date());
  let year = prefs.year;

  // Значок и настройки будущего достижения: badge === null означает автоподбор по названию.
  let draft = { badge: null, color: null, goal: DEFAULT_GOAL };

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

  function button(className, text, onClick) {
    const element = node('button', className, text);
    element.type = 'button';
    if (onClick) element.addEventListener('click', onClick);
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
    renderArchive();
    renderDraftBadge();
  }

  // Панели статистики зависят только от отметок — при клике по чекбоксу сетку не пересобираем.
  function renderStats() {
    renderCharts();
    renderSummary();
  }

  function renderModeSwitch() {
    el.modeButtons.forEach((item) => {
      const active = item.dataset.mode === prefs.mode;
      item.classList.toggle('is-active', active);
      item.setAttribute('aria-pressed', String(active));
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
    const habits = activeHabits(state);

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

    head.append(node('div', 'cell cell--head', 'Цель'));
    el.grid.append(head);

    if (!habits.length) {
      el.grid.append(node('div', 'empty', archivedHabits(state).length
        ? 'Все достижения в архиве. Верните нужное ниже или добавьте новое.'
        : 'Пока нет ни одного достижения. Добавьте первое ниже.'));
      return;
    }

    habits.forEach((habit) => el.grid.append(habitRow(habit, days, today)));
  }

  function habitRow(habit, days, today) {
    const row = node('div', 'grid__row');
    const cells = [];
    const nameCell = node('div', 'cell cell--name');
    cells.push(nameCell);

    nameCell.append(dragHandle(habit, row, cells), habitBadge(habit), habitNameInput(habit));
    row.append(nameCell);

    const goalCell = node('div', 'cell cell--total');
    cells.push(goalCell);

    days.forEach((day) => {
      // Ячейка-подпись: нажатие в любой её точке переключает отметку — важно для касаний.
      const cell = node('label', 'cell'
        + (isWeekend(day) ? ' cell--weekend' : '')
        + (iso(day) === today ? ' cell--today' : ''));
      cells.push(cell);

      const box = node('input', 'check');
      box.type = 'checkbox';
      box.style.setProperty('--habit-color', habit.color);
      box.checked = isDone(state, habit.id, day);
      box.setAttribute('aria-label', `${habit.name}, ${day.getDate()} ${MONTHS_GEN[day.getMonth()]}`);
      box.addEventListener('change', () => {
        setDone(state, habit.id, day, box.checked);
        saveState();
        updateGoalCell(habit, goalCell, days);
        renderStats();
        renderRhythm();
        renderYear();
      });

      cell.append(box);
      row.append(cell);
    });

    updateGoalCell(habit, goalCell, days);
    row.append(goalCell);
    return row;
  }

  function habitNameInput(habit) {
    const input = node('input', 'habit-name');
    input.value = habit.name;
    input.maxLength = core.MAX_NAME;
    input.setAttribute('aria-label', 'Название достижения');
    input.addEventListener('change', () => {
      habit.name = sanitizeName(input.value, habit.name);
      input.value = habit.name;
      saveState();
      render();
    });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); });
    return input;
  }

  function habitBadge(habit) {
    const badge = button('habit-badge', null, () => openEditor(badge, habit));
    badge.title = 'Значок, цвет и цель';
    badge.setAttribute('aria-label', `Настроить «${habit.name}»`);
    paintBadge(badge, habit.badge, habit.color);
    return badge;
  }

  function paintBadge(element, badge, color) {
    element.textContent = '';
    element.style.background = `color-mix(in srgb, ${color} 14%, transparent)`;
    element.style.color = color;
    const value = node('span', badge.type === 'text' ? 'habit-badge__text' : null, badge.value);
    element.append(value);
  }

  function updateGoalCell(habit, cell, days) {
    const done = days.filter((day) => isDone(state, habit.id, day)).length;
    const goal = goalForDays(habit.goal, days.length);
    cell.textContent = `${done}/${goal}`;
    cell.classList.toggle('is-hit', done >= goal);
    cell.title = `${done} ${plural(done, 'отметка', 'отметки', 'отметок')}`
      + ` при цели ${goal} ${plural(goal, 'раз', 'раза', 'раз')}`
      + (prefs.mode === 'month' ? ' в месяц' : ' в неделю');
  }

  /* --- Перетаскивание --- */

  let dragId = null;

  function dragHandle(habit, row, cells) {
    const handle = node('span', 'habit-drag');
    handle.textContent = '⠿';
    handle.draggable = true;
    handle.tabIndex = 0;
    handle.setAttribute('role', 'button');
    handle.setAttribute('aria-label', `Переместить «${habit.name}»: стрелки вверх и вниз`);

    handle.addEventListener('dragstart', (e) => {
      dragId = habit.id;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', habit.id);
      cells.forEach((cell) => cell.classList.add('is-dragging'));
    });

    handle.addEventListener('dragend', () => {
      dragId = null;
      clearDropHints();
    });

    handle.addEventListener('keydown', (e) => {
      const direction = e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0;
      if (!direction) return;
      e.preventDefault();
      moveHabit(state, habit.id, direction);
      saveState();
      render();
      focusHandle(habit.id);
    });

    // Строка целиком становится зоной приёма, чтобы бросать было легко.
    cells.forEach((cell) => {
      cell.addEventListener('dragover', (e) => {
        if (!dragId || dragId === habit.id) return;
        e.preventDefault();
        const rect = cells[0].getBoundingClientRect();
        const after = e.clientY > rect.top + rect.height / 2;
        clearDropHints();
        cells.forEach((item) => item.classList.add(after ? 'is-drop-after' : 'is-drop-before'));
      });

      cell.addEventListener('drop', (e) => {
        if (!dragId || dragId === habit.id) return;
        e.preventDefault();
        const after = cells[0].classList.contains('is-drop-after');
        const moved = dragId;
        reorderHabits(state, moved, habit.id, after);
        saveState();
        dragId = null;
        render();
        focusHandle(moved);
      });
    });

    return handle;
  }

  function clearDropHints() {
    el.grid.querySelectorAll('.is-drop-before, .is-drop-after, .is-dragging')
      .forEach((cell) => cell.classList.remove('is-drop-before', 'is-drop-after', 'is-dragging'));
  }

  function focusHandle(habitId) {
    const index = activeHabits(state).findIndex((habit) => habit.id === habitId);
    if (index < 0) return;
    const handles = el.grid.querySelectorAll('.habit-drag');
    if (handles[index]) handles[index].focus();
  }

  /* --- Диаграммы периода --- */

  function renderCharts() {
    const days = periodDays(prefs.mode, anchor);
    el.charts.textContent = '';
    if (!activeHabits(state).length) return;

    const { perHabit, total, possible, marks } = periodStats(state, days);

    el.charts.append(donutCard({
      value: total,
      max: possible,
      color: 'var(--accent)',
      label: prefs.mode === 'month' ? 'Цели месяца' : 'Цели недели',
      sub: `${total} из ${possible} к цели`
        + (marks > total ? ` · ${marks - total} сверх` : ''),
      size: 148,
      large: true,
    }));

    perHabit.forEach(({ habit, done, goal, hit, extra }) => {
      el.charts.append(donutCard({
        value: Math.min(done, goal),
        max: goal,
        color: habit.color,
        label: habit.name,
        badge: habit.badge,
        sub: extra > 0 ? `${done} из ${goal} · +${extra}` : `${done} из ${goal}`,
        size: 104,
        hit,
      }));
    });
  }

  function renderSummary() {
    const days = periodDays(prefs.mode, anchor);
    if (!activeHabits(state).length) {
      el.summary.textContent = '';
      return;
    }

    const { total, possible, bestDay, hits, perHabit } = periodStats(state, days);
    const parts = [
      `${percent(total, possible)}% ${prefs.mode === 'month' ? 'месяца' : 'недели'}`,
      `цели: ${hits} из ${perHabit.length}`,
    ];

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

  function donutCard({ value, max, color, label, badge, sub, size, large, hit }) {
    const card = node('div', 'chart' + (large ? ' chart--main' : '') + (hit ? ' chart--hit' : ''));

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
    text.textContent = hit && !large ? '✓' : `${percent(value, max)}%`;
    svg.append(text);

    const title = node('div', 'chart__label');
    title.title = label;
    if (badge) {
      const mark = node('span', badge.type === 'text' ? 'chart__badge' : null, badge.value);
      if (badge.type === 'text') mark.style.color = color;
      title.append(mark);
    }
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
    const goal = weeks[0] ? weeks[0].goal : 0;
    const max = Math.max(...weeks.map((week) => week.count), goal, 1);

    el.weekBars.textContent = '';

    weeks.forEach((week) => {
      const bar = node('div', 'bar' + (week.isCurrent ? ' is-current' : ''));
      bar.title = `${week.start.getDate()} ${MONTHS_GEN[week.start.getMonth()]}`
        + ` — ${week.count} ${plural(week.count, 'отметка', 'отметки', 'отметок')}`
        + (goal ? ` при цели ${goal}` : '');

      const fill = node('div', 'bar__fill');
      fill.style.height = `${(week.count / max) * 100}%`;
      fill.style.opacity = week.isCurrent ? '1' : '0.55';
      bar.append(fill);

      // Засечка суммарной недельной цели — видно, добираем мы до плана или нет.
      if (goal > 0 && goal <= max) {
        const line = node('div', 'bar__goal');
        line.style.bottom = `${(goal / max) * 100}%`;
        bar.append(line);
      }

      bar.append(node('div', 'bar__tick', week.start.getDate()));
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

  /* --- Архив --- */

  function renderArchive() {
    const archived = archivedHabits(state);
    el.archivePanel.hidden = !archived.length;
    el.archiveList.textContent = '';
    if (!archived.length) return;

    el.archiveCount.textContent = `${archived.length} ${plural(archived.length, 'достижение', 'достижения', 'достижений')}`;

    archived.forEach((habit) => {
      const item = node('div', 'archive__item');

      const mark = node('span', 'archive__badge');
      paintBadge(mark, habit.badge, habit.color);

      const name = node('div', 'archive__name');
      name.append(node('div', null, habit.name));
      name.append(node('div', 'archive__meta muted', `в архиве с ${formatDate(habit.archivedAt)}`));

      const restore = button('btn btn--ghost', 'Вернуть', () => {
        restoreHabit(state, habit.id);
        saveState();
        render();
      });

      const drop = button('archive__delete', 'Удалить', () => {
        if (!confirm(`Удалить «${habit.name}» вместе со всеми отметками? Это необратимо.`)) return;
        removeHabit(state, habit.id);
        saveState();
        render();
      });
      drop.title = 'Удалить безвозвратно';

      item.append(mark, name, restore, drop);
      el.archiveList.append(item);
    });
  }

  function formatDate(value) {
    const date = core.fromISO(value);
    return `${date.getDate()} ${MONTHS_GEN[date.getMonth()]} ${date.getFullYear()}`;
  }

  /* --- Редактор значка, цвета и цели --- */

  // habit === null означает настройку будущего достижения (черновик формы).
  let editor = null;

  function openEditor(anchorEl, habit) {
    const key = habit ? habit.id : 'draft';
    if (editor && editor.key === key) {
      closeEditor();
      return;
    }
    editor = { key, habit, anchorEl, tab: currentBadge(habit).type };
    renderEditor();
  }

  function currentBadge(habit) {
    if (habit) return habit.badge;
    return draft.badge || autoBadge(sanitizeName(el.addInput.value));
  }

  function currentColor(habit) {
    if (habit) return habit.color;
    return draft.color || PALETTE[state.habits.length % PALETTE.length];
  }

  function currentGoal(habit) {
    return habit ? habit.goal : draft.goal;
  }

  /* Сетка пересоздаётся целиком, поэтому поповер надо переякорить на новый
     элемент значка — иначе он останется привязан к удалённому узлу. */
  function refreshHabitViews(habit) {
    saveState();
    renderGrid();
    renderStats();
    const index = activeHabits(state).findIndex((item) => item.id === habit.id);
    const badges = el.grid.querySelectorAll('.habit-badge');
    if (index >= 0 && badges[index]) editor.anchorEl = badges[index];
  }

  function applyBadge(badge) {
    if (editor.habit) {
      editor.habit.badge = badge;
      refreshHabitViews(editor.habit);
    } else {
      draft.badge = badge;
      renderDraftBadge();
    }
    renderEditor();
  }

  function applyColor(color) {
    if (editor.habit) {
      editor.habit.color = color;
      refreshHabitViews(editor.habit);
    } else {
      draft.color = color;
      renderDraftBadge();
    }
    renderEditor();
  }

  function applyGoal(goal) {
    if (editor.habit) {
      editor.habit.goal = clampGoal(goal);
      refreshHabitViews(editor.habit);
      renderRhythm();
    } else {
      draft.goal = clampGoal(goal);
    }
    renderEditor();
  }

  function renderEditor() {
    const { habit } = editor;
    const badge = currentBadge(habit);
    const color = currentColor(habit);
    const goal = currentGoal(habit);
    const name = habit ? habit.name : sanitizeName(el.addInput.value);

    el.popover.textContent = '';
    el.popover.append(badgeGroup(badge, color, name));
    el.popover.append(colorGroup(color));
    el.popover.append(goalGroup(goal));

    if (habit) {
      el.popover.append(button('popover__action', 'В архив', () => {
        closeEditor();
        archiveHabit(state, habit.id);
        saveState();
        render();
      }));
    }

    el.popover.hidden = false;
    placePopover(editor.anchorEl);
  }

  function badgeGroup(badge, color, name) {
    const group = node('div', 'popover__group');
    const head = node('div', 'popover__head');
    head.append(node('div', 'popover__title', 'Значок'));

    const tabs = node('div', 'segmented segmented--sm');
    [['emoji', 'Смайлик'], ['text', 'Текст']].forEach(([type, label]) => {
      const tab = button('segmented__btn' + (editor.tab === type ? ' is-active' : ''), label, () => {
        editor.tab = type;
        // Переключение вкладки сразу переводит значок в выбранный вид.
        if (type === 'text' && badge.type !== 'text') applyBadge(textBadge('', name));
        else if (type === 'emoji' && badge.type !== 'emoji') applyBadge(autoBadge(name));
        else renderEditor();
      });
      tab.setAttribute('aria-pressed', String(editor.tab === type));
      tabs.append(tab);
    });

    head.append(tabs);
    group.append(head);

    if (editor.tab === 'text') {
      const field = node('input', 'popover__input');
      field.type = 'text';
      field.maxLength = core.MAX_BADGE_TEXT;
      field.value = badge.type === 'text' ? badge.value : '';
      field.placeholder = 'Тр';
      field.setAttribute('aria-label', 'Текст значка');
      field.addEventListener('input', () => {
        const next = textBadge(field.value, name);
        if (editor.habit) {
          editor.habit.badge = next;
          refreshHabitViews(editor.habit);
        } else {
          draft.badge = next;
          renderDraftBadge();
        }
      });
      group.append(field);
      group.append(node('div', 'popover__hint muted', 'До 3 символов — например, «Тр» или «5к»'));
    } else {
      const icons = node('div', 'icons');
      EMOJI.forEach((emoji) => {
        const item = button('icon-btn' + (badge.type === 'emoji' && badge.value === emoji ? ' is-active' : ''),
          emoji, () => applyBadge(emojiBadge(emoji)));
        item.setAttribute('aria-label', `Значок ${emoji}`);
        icons.append(item);
      });
      group.append(icons);
      group.append(button('popover__link', 'Подобрать по названию', () => applyBadge(autoBadge(name))));
    }

    return group;
  }

  function colorGroup(color) {
    const group = node('div', 'popover__group');
    group.append(node('div', 'popover__title', 'Цвет'));

    const swatches = node('div', 'swatches');
    PALETTE.forEach((option) => {
      const swatch = button('swatch' + (color === option ? ' is-active' : ''), null, () => applyColor(option));
      swatch.style.background = option;
      swatch.setAttribute('aria-label', `Цвет ${option}`);
      swatches.append(swatch);
    });

    group.append(swatches);
    return group;
  }

  function goalGroup(goal) {
    const group = node('div', 'popover__group');
    group.append(node('div', 'popover__title', 'Цель — раз в неделю'));

    const scale = node('div', 'goals');
    for (let value = 1; value <= MAX_GOAL; value++) {
      const item = button('goal-btn' + (goal === value ? ' is-active' : ''), String(value), () => applyGoal(value));
      item.setAttribute('aria-label', `${value} ${plural(value, 'раз', 'раза', 'раз')} в неделю`);
      item.setAttribute('aria-pressed', String(goal === value));
      scale.append(item);
    }

    group.append(scale);
    group.append(node('div', 'popover__hint muted', goal === MAX_GOAL
      ? 'Каждый день'
      : `${goal} ${plural(goal, 'раз', 'раза', 'раз')} в неделю · в месяце ≈ ${goalForDays(goal, 30)}`));
    return group;
  }

  function placePopover(anchorEl) {
    const rect = anchorEl.getBoundingClientRect();
    const width = el.popover.offsetWidth;
    const height = el.popover.offsetHeight;
    const viewport = document.documentElement.clientHeight;

    const left = Math.min(
      Math.max(8, rect.left + window.scrollX),
      window.scrollX + document.documentElement.clientWidth - width - 8,
    );

    // Если снизу не хватает места — раскрываем поповер вверх от значка.
    const below = rect.bottom + 6 + height <= viewport;
    const top = below
      ? rect.bottom + window.scrollY + 6
      : Math.max(window.scrollY + 8, rect.top + window.scrollY - height - 6);

    el.popover.style.left = `${left}px`;
    el.popover.style.top = `${top}px`;
  }

  function closeEditor() {
    editor = null;
    el.popover.hidden = true;
    el.popover.textContent = '';
  }

  /* Перехват на фазе capture обязателен: клик внутри поповера пересоздаёт его
     содержимое, и на фазе всплытия исходная цель уже вне документа. */
  document.addEventListener('click', (e) => {
    if (!editor) return;
    const target = e.target instanceof Element ? e.target : null;
    if (target && (el.popover.contains(target) || target.closest('.habit-badge'))) return;
    closeEditor();
  }, true);

  window.addEventListener('resize', closeEditor);

  /* --- Форма добавления --- */

  function renderDraftBadge() {
    const badge = draft.badge || autoBadge(sanitizeName(el.addInput.value));
    paintBadge(el.addBadge, badge, currentColor(null));
  }

  el.addBadge.addEventListener('click', () => openEditor(el.addBadge, null));

  el.addInput.addEventListener('input', () => {
    // Пока значок не выбран вручную, он подстраивается под название на ходу.
    if (!draft.badge) renderDraftBadge();
    if (editor && !editor.habit) renderEditor();
  });

  el.addForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = sanitizeName(el.addInput.value);
    if (!name) return;

    state.habits.push(createHabit(name, state.habits.length, {
      badge: draft.badge || autoBadge(name),
      color: draft.color || undefined,
      goal: draft.goal,
    }));

    el.addInput.value = '';
    draft = { badge: null, color: null, goal: DEFAULT_GOAL };
    closeEditor();
    saveState();
    render();
  });

  /* --- Управление периодом --- */

  el.modeButtons.forEach((item) => {
    item.addEventListener('click', () => setMode(item.dataset.mode));
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
    closeEditor();
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
    if (e.key === 'Escape') { closeEditor(); return; }
    if (isTextField(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;

    const key = e.key.toLowerCase();
    if (e.key === 'ArrowLeft') movePeriod(-1);
    else if (e.key === 'ArrowRight') movePeriod(1);
    else if (key === 't' || key === 'е') goToday();
    else if (key === 'w' || key === 'ц') setMode('week');
    else if (key === 'm' || key === 'ь') setMode('month');
  });

  /* --- Экспорт и импорт --- */

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

  /* --- Установка на устройство и работа офлайн --- */

  // Service worker недоступен при открытии файла напрямую — это нормально.
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch((e) => {
        console.warn('Офлайн-режим недоступен:', e);
      });
    });
  }

  const installBtn = document.getElementById('install-btn');
  let installPrompt = null;

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    installPrompt = e;
    installBtn.hidden = false;
  });

  installBtn.addEventListener('click', async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    await installPrompt.userChoice;
    installPrompt = null;
    installBtn.hidden = true;
  });

  window.addEventListener('appinstalled', () => {
    installPrompt = null;
    installBtn.hidden = true;
  });

  render();
})(window.AchievementsCore);
