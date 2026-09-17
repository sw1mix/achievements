/* Чистая логика трекера: даты, агрегация, миграция данных.
   Файл подключается и в браузере (window.AchievementsCore), и в тестах на Node. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AchievementsCore = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  const SCHEMA_VERSION = 2;
  const MAX_NAME = 40;

  const PALETTE = ['#2f6fed', '#18a06a', '#e0883a', '#c4504b', '#7a5af5', '#0f9bb0', '#d1478f'];
  const ICONS = ['', '🏃', '📚', '💧', '🧘', '🍎', '💤', '🧹', '💻', '🎸', '✍️', '🧠', '🚴', '🥗', '☀️', '🎯'];

  const DAY_NAMES = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
  const DAY_LETTERS = ['П', 'В', 'С', 'Ч', 'П', 'С', 'В'];
  const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
    'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
  const MONTHS_NOM = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
    'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
  const MONTHS_SHORT = ['янв', 'фев', 'мар', 'апр', 'май', 'июн',
    'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

  const DEFAULT_HABITS = ['Тренировка', 'Чтение', 'Без сахара', '8 часов сна'];

  const RHYTHM_WEEKS = 12;

  /* --- Даты --- */

  function iso(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  function fromISO(value) {
    const [y, m, d] = value.split('-').map(Number);
    return new Date(y, m - 1, d);
  }

  function startOfDay(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  }

  function addDays(date, days) {
    const next = startOfDay(date);
    next.setDate(next.getDate() + days);
    return next;
  }

  // Индекс дня недели с понедельника: Пн = 0, Вс = 6.
  function weekday(date) {
    return (date.getDay() + 6) % 7;
  }

  function isWeekend(date) {
    return weekday(date) >= 5;
  }

  function startOfWeek(date) {
    return addDays(startOfDay(date), -weekday(date));
  }

  function startOfMonth(date) {
    return new Date(date.getFullYear(), date.getMonth(), 1);
  }

  function daysInMonth(date) {
    return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  }

  function sameDay(a, b) {
    return iso(a) === iso(b);
  }

  /* --- Период --- */

  // Дни выбранного периода: 7 дней недели либо все дни месяца.
  function periodDays(mode, anchor) {
    if (mode === 'month') {
      const first = startOfMonth(anchor);
      return Array.from({ length: daysInMonth(anchor) }, (_, i) => addDays(first, i));
    }
    const first = startOfWeek(anchor);
    return Array.from({ length: 7 }, (_, i) => addDays(first, i));
  }

  function shiftPeriod(mode, anchor, direction) {
    if (mode === 'month') {
      return new Date(anchor.getFullYear(), anchor.getMonth() + direction, 1);
    }
    return addDays(startOfWeek(anchor), direction * 7);
  }

  function normalizeAnchor(mode, anchor) {
    return mode === 'month' ? startOfMonth(anchor) : startOfWeek(anchor);
  }

  function formatPeriod(mode, anchor, today = new Date()) {
    if (mode === 'month') {
      const current = anchor.getFullYear() === today.getFullYear() && anchor.getMonth() === today.getMonth();
      return {
        range: `${MONTHS_NOM[anchor.getMonth()]} ${anchor.getFullYear()}`,
        sub: current ? 'текущий месяц' : '',
      };
    }

    const days = periodDays('week', anchor);
    const from = days[0];
    const to = days[6];
    const range = from.getMonth() === to.getMonth()
      ? `${from.getDate()}–${to.getDate()} ${MONTHS_GEN[to.getMonth()]}`
      : `${from.getDate()} ${MONTHS_GEN[from.getMonth()]} – ${to.getDate()} ${MONTHS_GEN[to.getMonth()]}`;

    const current = sameDay(from, startOfWeek(today));
    return { range, sub: current ? 'текущая неделя' : String(to.getFullYear()) };
  }

  /* --- Состояние --- */

  function uid() {
    return Math.random().toString(36).slice(2, 10);
  }

  function sanitizeName(value, fallback = '') {
    if (typeof value !== 'string') return fallback;
    const trimmed = value.trim().slice(0, MAX_NAME);
    return trimmed || fallback;
  }

  function createHabit(name, index = 0) {
    return {
      id: uid(),
      name: sanitizeName(name),
      color: PALETTE[index % PALETTE.length],
      icon: '',
      createdAt: iso(new Date()),
    };
  }

  function initialState() {
    return {
      version: SCHEMA_VERSION,
      habits: DEFAULT_HABITS.map(createHabit),
      done: {},
    };
  }

  /* Приводит данные любой предыдущей версии к текущей схеме.
     Возвращает null, если это вообще не похоже на данные трекера. */
  function migrate(raw) {
    if (!raw || typeof raw !== 'object') return null;
    if (!Array.isArray(raw.habits) || !raw.done || typeof raw.done !== 'object') return null;

    const habits = [];
    const knownIds = new Set();

    raw.habits.forEach((habit, index) => {
      if (!habit || typeof habit !== 'object') return;
      const name = sanitizeName(habit.name);
      if (!name) return;

      let id = typeof habit.id === 'string' && habit.id ? habit.id : uid();
      while (knownIds.has(id)) id = uid();
      knownIds.add(id);

      habits.push({
        id,
        name,
        color: typeof habit.color === 'string' && /^#[0-9a-f]{3,8}$/i.test(habit.color)
          ? habit.color
          : PALETTE[index % PALETTE.length],
        icon: ICONS.includes(habit.icon) ? habit.icon : '',
        createdAt: typeof habit.createdAt === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(habit.createdAt)
          ? habit.createdAt
          : iso(new Date()),
      });
    });

    const done = {};
    Object.entries(raw.done).forEach(([day, marks]) => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !marks || typeof marks !== 'object') return;
      const kept = {};
      Object.keys(marks).forEach((habitId) => {
        if (marks[habitId] && knownIds.has(habitId)) kept[habitId] = true;
      });
      if (Object.keys(kept).length) done[day] = kept;
    });

    return { version: SCHEMA_VERSION, habits, done };
  }

  function isDone(state, habitId, date) {
    const marks = state.done[iso(date)];
    return Boolean(marks && marks[habitId]);
  }

  function setDone(state, habitId, date, value) {
    const key = iso(date);
    if (value) {
      state.done[key] = state.done[key] || {};
      state.done[key][habitId] = true;
    } else if (state.done[key]) {
      delete state.done[key][habitId];
      if (!Object.keys(state.done[key]).length) delete state.done[key];
    }
    return state;
  }

  function removeHabit(state, habitId) {
    state.habits = state.habits.filter((habit) => habit.id !== habitId);
    Object.keys(state.done).forEach((day) => {
      delete state.done[day][habitId];
      if (!Object.keys(state.done[day]).length) delete state.done[day];
    });
    return state;
  }

  /* --- Агрегация --- */

  function dayCount(state, date) {
    const marks = state.done[iso(date)];
    if (!marks) return 0;
    return state.habits.filter((habit) => marks[habit.id]).length;
  }

  function habitCount(state, habitId, days) {
    return days.filter((day) => isDone(state, habitId, day)).length;
  }

  function periodStats(state, days) {
    const perHabit = state.habits.map((habit) => ({
      habit,
      done: habitCount(state, habit.id, days),
    }));

    const total = perHabit.reduce((sum, item) => sum + item.done, 0);
    const possible = state.habits.length * days.length;

    let bestDay = null;
    days.forEach((day) => {
      const count = dayCount(state, day);
      if (count > 0 && (!bestDay || count > bestDay.count)) bestDay = { day, count };
    });

    return { perHabit, total, possible, bestDay };
  }

  // Серия дней подряд с хотя бы одной отметкой; сегодняшний незакрытый день серию не рвёт.
  function streak(state, today = new Date()) {
    const hasMarks = (date) => dayCount(state, date) > 0;
    let cursor = startOfDay(today);
    if (!hasMarks(cursor)) cursor = addDays(cursor, -1);

    let length = 0;
    while (hasMarks(cursor)) {
      length++;
      cursor = addDays(cursor, -1);
    }
    return length;
  }

  function percent(value, max) {
    return max ? Math.round((value / max) * 100) : 0;
  }

  function plural(n, one, few, many) {
    const mod10 = n % 10;
    const mod100 = n % 100;
    if (mod10 === 1 && mod100 !== 11) return one;
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
    return many;
  }

  /* --- Ритм --- */

  // Сумма отметок по дням недели за последние N недель, включая текущую.
  function weekdayTotals(state, { weeks = RHYTHM_WEEKS, today = new Date() } = {}) {
    const totals = Array(7).fill(0);
    const first = addDays(startOfWeek(today), -(weeks - 1) * 7);

    for (let i = 0; i < weeks * 7; i++) {
      const day = addDays(first, i);
      totals[weekday(day)] += dayCount(state, day);
    }
    return totals;
  }

  // Итоги по неделям от давних к текущей: last элемент — идущая неделя.
  function weeklyTotals(state, { weeks = RHYTHM_WEEKS, today = new Date() } = {}) {
    const currentWeek = startOfWeek(today);

    return Array.from({ length: weeks }, (_, index) => {
      const start = addDays(currentWeek, -(weeks - 1 - index) * 7);
      const days = periodDays('week', start);
      return {
        start,
        count: days.reduce((sum, day) => sum + dayCount(state, day), 0),
        possible: state.habits.length * 7,
        isCurrent: sameDay(start, currentWeek),
      };
    });
  }

  /* --- Год --- */

  function heatLevel(count, max) {
    if (!count || !max) return 0;
    return Math.min(4, Math.ceil((count / max) * 4));
  }

  /* Год в виде колонок-недель (как в GitHub-календаре).
     Каждая колонка — 7 ячеек с понедельника; дни вне года помечены inYear: false. */
  function yearGrid(state, year, today = new Date()) {
    const yearStart = new Date(year, 0, 1);
    const yearEnd = new Date(year, 11, 31);
    const max = Math.max(1, state.habits.length);

    const columns = [];
    for (let start = startOfWeek(yearStart); start <= yearEnd; start = addDays(start, 7)) {
      const days = Array.from({ length: 7 }, (_, i) => {
        const date = addDays(start, i);
        const inYear = date.getFullYear() === year;
        const count = inYear ? dayCount(state, date) : 0;
        return {
          date,
          inYear,
          count,
          level: heatLevel(count, max),
          isToday: inYear && sameDay(date, today),
          isFuture: date > startOfDay(today),
        };
      });
      columns.push({ start, days });
    }

    // Подпись месяца — над колонкой, в которой месяц сменился.
    let previous = -1;
    const labels = columns.map((column) => {
      const day = column.days.find((item) => item.inYear);
      if (!day) return '';
      const month = day.date.getMonth();
      if (month === previous) return '';
      previous = month;
      return MONTHS_SHORT[month];
    });

    const total = columns.reduce((sum, column) => sum
      + column.days.reduce((inner, day) => inner + day.count, 0), 0);
    const activeDays = columns.reduce((sum, column) => sum
      + column.days.filter((day) => day.count > 0).length, 0);

    return { columns, labels, total, activeDays };
  }

  return {
    SCHEMA_VERSION,
    MAX_NAME,
    PALETTE,
    ICONS,
    DAY_NAMES,
    DAY_LETTERS,
    MONTHS_GEN,
    MONTHS_NOM,
    MONTHS_SHORT,
    RHYTHM_WEEKS,
    iso,
    fromISO,
    startOfDay,
    addDays,
    weekday,
    isWeekend,
    startOfWeek,
    startOfMonth,
    daysInMonth,
    sameDay,
    periodDays,
    shiftPeriod,
    normalizeAnchor,
    formatPeriod,
    uid,
    sanitizeName,
    createHabit,
    initialState,
    migrate,
    isDone,
    setDone,
    removeHabit,
    dayCount,
    habitCount,
    periodStats,
    streak,
    percent,
    plural,
    weekdayTotals,
    weeklyTotals,
    heatLevel,
    yearGrid,
  };
});
