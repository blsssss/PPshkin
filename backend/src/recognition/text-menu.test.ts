import { describe, expect, it } from 'vitest';
import type { Tag } from '../domain/vocabulary.ts';
import { CATEGORY_DEFAULTS } from './reference.ts';
import { parseTextMenu } from './text-menu.ts';

const EM_DASH = '\u{2014}';
const EN_DASH = '\u{2013}';

describe('parseTextMenu', () => {
  it.each([
    ['Эклер 150', 'Эклер', 150, null, 'dessert'],
    ['Эклер ..... 150 ₽', 'Эклер', 150, null, 'dessert'],
    ['Капучино 250 мл - 190 р.', 'Капучино', 190, null, 'drink'],
    ['Сырники со сметаной 180/30 г 320 руб', 'Сырники со сметаной', 320, 210, 'breakfast'],
    [`Борщ ${EM_DASH} 300 г ${EM_DASH} 290`, 'Борщ', 290, 300, 'soup'],
    ['Круассан с миндалём 95г 210₽', 'Круассан с миндалём', 210, 95, 'bakery'],
    ['Паста с курицей 320 г 450 руб.', 'Паста с курицей', 450, 320, 'main'],
    [`Солянка${EN_DASH}350гр.${EN_DASH}380`, 'Солянка', 380, 350, 'soup'],
    ['Салат греческий: 200 g, 390 рублей', 'Салат греческий', 390, 200, 'salad'],
    ['Сырники со сметаной 3 шт. 340 ₽', 'Сырники со сметаной', 340, null, 'breakfast'],
    ['Стейк рибай 1 200 ₽', 'Стейк рибай', 1200, null, 'main'],
    ['2. Омлет с сыром, 200г ........ 350', 'Омлет с сыром', 350, 200, 'breakfast'],
    ['Лимонад домашний 0,5 л 250', 'Лимонад домашний', 250, null, 'drink'],
    ['Морс ягодный 300ml 150.00', 'Морс ягодный', 150, null, 'drink'],
    ['\u{2022} Медовик (120 г) 260', 'Медовик', 260, 120, 'dessert'],
  ])('reads %j', (line, name, priceRub, weightG, category) => {
    expect(parseTextMenu(line)).toEqual([expect.objectContaining({ name, priceRub, weightG, category })]);
  });

  it.each(['Салаты', 'Напитки:', 'Капучино 250 мл', 'Паста 320 г', '', '   ', '350'])(
    'skips %j because it has no dish with a price',
    (line) => {
      expect(parseTextMenu(line)).toEqual([]);
    },
  );

  it('reads a pasted menu with headings, blank lines and Windows line breaks', () => {
    const menu = [
      'Кофейня «Луна»',
      '',
      'Выпечка',
      'Круассан 70 г 150',
      'Эклер 150',
      '',
      'Напитки',
      'Латте 350 мл 230',
    ].join('\r\n');
    expect(parseTextMenu(menu).map((item) => [item.name, item.category, item.priceRub])).toEqual([
      ['Круассан', 'bakery', 150],
      ['Эклер', 'dessert', 150],
      ['Латте', 'drink', 230],
    ]);
  });

  it('takes nutrition from the reference dish and scales it to the printed weight', () => {
    const [plain] = parseTextMenu('Эклер 150');
    expect(plain).toMatchObject({ kcal: 260, proteinG: 4, fatG: 15, carbsG: 27, description: null });
    const [heavier] = parseTextMenu('Эклер 140 г 180');
    expect(heavier).toMatchObject({ weightG: 140, kcal: 520, proteinG: 8, fatG: 30, carbsG: 54 });
  });

  it('falls back to category defaults when no reference dish matches', () => {
    const [soup] = parseTextMenu('Суп дня 300 г 250');
    const defaults = CATEGORY_DEFAULTS.soup;
    expect(soup).toMatchObject({
      category: 'soup',
      kcal: defaults.kcal,
      proteinG: defaults.proteinG,
      fatG: defaults.fatG,
      carbsG: defaults.carbsG,
      tags: ['soup'],
    });
    expect(parseTextMenu('Фирменное блюдо 520')[0]).toMatchObject({
      category: 'main',
      kcal: CATEGORY_DEFAULTS.main.kcal,
    });
  });

  it.each<[string, Tag[]]>([
    ['Паста с курицей и грибами 450', ['poultry']],
    ['Бефстроганов из говядины 520', ['meat']],
    ['Стейк из форели 690', ['fish']],
    ['Паста с креветками 590', ['seafood']],
    ['Тост с моцареллой 290', ['cheese']],
    ['Торт шоколадный 310', ['chocolate']],
    ['Чизкейк с малиной 330', ['berries']],
    ['Кофе по-восточному 200', ['coffee', 'drink']],
    ['Чай травяной 150', ['tea', 'drink']],
    ['Сок яблочный 180', ['juice', 'drink']],
  ])('tags %j by keywords', (line, tags) => {
    expect(parseTextMenu(line)[0]?.tags).toEqual(expect.arrayContaining(tags));
  });

  it('combines reference tags with keyword tags without duplicates', () => {
    expect(parseTextMenu('Капучино 190')[0]?.tags).toEqual(['coffee', 'drink', 'dairy']);
    expect(parseTextMenu('Круассан с ветчиной и сыром 260')[0]?.tags).toEqual(['pastry', 'meat', 'cheese']);
  });

  it('keeps prices and weights inside the database limits', () => {
    const [cake] = parseTextMenu('Торт Наполеон целый 6000 г 250000');
    expect(cake).toMatchObject({ priceRub: null, weightG: null, kcal: 445 });
  });

  it('drops repeated names and keeps at most 80 items', () => {
    const letter = (code: number) => String.fromCharCode(0x430 + code);
    const lines = Array.from(
      { length: 90 },
      (_, index) => `Блюдо ${letter(index % 32)}${letter(Math.floor(index / 32))} 100`,
    );
    const menu = ['Эклер 150', 'ЭКЛЕР 170', ...lines].join('\n');
    const items = parseTextMenu(menu);
    expect(items).toHaveLength(80);
    expect(items[0]).toMatchObject({ name: 'Эклер', priceRub: 150 });
    expect(items.filter((item) => item.name.toLowerCase() === 'эклер')).toHaveLength(1);
  });
});
