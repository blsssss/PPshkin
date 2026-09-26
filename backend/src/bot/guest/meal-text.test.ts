import { describe, expect, it } from 'vitest';
import { classifyText, parseFixInput, parseKcalTarget, parseManualEntry } from './meal-text.ts';

describe('parseManualEntry', () => {
  it.each([
    ['Сырники 350', { title: 'Сырники', kcal: 350 }],
    ['Латте 180 ккал', { title: 'Латте', kcal: 180 }],
    ['латте 180ккал.', { title: 'Латте', kcal: 180 }],
    ['Кофе 3в1 120 kcal', { title: 'Кофе 3в1', kcal: 120 }],
    ['Сырники, 350', { title: 'Сырники', kcal: 350 }],
    ['Борщ - 300', { title: 'Борщ', kcal: 300 }],
    ['съел сырники 350', { title: 'Сырники', kcal: 350 }],
    ['На обед съела плов 600', { title: 'Плов', kcal: 600 }],
    ['Суп 5000', { title: 'Суп', kcal: 5000 }],
    ['Чай 1', { title: 'Чай', kcal: 1 }],
  ])('reads %s', (text, entry) => {
    expect(parseManualEntry(text)).toEqual(entry);
  });

  it.each([
    'Сырники',
    'Суп 0',
    'Суп 5001',
    'Суп 12000',
    '350',
    '100 200',
    'съел 300',
    'Борщ 300 г',
    `${'а'.repeat(201)} 300`,
  ])('rejects %s', (text) => {
    expect(parseManualEntry(text)).toBeNull();
  });
});

describe('parseFixInput', () => {
  it('reads calories alone or with a new name', () => {
    expect(parseFixInput('300')).toEqual({ kcal: 300 });
    expect(parseFixInput(' 250 ккал ')).toEqual({ kcal: 250 });
    expect(parseFixInput('Борщ 300')).toEqual({ title: 'Борщ', kcal: 300 });
  });

  it.each(['0', '5001', 'Борщ', 'как-то так'])('rejects %s', (text) => {
    expect(parseFixInput(text)).toBeNull();
  });
});

describe('parseKcalTarget', () => {
  it.each([
    ['1900', 1900],
    ['1 900', 1900],
    ['2500 ккал', 2500],
    ['1000', 1000],
    ['5000', 5000],
  ])('reads %s', (text, kcal) => {
    expect(parseKcalTarget(text)).toBe(kcal);
  });

  it.each(['999', '5001', '1900.5', 'две тысячи', '', '19000'])('rejects %s', (text) => {
    expect(parseKcalTarget(text)).toBeNull();
  });
});

describe('classifyText', () => {
  it.each([
    ['Сырники 350', 'manual'],
    ['съел борщ', 'recognize'],
    ['СЪЕЛА борщ', 'recognize'],
    ['поел', 'recognize'],
    ['Поела пасту', 'recognize'],
    ['выпил латте', 'recognize'],
    ['Выпила чай', 'recognize'],
    ['перекусил яблоком', 'recognize'],
    ['перекусила орехами', 'recognize'],
    ['на завтрак овсянка', 'recognize'],
    ['На обед суп', 'recognize'],
    ['на ужин рыба', 'recognize'],
    ['съел, кажется, всё', 'recognize'],
    ['привет', 'help'],
    ['Привет!', 'help'],
    ['спасибо большое', 'help'],
    ['Помощь', 'help'],
    ['help', 'help'],
    ['меню', 'help'],
    ['ё', 'help'],
    ['а'.repeat(501), 'help'],
    ['съешь ещё этих булок', 'confirm'],
    ['ёжик', 'confirm'],
    ['на завтраке был омлет', 'confirm'],
    ['сЪелбы', 'confirm'],
    ['а'.repeat(500), 'confirm'],
  ])('treats %s as %s', (text, kind) => {
    expect(classifyText(text).kind).toBe(kind);
  });

  it('carries the manual entry', () => {
    expect(classifyText('Сырники 350')).toEqual({ kind: 'manual', entry: { title: 'Сырники', kcal: 350 } });
  });
});
