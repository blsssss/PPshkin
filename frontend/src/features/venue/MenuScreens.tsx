import { Button, Switch } from '@maxhub/max-ui';
import { useQuery } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router';
import { isApiError } from '../../api/errors.ts';
import { userMessage } from '../../api/messages.ts';
import { formatKcal, formatPrice } from '../../shared/format.ts';
import { useOnline } from '../../shared/useOnline.ts';
import { useUnsavedChanges } from '../../shared/useUnsavedChanges.tsx';
import { ActionBar } from '../../shared/ui/ActionBar.tsx';
import { Chip, ChipRow } from '../../shared/ui/Chip.tsx';
import { ConfirmSheet } from '../../shared/ui/ConfirmSheet.tsx';
import { Field } from '../../shared/ui/Field.tsx';
import { Label } from '../../shared/ui/Label.tsx';
import { Notice } from '../../shared/ui/Notice.tsx';
import { Page } from '../../shared/ui/Page.tsx';
import { ScreenHeader } from '../../shared/ui/ScreenHeader.tsx';
import { ScreenState } from '../../shared/ui/ScreenState.tsx';
import { Skeleton } from '../../shared/ui/Skeleton.tsx';
import { useToast } from '../../shared/ui/Toast.tsx';
import { MENU_CATEGORY_LABELS, TAG_LABELS, type MenuCategory, type Tag } from '../../shared/vocabulary.ts';
import { readImportDraft } from './importDraft.ts';
import {
  emptyItemForm,
  groupMenu,
  itemFieldFromPath,
  itemFormFrom,
  itemPatch,
  MAX_ITEM_TAGS,
  MENU_CATEGORY_ORDER,
  normalizeName,
  validateItem,
  type ItemErrors,
  type ItemField,
  type ItemForm,
  type MenuItem,
  type MenuItemInput,
} from './model.ts';
import {
  fetchImport,
  importKey,
  useDeleteItem,
  useSaveItem,
  useToggleAvailability,
  useVenue,
  useVenueMenu,
  useVenueNotFoundRedirect,
} from './queries.ts';
import styles from './Venue.module.css';
import { haptic } from '../../max/bridge.ts';
import { useLeave } from '../../shared/appHistory.ts';

const SEARCH_FROM = 15;
const ALL_TAGS = Object.keys(TAG_LABELS) as Tag[];
const CATEGORY_OPTIONS = MENU_CATEGORY_ORDER.map((value) => ({ value, label: MENU_CATEGORY_LABELS[value] }));

function PendingImportBanner({ venueId }: { venueId: number }) {
  const navigate = useNavigate();
  const [draft] = useState(readImportDraft);
  const pending = draft !== null && draft.venueId === venueId ? draft.importId : null;
  const status = useQuery({
    queryKey: importKey(pending ?? 0),
    queryFn: () => fetchImport(pending ?? 0),
    enabled: pending !== null,
    retry: false,
  });
  if (pending === null) return null;
  const state = status.data?.status;
  if (state !== 'processing' && state !== 'ready') return null;
  return (
    <Notice>
      Есть незавершённый импорт меню.{' '}
      <button
        type="button"
        className={styles.inlineButton}
        onClick={() => {
          void navigate(`/venue/menu/import/${String(pending)}`);
        }}
      >
        Продолжить
      </button>
    </Notice>
  );
}

function MenuRow({ item }: { item: MenuItem }) {
  const navigate = useNavigate();
  const toast = useToast();
  const toggle = useToggleAvailability();
  return (
    <li className={item.isAvailable ? styles.item : `${styles.item} ${styles.hidden}`}>
      <div className={styles.itemColumn}>
        <button
          type="button"
          className={styles.itemMain}
          onClick={() => {
            void navigate(`/venue/menu/${String(item.id)}`);
          }}
        >
          <span className={styles.itemName}>{item.name}</span>
          <span className={styles.meta}>
            {formatPrice(item.priceRub)}, {formatKcal(item.kcal)}
            {item.weightG !== null && `, ${String(item.weightG)} г`}
          </span>
          {(!item.isAvailable || item.nutritionSource === 'estimate') && (
            <span className={styles.badges}>
              {!item.isAvailable && <Label tone="pink">Скрыто</Label>}
              {item.nutritionSource === 'estimate' && <Label tone="cyan">Ккал по оценке</Label>}
            </span>
          )}
        </button>
        {item.isAvailable && (
          <button
            type="button"
            className={styles.inlineButton}
            aria-label={`Сделать горящей: ${item.name}`}
            onClick={() => {
              void navigate(`/venue/deals/new?itemId=${String(item.id)}`);
            }}
          >
            Сделать горящей
          </button>
        )}
      </div>
      <label className={styles.switchLabel}>
        <Switch
          checked={item.isAvailable}
          disabled={toggle.isPending}
          aria-label={`${item.name}: в продаже`}
          onChange={(event) => {
            toggle.mutate(
              { id: item.id, isAvailable: event.target.checked },
              {
                onError: (error) => {
                  toast.show(userMessage(error), { tone: 'error' });
                },
              },
            );
          }}
        />
        В продаже
      </label>
    </li>
  );
}

export function MenuScreen() {
  const navigate = useNavigate();
  const venue = useVenue();
  const menu = useVenueMenu(venue.data !== undefined && venue.data !== null);
  useVenueNotFoundRedirect();
  const [query, setQuery] = useState('');
  const items = menu.data ?? [];
  const filtered =
    items.length > SEARCH_FROM && query.trim().length > 0
      ? items.filter((item) => normalizeName(item.name).includes(normalizeName(query)))
      : items;
  const go = (path: string) => () => {
    void navigate(path);
  };

  return (
    <Page>
      <ScreenHeader title="Меню" back="/venue" />
      {venue.data !== undefined && venue.data !== null && <PendingImportBanner venueId={venue.data.id} />}
      {(venue.isPending || (menu.isPending && menu.fetchStatus !== 'idle')) && (
        <Skeleton height={64} count={5} />
      )}
      {venue.isError && (
        <ScreenState
          status="error"
          title="Не удалось загрузить заведение"
          description={userMessage(venue.error)}
          error={venue.error}
          action={{
            label: 'Повторить',
            onClick: () => {
              void venue.refetch();
            },
          }}
        />
      )}
      {menu.isError && (
        <ScreenState
          status="error"
          title="Не удалось загрузить меню"
          description={userMessage(menu.error)}
          error={menu.error}
          action={{
            label: 'Повторить',
            onClick: () => {
              void menu.refetch();
            },
          }}
        />
      )}
      {menu.data !== undefined && items.length === 0 && (
        <ScreenState
          status="empty"
          title="Меню пока пустое"
          description="Загрузите фото меню или вставьте текст, и мы распознаем позиции."
          action={{ label: 'Фото меню', onClick: go('/venue/menu/import?mode=photo') }}
          secondaryAction={{ label: 'Вставить текст', onClick: go('/venue/menu/import?mode=text') }}
          tertiaryAction={{ label: 'Добавить вручную', onClick: go('/venue/menu/new') }}
        />
      )}
      {items.length > 0 && (
        <>
          <div className={styles.row}>
            <Button size="medium" stretched onClick={go('/venue/menu/new')}>
              Добавить позицию
            </Button>
            <Button size="medium" variant="secondary" stretched onClick={go('/venue/menu/import')}>
              Загрузить меню
            </Button>
          </div>
          {items.length > SEARCH_FROM && (
            <Field
              label="Поиск по названию"
              type="search"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
              }}
            />
          )}
          {filtered.length === 0 && <p className={styles.muted}>Ничего не нашли.</p>}
          {groupMenu(filtered).map((group) => (
            <section
              key={group.category}
              className={styles.group}
              aria-label={MENU_CATEGORY_LABELS[group.category]}
            >
              <h2 className={styles.sectionTitle}>{MENU_CATEGORY_LABELS[group.category]}</h2>
              <ul className={styles.items}>
                {group.items.map((item) => (
                  <MenuRow key={item.id} item={item} />
                ))}
              </ul>
            </section>
          ))}
        </>
      )}
    </Page>
  );
}

export function ItemFields({
  form,
  errors,
  onChange,
}: {
  form: ItemForm;
  errors: ItemErrors;
  onChange: <K extends ItemField>(key: K, value: ItemForm[K]) => void;
}): ReactNode {
  const text = (
    key: ItemField,
    label: string,
    props: { inputMode?: 'numeric' | 'decimal'; hint?: string } = {},
  ) => (
    <Field
      key={key}
      label={label}
      value={String(form[key])}
      inputMode={props.inputMode}
      hint={props.hint}
      onChange={(event) => {
        onChange(key, event.target.value);
      }}
      error={errors[key]}
    />
  );
  return (
    <>
      {text('name', 'Название')}
      <label className={styles.label}>
        Категория
        <select
          className={styles.select}
          value={form.category ?? ''}
          aria-invalid={errors.category !== undefined}
          onChange={(event) => {
            onChange('category', event.target.value === '' ? null : (event.target.value as MenuCategory));
          }}
        >
          <option value="">Не выбрана</option>
          {CATEGORY_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      {errors.category !== undefined && <p className={styles.error}>{errors.category}</p>}
      <div className={styles.grid}>
        <div className={styles.field}>
          {text('priceRub', 'Цена, ₽', {
            inputMode: 'numeric',
            ...(form.priceRub.trim().length === 0 && errors.priceRub === undefined
              ? { hint: 'Укажите цену' }
              : {}),
          })}
        </div>
        <div className={styles.field}>{text('weightG', 'Вес, г', { inputMode: 'numeric' })}</div>
        <div className={styles.field}>{text('kcal', 'Ккал', { inputMode: 'numeric' })}</div>
        <div className={styles.field}>{text('proteinG', 'Белки, г', { inputMode: 'decimal' })}</div>
        <div className={styles.field}>{text('fatG', 'Жиры, г', { inputMode: 'decimal' })}</div>
        <div className={styles.field}>{text('carbsG', 'Углеводы, г', { inputMode: 'decimal' })}</div>
      </div>
      {text('description', 'Описание')}
      <ChipRow label={`Признаки, до ${String(MAX_ITEM_TAGS)}`}>
        {ALL_TAGS.map((tag) => {
          const pressed = form.tags.includes(tag);
          return (
            <Chip
              key={tag}
              pressed={pressed}
              toggles
              disabled={!pressed && form.tags.length >= MAX_ITEM_TAGS}
              onClick={() => {
                onChange('tags', pressed ? form.tags.filter((item) => item !== tag) : [...form.tags, tag]);
              }}
            >
              {TAG_LABELS[tag]}
            </Chip>
          );
        })}
      </ChipRow>
      {errors.tags !== undefined && <p className={styles.error}>{errors.tags}</p>}
    </>
  );
}

function sameItemForm(a: ItemForm, b: ItemForm): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function ItemEditor({ item }: { item: MenuItem | null }) {
  const navigate = useNavigate();
  const leaveTo = useLeave();
  const toast = useToast();
  const online = useOnline();
  const save = useSaveItem();
  const remove = useDeleteItem();
  const [initial] = useState(() => (item === null ? emptyItemForm() : itemFormFrom(item)));
  const [form, setForm] = useState(initial);
  const [errors, setErrors] = useState<ItemErrors>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const { prompt, release } = useUnsavedChanges(!sameItemForm(form, initial));

  const change = <K extends ItemField>(key: K, value: ItemForm[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: undefined }));
  };

  const leave = () => {
    release();
    leaveTo('/venue/menu');
  };

  const gone = () => {
    toast.show('Позиция не найдена, возможно, её уже удалили', { tone: 'error' });
    leave();
  };

  const submit = () => {
    const result = validateItem(form);
    setErrors(result.errors);
    setNotice(null);
    if (result.input === null) return;
    const request: { create: MenuItemInput } | { id: number; patch: Partial<MenuItemInput> } =
      item === null ? { create: result.input } : { id: item.id, patch: itemPatch(result.input, item) };
    if ('patch' in request && Object.keys(request.patch).length === 0) {
      leave();
      return;
    }
    save.mutate(request, {
      onSuccess: () => {
        toast.show(item === null ? 'Позиция добавлена' : 'Сохранено');
        leave();
      },
      onError: (error) => {
        haptic.error();
        if (isApiError(error, 'menu_item_not_found')) {
          gone();
          return;
        }
        if (isApiError(error, 'deal_price_not_lower')) {
          setErrors({
            priceRub: 'Есть горящее предложение по цене не ниже новой. Снимите его или укажите цену выше',
          });
          return;
        }
        if (isApiError(error, 'validation_failed')) {
          const mapped: ItemErrors = {};
          for (const [path, message] of Object.entries(error.fieldErrors)) {
            const field = itemFieldFromPath(path);
            if (field !== null) mapped[field] ??= message;
          }
          if (Object.keys(mapped).length > 0) {
            setErrors(mapped);
            return;
          }
        }
        setNotice(userMessage(error));
      },
    });
  };

  return (
    <>
      {item !== null && (
        <p className={styles.muted}>
          {item.nutritionSource === 'venue'
            ? 'Калорийность указана заведением'
            : 'Калорийность оценена автоматически, проверьте её'}
        </p>
      )}
      <ItemFields form={form} errors={errors} onChange={change} />
      <label className={styles.switchRowInline}>
        <Switch
          checked={form.isAvailable}
          onChange={(event) => {
            change('isAvailable', event.target.checked);
          }}
        />
        В продаже
      </label>
      {notice !== null && <Notice tone="error">{notice}</Notice>}
      <ActionBar sends>
        <Button size="large" stretched loading={save.isPending} disabled={!online} onClick={submit}>
          {item === null ? 'Добавить позицию' : 'Сохранить'}
        </Button>
        {item !== null && item.isAvailable && (
          <Button
            size="large"
            variant="secondary"
            stretched
            onClick={() => {
              void navigate(`/venue/deals/new?itemId=${String(item.id)}`);
            }}
          >
            Сделать горящей
          </Button>
        )}
        {item !== null && (
          <Button
            size="large"
            variant="secondary"
            stretched
            disabled={save.isPending}
            onClick={() => {
              setConfirm(true);
            }}
          >
            Удалить из меню
          </Button>
        )}
      </ActionBar>
      {item !== null && (
        <ConfirmSheet
          open={confirm}
          title="Удалить позицию?"
          description="Позиция пропадёт из меню и каталога, горящее предложение по ней будет снято."
          confirmLabel="Удалить"
          destructive
          onCancel={() => {
            setConfirm(false);
          }}
          onConfirm={async () => {
            try {
              await remove.mutateAsync(item.id);
              setConfirm(false);
              toast.show('Позиция удалена');
              leave();
            } catch (error) {
              haptic.error();
              setConfirm(false);
              if (isApiError(error, 'menu_item_not_found')) gone();
              else setNotice(userMessage(error));
            }
          }}
        />
      )}
      {prompt}
    </>
  );
}

export function NewItemScreen() {
  useVenueNotFoundRedirect();
  return (
    <Page>
      <ScreenHeader title="Новая позиция" back="/venue/menu" />
      <ItemEditor item={null} />
    </Page>
  );
}

export function EditItemScreen() {
  const navigate = useNavigate();
  const { itemId } = useParams();
  const menu = useVenueMenu();
  useVenueNotFoundRedirect();
  const item = menu.data?.find((entry) => String(entry.id) === itemId) ?? null;
  return (
    <Page>
      <ScreenHeader title="Позиция" back="/venue/menu" />
      {menu.isPending && <Skeleton height={56} count={6} />}
      {menu.isError && (
        <ScreenState
          status="error"
          title="Не удалось загрузить меню"
          description={userMessage(menu.error)}
          error={menu.error}
          action={{
            label: 'Повторить',
            onClick: () => {
              void menu.refetch();
            },
          }}
        />
      )}
      {menu.data !== undefined && item === null && (
        <ScreenState
          status="empty"
          title="Позиция не найдена, возможно, её уже удалили"
          action={{
            label: 'К меню',
            onClick: () => {
              void navigate('/venue/menu');
            },
          }}
        />
      )}
      {item !== null && <ItemEditor key={item.id} item={item} />}
    </Page>
  );
}
