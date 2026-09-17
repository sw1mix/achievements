/* Чистая логика трекера: даты, агрегация, миграция данных.
   Файл подключается и в браузере (window.AchievementsCore), и в тестах на Node. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AchievementsCore = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  const SCHEMA_VERSION = 3;
  const MAX_NAME = 40;
  const MAX_BADGE_TEXT = 3;
  const MAX_GOAL = 7;
  const DEFAULT_GOAL = 7;

  const PALETTE = ['#2f6fed', '#18a06a', '#e0883a', '#c4504b', '#7a5af5', '#0f9bb0', '#d1478f'];

  const EMOJI = [
    '🏃', '🚶', '🚴', '🏋️', '🤸', '⚽',
    '📚', '✍️', '🧠', '💻', '🎓', '🗣️',
    '💧', '🍎', '🥗', '🚭', '☕', '💤',
    '🧘', '🙏', '🌱', '☀️', '🌙', '🚿',
    '🧹', '💰', '🎸', '🎨', '🎯', '⭐',
    '🔥', '💎', '🚀', '🧩', '🏅', '❤️',
  ];

  // Автоподбор смайлика по названию: пары «ключевые слова → смайлик».
  const EMOJI_RULES = [
    [['трениров', 'бег', 'спорт', 'зал', 'фитнес', 'run', 'gym', 'workout'], '🏃'],
    [['шаг', 'прогул', 'ходьб', 'walk'], '🚶'],
    [['велосипед', 'велик', 'bike', 'cycl'], '🚴'],
    [['штанг', 'силов', 'отжим', 'подтяг'], '🏋️'],
    [['растяж', 'зарядк', 'разминк', 'stretch'], '🤸'],
    [['футбол', 'баскет', 'теннис', 'плаван', 'бассейн'], '⚽'],
    [['чтен', 'книг', 'read'], '📚'],
    [['дневник', 'писать', 'письм', 'запис', 'journal', 'write'], '✍️'],
    [['учеб', 'учить', 'курс', 'урок', 'учу', 'study', 'мозг'], '🧠'],
    [['код', 'программ', 'проект', 'работ', 'code'], '💻'],
    [['англ', 'язык', 'english', 'испан', 'немец'], '🎓'],
    [['созвон', 'звонок', 'общен', 'говор', 'разговор'], '🗣️'],
    [['вода', 'вод', 'пить', 'water'], '💧'],
    [['сахар', 'сладк', 'фаст', 'диет', 'фрукт', 'sugar'], '🍎'],
    [['овощ', 'салат', 'еда', 'завтрак', 'обед', 'ужин', 'готов'], '🥗'],
    [['курен', 'курить', 'сигарет', 'вейп', 'smoke'], '🚭'],
    [['кофе', 'чай', 'coffee'], '☕'],
    [['сон', 'спать', 'сна', 'выспат', 'sleep'], '💤'],
    [['медит', 'йог', 'дыхан', 'meditat', 'yoga'], '🧘'],
    [['благодарн', 'молитв', 'gratitude'], '🙏'],
    [['растен', 'цвет', 'полив', 'сад'], '🌱'],
    [['улиц', 'солнц', 'свеж', 'воздух', 'прогулк'], '☀️'],
    [['вечер', 'ночь', 'ранн', 'подъём', 'подъем'], '🌙'],
    [['душ', 'зубы', 'гигиен', 'уход'], '🚿'],
    [['уборк', 'убрат', 'чист', 'порядок', 'посуд', 'clean'], '🧹'],
    [['деньг', 'бюджет', 'накопл', 'расход', 'money'], '💰'],
    [['гитар', 'музык', 'пианино', 'форте', 'music'], '🎸'],
    [['рисов', 'скетч', 'творч', 'draw', 'art'], '🎨'],
  ];

  // Смайлики для названий, не попавших ни под одно правило.
  const FALLBACK_EMOJI = ['🎯', '⭐', '🔥', '💎', '🚀', '🧩', '🏅', '❤️'];

  const DAY_NAMES = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
  const DAY_LETTERS = ['П', 'В', 'С', 'Ч', 'П', 'С', 'В'];
  const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
    'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
  const MONTHS_NOM = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
    'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
  const MONTHS_SHORT = ['янв', 'фев', 'мар', 'апр', 'май', 'июн',
    'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

  const DEFAULT_HABITS = [
    { name: 'Тренировка', goal: 3 },
    { name: 'Чтение', goal: 7 },
    { name: 'Без сахара', goal: 5 },
    { name: '8 часов сна', goal: 7 },
  ];

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

  /* --- Значки --- */

  function sanitizeName(value, fallback = '') {
    if (typeof value !== 'string') return fallback;
    const trimmed = value.trim().slice(0, MAX_NAME);
    return trimmed || fallback;
  }

  function sanitizeBadgeText(value, fallback = '') {
    if (typeof value !== 'string') return fallback;
    // Учитываем символы, а не кодовые единицы: эмодзи и буквы считаются одинаково.
    const chars = Array.from(value.trim());
    return chars.slice(0, MAX_BADGE_TEXT).join('') || fallback;
  }

  function hashString(value) {
    let hash = 0;
    for (let i = 0; i < value.length; i++) hash = (hash * 31 + value.charCodeAt(i)) % 100000;
    return hash;
  }

  function emojiForName(name) {
    const lower = String(name).toLowerCase();
    const rule = EMOJI_RULES.find(([keywords]) => keywords.some((word) => lower.includes(word)));
    if (rule) return rule[1];
    return FALLBACK_EMOJI[hashString(lower) % FALLBACK_EMOJI.length];
  }

  function emojiBadge(value) {
    return { type: 'emoji', value };
  }

  function textBadge(value, name = '') {
    return { type: 'text', value: sanitizeBadgeText(value, initialsFor(name)) };
  }

  // Инициалы для текстового значка: «Полив цветов» → «ПЦ», «Бег» → «Б».
  function initialsFor(name) {
    const words = String(name).trim().split(/\s+/).filter(Boolean);
    if (!words.length) return '?';
    if (words.length === 1) return Array.from(words[0])[0].toUpperCase();
    return words.slice(0, 2).map((word) => Array.from(word)[0].toUpperCase()).join('');
  }

  // Значок по умолчанию — смайлик, подобранный по названию.
  function autoBadge(name) {
    return emojiBadge(emojiForName(name));
  }

  function normalizeBadge(raw, name) {
    if (raw && typeof raw === 'object') {
      if (raw.type === 'text') return textBadge(raw.value, name);
      if (raw.type === 'emoji' && typeof raw.value === 'string' && raw.value.trim()) {
        return emojiBadge(raw.value.trim());
      }
    }
    // Схема v2 хранила смайлик строкой в поле icon; пустое значение — повод подобрать заново.
    if (typeof raw === 'string' && raw.trim()) return emojiBadge(raw.trim());
    return autoBadge(name);
  }

  /* --- Состояние --- */

  function uid() {
    return Math.random().toString(36).slice(2, 10);
  }

  function clampGoal(value, fallback = DEFAULT_GOAL) {
    const number = Math.round(Number(value));
    if (!Number.isFinite(number)) return fallback;
    return Math.min(MAX_GOAL, Math.max(1, number));
  }

  function createHabit(name, index = 0, options = {}) {
    const clean = sanitizeName(name);
    return {
      id: uid(),
      name: clean,
      color: options.color || PALETTE[index % PALETTE.length],
      badge: options.badge ? normalizeBadge(options.badge, clean) : autoBadge(clean),
      goal: clampGoal(options.goal),
      createdAt: iso(options.today || new Date()),
      archivedAt: null,
    };
  }

  function initialState() {
    return {
      version: SCHEMA_VERSION,
      habits: DEFAULT_HABITS.map((habit, index) => createHabit(habit.name, index, { goal: habit.goal })),
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
        badge: normalizeBadge(habit.badge !== undefined ? habit.badge : habit.icon, name),
        goal: clampGoal(habit.goal),
        createdAt: typeof habit.createdAt === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(habit.createdAt)
          ? habit.createdAt
          : iso(new Date()),
        archivedAt: typeof habit.archivedAt === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(habit.archivedAt)
          ? habit.archivedAt
          : null,
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

  function activeHabits(state) {
    return state.habits.filter((habit) => !habit.archivedAt);
  }

  function archivedHabits(state) {
    return state.habits.filter((habit) => habit.archivedAt);
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

  function archiveHabit(state, habitId, today = new Date()) {
    const habit = state.habits.find((item) => item.id === habitId);
    if (habit) habit.archivedAt = iso(today);
    return state;
  }

  function restoreHabit(state, habitId) {
    const habit = state.habits.find((item) => item.id === habitId);
    if (habit) habit.archivedAt = null;
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

  /* --- Порядок --- */

  /* Переставляет привычку перед или после другой. Индексы считаются по полному
     списку, поэтому архивные записи сохраняют своё место. */
  function reorderHabits(state, draggedId, targetId, placeAfter = false) {
    if (draggedId === targetId) return state;
    const from = state.habits.findIndex((habit) => habit.id === draggedId);
    const to = state.habits.findIndex((habit) => habit.id === targetId);
    if (from < 0 || to < 0) return state;

    const [moved] = state.habits.splice(from, 1);
    const targetIndex = state.habits.findIndex((habit) => habit.id === targetId);
    state.habits.splice(targetIndex + (placeAfter ? 1 : 0), 0, moved);
    return state;
  }

  // Сдвиг на одну позицию среди активных привычек: -1 вверх, +1 вниз.
  function moveHabit(state, habitId, direction) {
    const active = activeHabits(state);
    const index = active.findIndex((habit) => habit.id === habitId);
    const neighbour = active[index + direction];
    if (index < 0 || !neighbour) return state;
    return reorderHabits(state, habitId, neighbour.id, direction > 0);
  }

  /* --- Цели --- */

  // Недельная цель, пересчитанная на длину периода: 3 раза в неделю ≈ 13 раз в месяц.
  function goalForDays(goal, dayCount) {
    return Math.max(1, Math.round(clampGoal(goal) * (dayCount / 7)));
  }

  /* --- Агрегация --- */

  // Отметки за день по всем привычкам, включая архивные: история не переписывается.
  function dayCount(state, date) {
    const marks = state.done[iso(date)];
    if (!marks) return 0;
    return state.habits.filter((habit) => marks[habit.id]).length;
  }

  function activeDayCount(state, date) {
    const marks = state.done[iso(date)];
    if (!marks) return 0;
    return activeHabits(state).filter((habit) => marks[habit.id]).length;
  }

  function habitCount(state, habitId, days) {
    return days.filter((day) => isDone(state, habitId, day)).length;
  }

  /* Итоги периода. Прогресс считается относительно целей: сверхплановые отметки
     не раздувают общий процент, но показываются отдельно. */
  function periodStats(state, days) {
    const perHabit = activeHabits(state).map((habit) => {
      const done = habitCount(state, habit.id, days);
      const goal = goalForDays(habit.goal, days.length);
      return {
        habit,
        done,
        goal,
        hit: done >= goal,
        extra: Math.max(0, done - goal),
      };
    });

    const total = perHabit.reduce((sum, item) => sum + Math.min(item.done, item.goal), 0);
    const possible = perHabit.reduce((sum, item) => sum + item.goal, 0);
    const marks = perHabit.reduce((sum, item) => sum + item.done, 0);

    let bestDay = null;
    days.forEach((day) => {
      const count = activeDayCount(state, day);
      if (count > 0 && (!bestDay || count > bestDay.count)) bestDay = { day, count };
    });

    return {
      perHabit,
      total,
      possible,
      marks,
      bestDay,
      hits: perHabit.filter((item) => item.hit).length,
    };
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

  // Итоги по неделям от давних к текущей: последний элемент — идущая неделя.
  function weeklyTotals(state, { weeks = RHYTHM_WEEKS, today = new Date() } = {}) {
    const currentWeek = startOfWeek(today);
    const goal = activeHabits(state).reduce((sum, habit) => sum + clampGoal(habit.goal), 0);

    return Array.from({ length: weeks }, (_, index) => {
      const start = addDays(currentWeek, -(weeks - 1 - index) * 7);
      const days = periodDays('week', start);
      return {
        start,
        count: days.reduce((sum, day) => sum + dayCount(state, day), 0),
        goal,
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
    const max = Math.max(1, activeHabits(state).length);

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
    MAX_BADGE_TEXT,
    MAX_GOAL,
    DEFAULT_GOAL,
    PALETTE,
    EMOJI,
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
    sanitizeName,
    sanitizeBadgeText,
    emojiForName,
    emojiBadge,
    textBadge,
    initialsFor,
    autoBadge,
    normalizeBadge,
    uid,
    clampGoal,
    createHabit,
    initialState,
    migrate,
    activeHabits,
    archivedHabits,
    isDone,
    setDone,
    archiveHabit,
    restoreHabit,
    removeHabit,
    reorderHabits,
    moveHabit,
    goalForDays,
    dayCount,
    activeDayCount,
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
