alter table venues add column photo_key text check (photo_key ~ '^[0-9a-f]{64}$');
alter table menu_items add column photo_key text check (photo_key ~ '^[0-9a-f]{64}$');
create index venues_photo_key on venues (photo_key) where photo_key is not null;
create index menu_items_photo_key on menu_items (photo_key) where photo_key is not null;
