begin;

truncate table bookings, offers, deals, menu_imports, menu_items, venues, meals, consents, chat_states, processed_updates, users
  restart identity cascade;

insert into users (id, first_name, username, kcal_target, goal, location_lat, location_lon, location_updated_at)
select 900000 + n, 'Заведение ' || n, 'load_owner_' || n, 2000, 'maintain', null, null, null
from generate_series(1, 10) as n;

insert into users (id, first_name, username, kcal_target, goal, location_lat, location_lon, location_updated_at)
select 1000000 + n, 'Гость ' || n, 'load_guest_' || n, 1800 + (n % 5) * 100,
  (array['lose', 'maintain', 'gain'])[1 + n % 3], 55.7887, 49.1221, now()
from generate_series(1, 500) as n;

insert into users (id, first_name, username, kcal_target, goal)
select 1100000 + n, 'Гость на погашение ' || n, 'load_redeem_' || n, 2000, 'maintain'
from generate_series(1, 100) as n;

insert into consents (user_id, kind, version, channel)
select id, 'personal_data', '2026-09-25', 'miniapp'
from users;

insert into venues (id, owner_id, name, address, category, lat, lon, opens_at, closes_at, timezone)
select n, 900000 + n, 'Нагрузочное заведение ' || n, 'Казань, улица Баумана, ' || n,
  (array['coffee', 'bakery', 'cafe', 'canteen', 'restaurant'])[1 + n % 5],
  55.7887 + (n - 5) * 0.0015, 49.1221 + (n % 3 - 1) * 0.0025,
  '00:00', '00:00', 'Europe/Moscow'
from generate_series(1, 10) as n;

insert into menu_items (id, venue_id, name, description, category, price_rub, weight_g, kcal, protein_g, fat_g, carbs_g,
  nutrition_source, tags)
select (v - 1) * 40 + k, v, 'Блюдо ' || k || ' заведения ' || v, null,
  (array['breakfast', 'main', 'soup', 'salad', 'side', 'bakery', 'dessert', 'snack', 'drink'])[1 + k % 9],
  150 + (k * 37) % 450, 150 + (k * 13) % 300, 120 + (k * 53 + v * 17) % 680,
  5 + (k * 7) % 35, 3 + (k * 5) % 25, 10 + (k * 11) % 70, 'venue',
  array[(array['grain', 'meat', 'soup', 'salad', 'vegetables', 'pastry', 'dessert', 'fish', 'drink'])[1 + k % 9],
    (array['light', 'hearty', 'high_protein', 'vegetarian'])[1 + (k + v) % 4]]
from generate_series(1, 10) as v, generate_series(1, 40) as k;

insert into deals (id, venue_id, menu_item_id, price_rub, quantity_total, quantity_left, starts_at, ends_at)
select v, v, (v - 1) * 40 + 1, 99, 20, 20, now() - interval '1 hour', now() + interval '1 day'
from generate_series(1, 10) as v;

insert into meals (user_id, title, kcal_min, kcal_max, protein_g, fat_g, carbs_g, tags, source, confidence, eaten_at)
select 1000000 + n, (array['Овсянка с бананом', 'Борщ со сметаной', 'Курица с рисом', 'Салат с тунцом'])[1 + (n + d) % 4],
  300 + (n * 7) % 200, 400 + (n * 7) % 200, 20, 12, 45,
  array[(array['grain', 'soup', 'poultry', 'fish'])[1 + (n + d) % 4]], 'manual', null,
  now() - make_interval(days => d, hours => 2)
from generate_series(1, 500) as n, generate_series(0, 2) as d;

insert into bookings (user_id, venue_id, menu_item_id, code, item_name, price_rub, kcal, status, expires_at)
select 1100000 + 1 + (n - 1) % 100, i.venue_id, i.id,
  (select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', ((n >> (5 * k)) & 31) + 1, 1), '' order by k)
    from generate_series(0, 5) as k),
  i.name, i.price_rub, i.kcal, 'active', now() + interval '1 day'
from generate_series(1, 1200) as n
join menu_items i on i.id = ((n - 1) % 10) * 40 + 2 + ((n - 1) / 10) % 39;

select setval(pg_get_serial_sequence('venues', 'id'), (select max(id) from venues));
select setval(pg_get_serial_sequence('menu_items', 'id'), (select max(id) from menu_items));
select setval(pg_get_serial_sequence('deals', 'id'), (select max(id) from deals));

commit;

analyze;
