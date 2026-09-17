const test = require('node:test');
const assert = require('node:assert/strict');

const core = require('../core.js');

const {
  iso, fromISO, addDays, startOfWeek, weekday, isWeekend,
  periodDays, shiftPeriod, normalizeAnchor, formatPeriod,
  sanitizeName, sanitizeBadgeText, emojiForName, autoBadge, normalizeBadge, textBadge,
  clampGoal, goalForDays, createHabit, initialState, migrate,
  activeHabits, archivedHabits, isDone, setDone,
  archiveHabit, restoreHabit, removeHabit, reorderHabits, moveHabit,
  dayCount, activeDayCount, periodStats, streak, percent, plural,
  weekdayTotals, weeklyTotals, heatLevel, yearGrid,
} = core;

// Фиксированная «сегодняшняя» дата: четверг, 17 сентября 2026.
const TODAY = new Date(2026, 8, 17);

function stateWith(marks = {}, habitCount = 2, overrides = []) {
  const habits = Array.from({ length: habitCount }, (_, i) => ({
    id: `h${i + 1}`,
    name: `Привычка ${i + 1}`,
    color: core.PALETTE[i],
    badge: { type: 'emoji', value: '🎯' },
    goal: core.DEFAULT_GOAL,
    createdAt: '2026-01-01',
    archivedAt: null,
    ...(overrides[i] || {}),
  }));
  return { version: core.SCHEMA_VERSION, habits, done: marks };
}

test('iso и fromISO обратимы', () => {
  const date = new Date(2026, 0, 5);
  assert.equal(iso(date), '2026-01-05');
  assert.equal(iso(fromISO('2026-01-05')), '2026-01-05');
});

test('addDays переходит через границу месяца и года', () => {
  assert.equal(iso(addDays(new Date(2026, 0, 31), 1)), '2026-02-01');
  assert.equal(iso(addDays(new Date(2026, 11, 31), 1)), '2027-01-01');
  assert.equal(iso(addDays(new Date(2026, 0, 1), -1)), '2025-12-31');
});

test('неделя начинается с понедельника', () => {
  assert.equal(weekday(new Date(2026, 8, 14)), 0); // понедельник
  assert.equal(weekday(new Date(2026, 8, 20)), 6); // воскресенье
  assert.equal(iso(startOfWeek(new Date(2026, 8, 20))), '2026-09-14');
  assert.equal(iso(startOfWeek(new Date(2026, 8, 14))), '2026-09-14');
  assert.equal(isWeekend(new Date(2026, 8, 19)), true);
  assert.equal(isWeekend(new Date(2026, 8, 18)), false);
});

test('periodDays возвращает неделю и полный месяц', () => {
  const week = periodDays('week', TODAY);
  assert.equal(week.length, 7);
  assert.equal(iso(week[0]), '2026-09-14');
  assert.equal(iso(week[6]), '2026-09-20');

  assert.equal(periodDays('month', new Date(2026, 8, 17)).length, 30);
  assert.equal(periodDays('month', new Date(2024, 1, 10)).length, 29); // февраль високосного года
  assert.equal(iso(periodDays('month', TODAY)[0]), '2026-09-01');
});

test('shiftPeriod не выходит за границы короткого месяца', () => {
  assert.equal(iso(shiftPeriod('month', new Date(2026, 0, 31), 1)), '2026-02-01');
  assert.equal(iso(shiftPeriod('month', new Date(2026, 0, 15), -1)), '2025-12-01');
  assert.equal(iso(shiftPeriod('week', TODAY, -1)), '2026-09-07');
  assert.equal(iso(shiftPeriod('week', TODAY, 1)), '2026-09-21');
});

test('normalizeAnchor приводит дату к началу периода', () => {
  assert.equal(iso(normalizeAnchor('week', TODAY)), '2026-09-14');
  assert.equal(iso(normalizeAnchor('month', TODAY)), '2026-09-01');
});

test('formatPeriod подписывает период по-русски', () => {
  assert.deepEqual(formatPeriod('week', new Date(2026, 8, 14), TODAY), {
    range: '14–20 сентября',
    sub: 'текущая неделя',
  });

  // Неделя на стыке месяцев показывает оба месяца.
  assert.equal(formatPeriod('week', new Date(2026, 8, 28), TODAY).range,
    '28 сентября – 4 октября');
  assert.equal(formatPeriod('week', new Date(2026, 8, 28), TODAY).sub, '2026');

  assert.deepEqual(formatPeriod('month', new Date(2026, 8, 1), TODAY), {
    range: 'Сентябрь 2026',
    sub: 'текущий месяц',
  });
  assert.equal(formatPeriod('month', new Date(2025, 8, 1), TODAY).sub, '');
});

test('sanitizeName обрезает пробелы и длину', () => {
  assert.equal(sanitizeName('  Бег  '), 'Бег');
  assert.equal(sanitizeName('я'.repeat(60)).length, core.MAX_NAME);
  assert.equal(sanitizeName('   ', 'Старое'), 'Старое');
  assert.equal(sanitizeName(null, 'Старое'), 'Старое');
});

/* --- Значки --- */

test('emojiForName подбирает смайлик по ключевым словам', () => {
  assert.equal(emojiForName('Тренировка'), '🏃');
  assert.equal(emojiForName('утренний БЕГ'), '🏃');
  assert.equal(emojiForName('Чтение книг'), '📚');
  assert.equal(emojiForName('8 часов сна'), '💤');
  assert.equal(emojiForName('Без сахара'), '🍎');
  assert.equal(emojiForName('Медитация'), '🧘');
  assert.equal(emojiForName('2 литра воды'), '💧');
  assert.equal(emojiForName('Не курить'), '🚭');
});

test('emojiForName для незнакомых названий даёт стабильный смайлик из запаса', () => {
  const first = emojiForName('Какая-то своя затея');
  assert.equal(core.EMOJI.includes(first), true);
  assert.equal(emojiForName('Какая-то своя затея'), first, 'подбор детерминирован');
  assert.notEqual(emojiForName('Другая затея'), '', 'название без правил тоже получает смайлик');
});

test('sanitizeBadgeText ограничивает длину по символам', () => {
  assert.equal(sanitizeBadgeText(' Тр '), 'Тр');
  assert.equal(sanitizeBadgeText('Тренировка'), 'Тре');
  assert.equal(sanitizeBadgeText('5к'), '5к');
  assert.equal(sanitizeBadgeText('', 'Б'), 'Б');
  assert.equal(sanitizeBadgeText('👨‍👩‍👧‍👦').length > 0, true, 'составной эмодзи не ломает обрезку');
});

test('textBadge подставляет инициалы, если текст пустой', () => {
  assert.deepEqual(textBadge('', 'Бег'), { type: 'text', value: 'Б' });
  assert.deepEqual(textBadge('', 'Полив цветов'), { type: 'text', value: 'ПЦ' });
  assert.deepEqual(textBadge('чт', 'Чтение'), { type: 'text', value: 'чт' });
  assert.deepEqual(textBadge('', ''), { type: 'text', value: '?' });
});

test('initialsFor собирает инициалы из первых двух слов', () => {
  assert.equal(core.initialsFor('Бег'), 'Б');
  assert.equal(core.initialsFor('Полив цветов'), 'ПЦ');
  assert.equal(core.initialsFor('8 часов сна'), '8Ч');
  assert.equal(core.initialsFor('  '), '?');
});

test('normalizeBadge понимает оба вида значков и старый формат', () => {
  assert.deepEqual(normalizeBadge({ type: 'emoji', value: '🏃' }, 'Бег'), { type: 'emoji', value: '🏃' });
  assert.deepEqual(normalizeBadge({ type: 'text', value: 'Бег!' }, 'Бег'), { type: 'text', value: 'Бег' });
  assert.deepEqual(normalizeBadge('📚', 'Чтение'), { type: 'emoji', value: '📚' }, 'строка из схемы v2');
  assert.deepEqual(normalizeBadge('', 'Чтение'), autoBadge('Чтение'), 'пустой значок подбирается заново');
  assert.deepEqual(normalizeBadge(undefined, 'Тренировка'), { type: 'emoji', value: '🏃' });
  assert.deepEqual(normalizeBadge({ type: 'странный' }, 'Бег'), autoBadge('Бег'));
});

/* --- Цели --- */

test('clampGoal держит цель в диапазоне 1..7', () => {
  assert.equal(clampGoal(3), 3);
  assert.equal(clampGoal(0), 1);
  assert.equal(clampGoal(-5), 1);
  assert.equal(clampGoal(99), 7);
  assert.equal(clampGoal('4'), 4);
  assert.equal(clampGoal('чепуха'), core.DEFAULT_GOAL);
  assert.equal(clampGoal(undefined), core.DEFAULT_GOAL);
  assert.equal(clampGoal(2.4), 2);
});

test('goalForDays пересчитывает недельную цель на длину периода', () => {
  assert.equal(goalForDays(3, 7), 3);
  assert.equal(goalForDays(7, 7), 7);
  assert.equal(goalForDays(3, 30), 13);
  assert.equal(goalForDays(7, 30), 30);
  assert.equal(goalForDays(1, 28), 4);
  assert.equal(goalForDays(1, 1), 1, 'цель не может обнулиться');
});

test('createHabit и initialState дают валидную структуру', () => {
  const habit = createHabit('Бег', 1, { goal: 3 });
  assert.equal(habit.name, 'Бег');
  assert.equal(habit.color, core.PALETTE[1]);
  assert.deepEqual(habit.badge, { type: 'emoji', value: '🏃' });
  assert.equal(habit.goal, 3);
  assert.equal(habit.archivedAt, null);
  assert.match(habit.createdAt, /^\d{4}-\d{2}-\d{2}$/);

  const custom = createHabit('Своё дело', 0, { badge: { type: 'text', value: 'СД' }, goal: 99 });
  assert.deepEqual(custom.badge, { type: 'text', value: 'СД' });
  assert.equal(custom.goal, 7, 'слишком большая цель обрезается');

  const fresh = initialState();
  assert.equal(fresh.version, core.SCHEMA_VERSION);
  assert.equal(fresh.habits.length, 4);
  assert.equal(new Set(fresh.habits.map((h) => h.id)).size, 4);
  assert.equal(fresh.habits.every((h) => h.badge.type === 'emoji' && h.badge.value), true,
    'у всех стандартных достижений есть смайлик');
  assert.deepEqual(fresh.habits.map((h) => h.badge.value), ['🏃', '📚', '🍎', '💤']);
  assert.deepEqual(fresh.done, {});
});

/* --- Миграция --- */

test('migrate поднимает данные первой версии до текущей схемы', () => {
  const legacy = {
    habits: [{ id: 'a', name: 'Чтение', color: '#18a06a' }],
    done: { '2026-09-17': { a: true } },
  };

  const migrated = migrate(legacy);
  assert.equal(migrated.version, core.SCHEMA_VERSION);
  assert.deepEqual(migrated.habits[0].badge, { type: 'emoji', value: '📚' },
    'существующему достижению подобран смайлик');
  assert.equal(migrated.habits[0].goal, core.DEFAULT_GOAL);
  assert.equal(migrated.habits[0].archivedAt, null);
  assert.deepEqual(migrated.done, { '2026-09-17': { a: true } });
});

test('migrate переносит смайлик и цель из схемы v2', () => {
  const v2 = {
    version: 2,
    habits: [
      { id: 'a', name: 'Зарядка', icon: '🧘', color: '#2f6fed' },
      { id: 'b', name: 'Прогулка', icon: '' },
    ],
    done: {},
  };

  const migrated = migrate(v2);
  assert.deepEqual(migrated.habits[0].badge, { type: 'emoji', value: '🧘' }, 'выбранный ранее значок сохранён');
  assert.deepEqual(migrated.habits[1].badge, { type: 'emoji', value: '🚶' }, 'пустой значок подобран по названию');
});

test('migrate отбрасывает мусор и висячие отметки', () => {
  const dirty = {
    habits: [
      { id: 'a', name: 'Чтение', color: 'не цвет', badge: { type: 'text', value: '' }, goal: 42 },
      { id: 'a', name: 'Дубликат id' },
      { name: '   ' },
      null,
      'строка',
    ],
    done: {
      '2026-09-17': { a: true, ghost: true },
      'не дата': { a: true },
      '2026-09-18': { a: false },
      '2026-09-19': null,
    },
  };

  const migrated = migrate(dirty);
  assert.equal(migrated.habits.length, 2, 'остаются только именованные привычки');
  assert.equal(migrated.habits[0].color, core.PALETTE[0], 'некорректный цвет заменён из палитры');
  assert.deepEqual(migrated.habits[0].badge, { type: 'text', value: 'Ч' }, 'пустой текст значка — первая буква');
  assert.equal(migrated.habits[0].goal, 7, 'цель вне диапазона обрезана');
  assert.notEqual(migrated.habits[1].id, migrated.habits[0].id, 'дубликат id переписан');
  assert.deepEqual(migrated.done, { '2026-09-17': { a: true } });
});

test('migrate сохраняет архивные достижения', () => {
  const migrated = migrate({
    habits: [{ id: 'a', name: 'Бег', archivedAt: '2026-05-01' }, { id: 'b', name: 'Сон', archivedAt: 'вчера' }],
    done: { '2026-04-30': { a: true } },
  });

  assert.equal(migrated.habits[0].archivedAt, '2026-05-01');
  assert.equal(migrated.habits[1].archivedAt, null, 'некорректная дата архивации сбрасывается');
  assert.deepEqual(migrated.done, { '2026-04-30': { a: true } }, 'отметки архивной привычки сохранены');
});

test('migrate отвергает чужие данные', () => {
  assert.equal(migrate(null), null);
  assert.equal(migrate('строка'), null);
  assert.equal(migrate({}), null);
  assert.equal(migrate({ habits: [] }), null);
  assert.equal(migrate({ habits: {}, done: {} }), null);
});

/* --- Отметки --- */

test('setDone добавляет и убирает отметки, не оставляя пустых дней', () => {
  const state = stateWith();
  setDone(state, 'h1', TODAY, true);
  assert.equal(isDone(state, 'h1', TODAY), true);
  assert.equal(isDone(state, 'h2', TODAY), false);

  setDone(state, 'h2', TODAY, true);
  setDone(state, 'h1', TODAY, false);
  assert.deepEqual(state.done, { '2026-09-17': { h2: true } });

  setDone(state, 'h2', TODAY, false);
  assert.deepEqual(state.done, {}, 'день без отметок удаляется');

  setDone(state, 'h1', TODAY, false);
  assert.deepEqual(state.done, {}, 'снятие отметки с пустого дня безопасно');
});

/* --- Архив --- */

test('archiveHabit скрывает достижение, но сохраняет историю', () => {
  const state = stateWith({ '2026-09-16': { h1: true, h2: true } });

  archiveHabit(state, 'h1', TODAY);
  assert.equal(state.habits.length, 2, 'запись остаётся в данных');
  assert.equal(state.habits[0].archivedAt, '2026-09-17');
  assert.deepEqual(activeHabits(state).map((h) => h.id), ['h2']);
  assert.deepEqual(archivedHabits(state).map((h) => h.id), ['h1']);
  assert.deepEqual(state.done, { '2026-09-16': { h1: true, h2: true } }, 'отметки не тронуты');

  restoreHabit(state, 'h1');
  assert.equal(state.habits[0].archivedAt, null);
  assert.deepEqual(activeHabits(state).map((h) => h.id), ['h1', 'h2']);
});

test('removeHabit чистит и привычку, и её отметки', () => {
  const state = stateWith({
    '2026-09-16': { h1: true, h2: true },
    '2026-09-17': { h1: true },
  });

  removeHabit(state, 'h1');
  assert.deepEqual(state.habits.map((h) => h.id), ['h2']);
  assert.deepEqual(state.done, { '2026-09-16': { h2: true } });
});

/* --- Порядок --- */

test('reorderHabits переставляет достижение до и после цели', () => {
  const state = stateWith({}, 4);

  reorderHabits(state, 'h4', 'h1');
  assert.deepEqual(state.habits.map((h) => h.id), ['h4', 'h1', 'h2', 'h3']);

  reorderHabits(state, 'h4', 'h3', true);
  assert.deepEqual(state.habits.map((h) => h.id), ['h1', 'h2', 'h3', 'h4']);

  reorderHabits(state, 'h2', 'h2');
  assert.deepEqual(state.habits.map((h) => h.id), ['h1', 'h2', 'h3', 'h4'], 'перенос на себя ничего не меняет');

  reorderHabits(state, 'нет такого', 'h1');
  assert.deepEqual(state.habits.map((h) => h.id), ['h1', 'h2', 'h3', 'h4'], 'неизвестный id игнорируется');
});

test('moveHabit сдвигает на одну позицию среди активных', () => {
  const state = stateWith({}, 4, [{}, { archivedAt: '2026-01-01' }, {}, {}]);

  // Активные: h1, h3, h4 — архивная h2 в сдвиге не участвует.
  moveHabit(state, 'h1', 1);
  assert.deepEqual(activeHabits(state).map((h) => h.id), ['h3', 'h1', 'h4']);

  moveHabit(state, 'h4', -1);
  assert.deepEqual(activeHabits(state).map((h) => h.id), ['h3', 'h4', 'h1']);

  moveHabit(state, 'h3', -1);
  assert.deepEqual(activeHabits(state).map((h) => h.id), ['h3', 'h4', 'h1'], 'выше первой не уходит');

  moveHabit(state, 'h1', 1);
  assert.deepEqual(activeHabits(state).map((h) => h.id), ['h3', 'h4', 'h1'], 'ниже последней не уходит');

  assert.equal(state.habits.length, 4, 'архивная запись никуда не пропала');
});

/* --- Агрегация --- */

test('dayCount учитывает архивные, activeDayCount — только текущие', () => {
  const state = stateWith({ '2026-09-17': { h1: true, h2: true, ghost: true } }, 2, [{ archivedAt: '2026-09-10' }]);
  assert.equal(dayCount(state, TODAY), 2, 'история архивной привычки видна в ритме и карте года');
  assert.equal(activeDayCount(state, TODAY), 1);
  assert.equal(dayCount(state, addDays(TODAY, 1)), 0);
});

test('periodStats считает прогресс относительно целей', () => {
  const state = stateWith({
    '2026-09-14': { h1: true, h2: true },
    '2026-09-15': { h1: true, h2: true },
    '2026-09-16': { h1: true, h2: true },
    '2026-09-17': { h1: true },
  }, 2, [{ goal: 2 }, { goal: 5 }]);

  const stats = periodStats(state, periodDays('week', TODAY));
  assert.deepEqual(stats.perHabit.map((item) => [item.done, item.goal, item.hit, item.extra]), [
    [4, 2, true, 2],
    [3, 5, false, 0],
  ]);
  assert.equal(stats.total, 5, 'сверхплановые отметки не раздувают прогресс: min(4,2) + min(3,5)');
  assert.equal(stats.possible, 7);
  assert.equal(stats.marks, 7, 'все отметки посчитаны отдельно');
  assert.equal(stats.hits, 1);
  assert.equal(percent(stats.total, stats.possible), 71);
});

test('periodStats пересчитывает цели на месяц', () => {
  const state = stateWith({ '2026-09-01': { h1: true } }, 1, [{ goal: 3 }]);
  const stats = periodStats(state, periodDays('month', TODAY));
  assert.equal(stats.perHabit[0].goal, 13, '3 раза в неделю ≈ 13 раз в сентябре');
  assert.equal(stats.possible, 13);
  assert.equal(stats.perHabit[0].hit, false);
});

test('periodStats игнорирует архивные достижения', () => {
  const state = stateWith({ '2026-09-17': { h1: true, h2: true } }, 2, [{ archivedAt: '2026-09-01' }]);
  const stats = periodStats(state, periodDays('week', TODAY));
  assert.equal(stats.perHabit.length, 1);
  assert.equal(stats.perHabit[0].habit.id, 'h2');
  assert.equal(stats.bestDay.count, 1, 'лучший день считается по активным');
});

test('periodStats без отметок не выдумывает лучший день', () => {
  const stats = periodStats(stateWith(), periodDays('week', TODAY));
  assert.equal(stats.total, 0);
  assert.equal(stats.bestDay, null);
  assert.equal(percent(stats.total, stats.possible), 0);
});

test('streak считает дни подряд и терпит незакрытый сегодня', () => {
  const closedToday = stateWith({
    '2026-09-15': { h1: true },
    '2026-09-16': { h1: true },
    '2026-09-17': { h1: true },
  });
  assert.equal(streak(closedToday, TODAY), 3);

  const openToday = stateWith({
    '2026-09-15': { h1: true },
    '2026-09-16': { h1: true },
  });
  assert.equal(streak(openToday, TODAY), 2, 'пустой сегодня не обрывает серию');

  const broken = stateWith({
    '2026-09-13': { h1: true },
    '2026-09-15': { h1: true },
    '2026-09-16': { h1: true },
  });
  assert.equal(streak(broken, TODAY), 2, 'пропуск 14-го обрывает серию');

  const stale = stateWith({
    '2026-09-13': { h1: true },
    '2026-09-15': { h1: true },
  });
  assert.equal(streak(stale, TODAY), 0, 'серия, оборвавшаяся раньше вчера, обнуляется');
  assert.equal(streak(stateWith(), TODAY), 0);
});

test('percent округляет и защищён от нуля', () => {
  assert.equal(percent(1, 3), 33);
  assert.equal(percent(2, 3), 67);
  assert.equal(percent(0, 0), 0);
  assert.equal(percent(7, 7), 100);
});

test('plural выбирает русскую форму', () => {
  const day = (n) => plural(n, 'день', 'дня', 'дней');
  assert.equal(day(1), 'день');
  assert.equal(day(2), 'дня');
  assert.equal(day(5), 'дней');
  assert.equal(day(11), 'дней');
  assert.equal(day(21), 'день');
  assert.equal(day(112), 'дней');
  assert.equal(day(0), 'дней');
});

/* --- Ритм и год --- */

test('weekdayTotals раскладывает отметки по дням недели', () => {
  const state = stateWith({
    '2026-09-14': { h1: true, h2: true }, // понедельник
    '2026-09-17': { h1: true },           // четверг
    '2026-09-10': { h1: true },           // четверг прошлой недели
  });

  const totals = weekdayTotals(state, { weeks: 12, today: TODAY });
  assert.equal(totals.length, 7);
  assert.equal(totals[0], 2);
  assert.equal(totals[3], 2);
  assert.equal(totals[6], 0);
  assert.equal(totals.reduce((a, b) => a + b, 0), 4);
});

test('weekdayTotals не заглядывает за пределы окна', () => {
  const state = stateWith({ '2020-01-06': { h1: true } });
  assert.equal(weekdayTotals(state, { weeks: 12, today: TODAY })
    .reduce((a, b) => a + b, 0), 0);
});

test('weeklyTotals идёт от давних недель к текущей и знает недельную цель', () => {
  const state = stateWith({ '2026-09-17': { h1: true, h2: true } }, 2, [{ goal: 3 }, { goal: 4 }]);
  const weeks = weeklyTotals(state, { weeks: 12, today: TODAY });

  assert.equal(weeks.length, 12);
  assert.equal(iso(weeks[11].start), '2026-09-14');
  assert.equal(weeks[11].isCurrent, true);
  assert.equal(weeks[11].count, 2);
  assert.equal(weeks[11].goal, 7, 'цель недели — сумма целей активных достижений');
  assert.equal(weeks[10].count, 0);
  assert.equal(weeks.filter((week) => week.isCurrent).length, 1);
});

test('heatLevel остаётся в диапазоне 0..4', () => {
  assert.equal(heatLevel(0, 4), 0);
  assert.equal(heatLevel(1, 4), 1);
  assert.equal(heatLevel(4, 4), 4);
  assert.equal(heatLevel(9, 4), 4, 'больше максимума не ломает шкалу');
  assert.equal(heatLevel(2, 0), 0);
});

test('yearGrid покрывает год целиком, по разу на каждый день', () => {
  const grid = yearGrid(stateWith(), 2026, TODAY);

  const seen = new Set();
  let inYear = 0;
  grid.columns.forEach((column) => {
    assert.equal(column.days.length, 7);
    column.days.forEach((day) => {
      if (!day.inYear) return;
      inYear++;
      seen.add(iso(day.date));
    });
  });

  assert.equal(inYear, 365);
  assert.equal(seen.size, 365);
  assert.equal(grid.labels.filter(Boolean).length, 12, 'подписаны все 12 месяцев');
  assert.equal(iso(grid.columns[0].start), '2025-12-29', 'первая колонка начинается с понедельника');
});

test('yearGrid считает отметки и помечает сегодня', () => {
  const state = stateWith({
    '2026-09-17': { h1: true, h2: true },
    '2026-03-02': { h1: true },
    '2025-12-31': { h1: true },
  });

  const grid = yearGrid(state, 2026, TODAY);
  assert.equal(grid.total, 3, 'дни соседних лет не попадают в сумму');
  assert.equal(grid.activeDays, 2);

  const days = grid.columns.flatMap((column) => column.days);
  const today = days.find((day) => day.isToday);
  assert.equal(iso(today.date), '2026-09-17');
  assert.equal(today.level, 4, 'обе привычки за день — максимальный уровень');
  assert.equal(days.filter((day) => day.isToday).length, 1);
});

test('в високосном году 366 дней', () => {
  const grid = yearGrid(stateWith(), 2024, new Date(2024, 5, 1));
  const inYear = grid.columns.flatMap((c) => c.days).filter((day) => day.inYear);
  assert.equal(inYear.length, 366);
});
