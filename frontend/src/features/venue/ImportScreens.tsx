import { Button, Spinner } from '@maxhub/max-ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { unwrap } from '../../api/client.ts';
import { ApiError, isApiError } from '../../api/errors.ts';
import { api } from '../../api/index.ts';
import { userMessage } from '../../api/messages.ts';
import { formatKcal, formatPrice, plural } from '../../shared/format.ts';
import { ImageDecodeError, prepareImage } from '../../shared/image.ts';
import { useOnline } from '../../shared/useOnline.ts';
import { useUnsavedChanges } from '../../shared/useUnsavedChanges.tsx';
import { ActionBar } from '../../shared/ui/ActionBar.tsx';
import { Label } from '../../shared/ui/Label.tsx';
import { Notice } from '../../shared/ui/Notice.tsx';
import { Page } from '../../shared/ui/Page.tsx';
import { ScreenHeader } from '../../shared/ui/ScreenHeader.tsx';
import { ScreenState } from '../../shared/ui/ScreenState.tsx';
import { SegmentedControl } from '../../shared/ui/SegmentedControl.tsx';
import { Skeleton } from '../../shared/ui/Skeleton.tsx';
import { useToast } from '../../shared/ui/Toast.tsx';
import { MENU_CATEGORY_LABELS } from '../../shared/vocabulary.ts';
import {
  applyPayload,
  buildRows,
  clearImportDraft,
  mapApplyErrors,
  MAX_APPLY_ITEMS,
  readImportDraft,
  rowErrors,
  saveImportDraft,
  type ReviewRow,
} from './importDraft.ts';
import type { ItemErrors, ItemField, ItemForm, MenuImport } from './model.ts';
import { ItemFields } from './MenuScreens.tsx';
import {
  fetchImport,
  importKey,
  MENU_KEY,
  startPhotoImport,
  startTextImport,
  useVenue,
  useVenueMenu,
  useVenueNotFoundRedirect,
} from './queries.ts';
import styles from './Venue.module.css';

const PHOTO_MAX_SIDE = 2048;
const TEXT_LIMIT = 8000;
const POLL_MS = 2000;
const POLL_LIMIT_MS = 3 * 60_000;
const TEXT_EXAMPLE = 'Капучино 250 мл - 190 р.\nСырники со сметаной 180/30 г 320 руб';

type Mode = 'photo' | 'text';

function importErrorText(error: unknown): string {
  if (error instanceof ApiError && (error.code === 'rate_limited' || error.status === 429)) {
    return error.retryAfterSeconds !== null && error.retryAfterSeconds > 0
      ? `Слишком много загрузок подряд, повторите через ${String(error.retryAfterSeconds)} с`
      : 'Слишком много загрузок подряд, повторите позже';
  }
  if (error instanceof ImageDecodeError) return 'Не удалось прочитать фото, выберите другой файл';
  if (isApiError(error, 'image_required') || isApiError(error, 'image_empty')) return 'Выберите фото меню';
  if (isApiError(error, 'invalid_multipart') || isApiError(error, 'upload_too_many_parts')) {
    return 'Не удалось отправить фото, выберите один файл и попробуйте ещё раз';
  }
  return userMessage(error);
}

export function ImportStartScreen() {
  const navigate = useNavigate();
  const online = useOnline();
  const [params] = useSearchParams();
  const venue = useVenue();
  useVenueNotFoundRedirect();
  const [mode, setMode] = useState<Mode>(params.get('mode') === 'text' ? 'text' : 'photo');
  const [text, setText] = useState('');
  const [failure, setFailure] = useState<{ text: string; existing: number | null } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const textId = useId();

  const start = useMutation({
    mutationFn: async (input: { file: File } | { text: string }) => {
      if ('text' in input) return startTextImport(input.text);
      return startPhotoImport(await prepareImage(input.file, PHOTO_MAX_SIDE));
    },
    onSuccess: (created) => {
      const venueId = venue.data?.id;
      if (venueId !== undefined) saveImportDraft({ venueId, importId: created.id, rows: null });
      void navigate(`/venue/menu/import/${String(created.id)}`);
    },
    onError: (error) => {
      const draft = readImportDraft();
      setFailure({
        text: importErrorText(error),
        existing: isApiError(error, 'import_in_progress') && draft !== null ? draft.importId : null,
      });
    },
  });

  const trimmed = text.trim();
  return (
    <Page>
      <ScreenHeader title="Загрузить меню" back="/venue/menu" />
      <SegmentedControl
        label="Способ"
        options={[
          { value: 'photo', label: 'Фото меню' },
          { value: 'text', label: 'Текст меню' },
        ]}
        value={mode}
        onChange={(value) => {
          setMode(value);
          setFailure(null);
        }}
      />
      {failure !== null && (
        <Notice tone="error">
          {failure.text}
          {failure.existing !== null && (
            <>
              {' '}
              <button
                type="button"
                className={styles.inlineButton}
                onClick={() => {
                  void navigate(`/venue/menu/import/${String(failure.existing)}`);
                }}
              >
                Открыть
              </button>
            </>
          )}
        </Notice>
      )}
      {mode === 'photo' ? (
        <>
          <p className={styles.muted}>
            Сфотографируйте одну страницу меню ровно и при хорошем свете, чтобы были видны названия и цены.
          </p>
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            hidden
            aria-label="Фото меню"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (file !== undefined) {
                setFailure(null);
                start.mutate({ file });
              }
            }}
          />
          <ActionBar>
            <Button
              size="large"
              stretched
              loading={start.isPending}
              disabled={!online}
              onClick={() => {
                fileRef.current?.click();
              }}
            >
              Выбрать фото
            </Button>
          </ActionBar>
        </>
      ) : (
        <>
          <label className={styles.label} htmlFor={textId}>
            Текст меню
          </label>
          <textarea
            id={textId}
            className={styles.textarea}
            value={text}
            maxLength={TEXT_LIMIT}
            placeholder={TEXT_EXAMPLE}
            onChange={(event) => {
              setText(event.target.value);
            }}
          />
          <p className={styles.muted}>
            {text.length} из {TEXT_LIMIT}
          </p>
          <ActionBar>
            <Button
              size="large"
              stretched
              loading={start.isPending}
              disabled={!online || trimmed.length === 0}
              onClick={() => {
                setFailure(null);
                start.mutate({ text: trimmed });
              }}
            >
              Распознать
            </Button>
          </ActionBar>
        </>
      )}
    </Page>
  );
}

const WIDE_QUERY = '(min-width: 768px)';

function subscribeWide(listener: () => void): () => void {
  const media = window.matchMedia(WIDE_QUERY);
  media.addEventListener('change', listener);
  return () => {
    media.removeEventListener('change', listener);
  };
}

function useWide(): boolean {
  return useSyncExternalStore(subscribeWide, () => window.matchMedia(WIDE_QUERY).matches);
}

function RowCard({
  row,
  errors,
  onChange,
}: {
  row: ReviewRow;
  errors: ItemErrors | undefined;
  onChange: (row: ReviewRow) => void;
}) {
  const [open, setOpen] = useState(false);
  const wide = useWide();
  const invalid = row.selected && errors !== undefined;
  const expanded = open || invalid || wide;
  const checkId = useId();
  const change = <K extends ItemField>(key: K, value: ItemForm[K]) => {
    onChange({ ...row, form: { ...row.form, [key]: value } });
  };
  return (
    <li id={`row-${String(row.key)}`} className={styles.reviewRow} data-invalid={invalid}>
      <div className={styles.reviewHead}>
        <input
          id={checkId}
          type="checkbox"
          checked={row.selected}
          aria-label={`Добавить: ${row.form.name}`}
          onChange={(event) => {
            onChange({ ...row, selected: event.target.checked });
          }}
        />
        <div className={styles.reviewSummary}>
          <span className={styles.itemName}>{row.form.name.length > 0 ? row.form.name : 'Без названия'}</span>
          <span className={styles.meta}>
            {row.form.priceRub.trim().length > 0 ? formatPrice(Number(row.form.priceRub)) : 'Цена не указана'}
            {row.form.kcal.trim().length > 0 && `, ${formatKcal(Number(row.form.kcal))}`}
            {row.form.category !== null && `, ${MENU_CATEGORY_LABELS[row.form.category]}`}
          </span>
          <span className={styles.badges}>
            {row.duplicate && <Label tone="blue">Уже есть в меню</Label>}
            {row.form.priceRub.trim().length === 0 && <Label tone="pink">Укажите цену</Label>}
          </span>
        </div>
      </div>
      {!invalid && !wide && (
        <button
          type="button"
          className={styles.inlineButton}
          aria-expanded={expanded}
          onClick={() => {
            setOpen((value) => !value);
          }}
        >
          {expanded ? 'Свернуть' : 'Подробнее'}
        </button>
      )}
      {expanded && (
        <div className={styles.reviewFields}>
          <div className={styles.wide}>
            <ItemFields form={row.form} errors={row.selected ? (errors ?? {}) : {}} onChange={change} />
          </div>
        </div>
      )}
    </li>
  );
}

function ReviewTable({ data, venueId }: { data: MenuImport; venueId: number }) {
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();
  const online = useOnline();
  const menu = useVenueMenu();
  const [rows, setRows] = useState<ReviewRow[] | null>(() => {
    const draft = readImportDraft();
    return draft !== null && draft.importId === data.id && draft.rows !== null ? draft.rows : null;
  });
  const [touched, setTouched] = useState(rows !== null);
  const [serverErrors, setServerErrors] = useState<Map<number, ItemErrors>>(new Map());
  const { prompt, release } = useUnsavedChanges(touched);

  const current = rows ?? (menu.data === undefined ? null : buildRows(data.items, menu.data));

  const apply = useMutation({
    mutationFn: async (items: ReturnType<typeof applyPayload>['items']) =>
      unwrap(
        await api.POST('/api/v1/venue/menu/imports/{id}/apply', {
          params: { path: { id: data.id } },
          body: { items },
        }),
      ),
  });

  if (current === null && menu.isError) {
    return (
      <ScreenState
        status="error"
        title="Не удалось загрузить меню для сверки"
        description={userMessage(menu.error)}
        action={{
          label: 'Повторить',
          onClick: () => {
            void menu.refetch();
          },
        }}
      />
    );
  }
  if (current === null) return <Skeleton height={96} count={4} />;
  if (data.items.length === 0) {
    return (
      <ScreenState
        status="empty"
        title="Не нашли позиций"
        description="Попробуйте другое фото или вставьте текст."
        action={{
          label: 'Загрузить снова',
          onClick: () => {
            void navigate('/venue/menu/import');
          },
        }}
      />
    );
  }

  const update = (next: ReviewRow[]) => {
    setRows(next);
    setTouched(true);
    saveImportDraft({ venueId, importId: data.id, rows: next });
  };

  const local = rowErrors(current);
  const errors = new Map(local);
  for (const [key, value] of serverErrors) {
    if (current.find((row) => row.key === key)?.selected === true)
      errors.set(key, { ...value, ...errors.get(key) });
  }
  const selected = current.filter((row) => row.selected).length;
  const tooMany = selected > MAX_APPLY_ITEMS;

  const submit = () => {
    const payload = applyPayload(current);
    if (payload.items.length === 0) return;
    apply.mutate(payload.items, {
      onSuccess: (result) => {
        release();
        clearImportDraft(data.id);
        void queryClient.invalidateQueries({ queryKey: MENU_KEY });
        toast.show(
          `Добавлено ${String(result.items.length)} ${plural(result.items.length, ['позиция', 'позиции', 'позиций'])}`,
        );
        void navigate('/venue/menu', { replace: true });
      },
      onError: (error) => {
        if (isApiError(error, 'validation_failed')) {
          const mapped = mapApplyErrors(error.fieldErrors, payload.keys);
          if (mapped.size > 0) {
            setServerErrors(mapped);
            return;
          }
        }
        if (isApiError(error, 'import_already_applied')) {
          release();
          clearImportDraft(data.id);
          void queryClient.invalidateQueries({ queryKey: MENU_KEY });
          toast.show(userMessage(error));
          void navigate('/venue/menu', { replace: true });
          return;
        }
        if (isApiError(error, 'import_not_ready')) {
          void queryClient.invalidateQueries({ queryKey: importKey(data.id) });
          return;
        }
        toast.show(userMessage(error), { tone: 'error' });
      },
    });
  };

  const firstError = current.find((row) => errors.has(row.key));
  return (
    <>
      <p className={styles.counter}>
        Найдено {data.items.length} {plural(data.items.length, ['позиция', 'позиции', 'позиций'])}, выбрано{' '}
        {selected}
      </p>
      <div className={styles.row}>
        <Button
          size="medium"
          variant="secondary"
          stretched
          onClick={() => {
            update(current.map((row) => ({ ...row, selected: true })));
          }}
        >
          Выбрать все
        </Button>
        <Button
          size="medium"
          variant="secondary"
          stretched
          onClick={() => {
            update(current.map((row) => ({ ...row, selected: false })));
          }}
        >
          Снять все
        </Button>
      </div>
      <ul className={styles.review}>
        {current.map((row) => (
          <RowCard
            key={row.key}
            row={row}
            errors={errors.get(row.key)}
            onChange={(next) => {
              setServerErrors((map) => {
                if (!map.has(next.key)) return map;
                const copy = new Map(map);
                copy.delete(next.key);
                return copy;
              });
              update(current.map((entry) => (entry.key === next.key ? next : entry)));
            }}
          />
        ))}
      </ul>
      <ActionBar>
        {firstError !== undefined && (
          <p className={styles.error}>
            Исправьте {errors.size} {plural(errors.size, ['позицию', 'позиции', 'позиций'])}.{' '}
            <button
              type="button"
              className={styles.inlineButton}
              onClick={() => {
                document.getElementById(`row-${String(firstError.key)}`)?.scrollIntoView({ block: 'center' });
              }}
            >
              Показать
            </button>
          </p>
        )}
        {tooMany && <p className={styles.error}>За один раз можно добавить до {MAX_APPLY_ITEMS} позиций</p>}
        <Button
          size="large"
          stretched
          loading={apply.isPending}
          disabled={!online || selected === 0 || errors.size > 0 || tooMany}
          onClick={submit}
        >
          Добавить в меню ({selected})
        </Button>
      </ActionBar>
      {prompt}
    </>
  );
}

function useImportStatus(id: number) {
  const startedAt = useRef<number | null>(null);
  const [expired, setExpired] = useState(false);
  const elapsed = () => (startedAt.current === null ? 0 : Date.now() - startedAt.current);
  useEffect(() => {
    startedAt.current = Date.now();
  }, []);
  const query = useQuery({
    queryKey: importKey(id),
    queryFn: () => fetchImport(id),
    retry: false,
    refetchInterval: (current) =>
      current.state.data?.status === 'processing' && elapsed() < POLL_LIMIT_MS ? POLL_MS : false,
  });
  const processing = query.data?.status === 'processing';
  useEffect(() => {
    if (!processing || expired) return;
    const left = POLL_LIMIT_MS - elapsed();
    const timer = setTimeout(
      () => {
        setExpired(true);
      },
      Math.max(0, left),
    );
    return () => {
      clearTimeout(timer);
    };
  }, [processing, expired]);
  const restart = () => {
    startedAt.current = Date.now();
    setExpired(false);
    void query.refetch();
  };
  return { query, expired, restart };
}

export function ImportReviewScreen() {
  const navigate = useNavigate();
  const { importId } = useParams();
  const id = Number(importId);
  const venue = useVenue();
  useVenueNotFoundRedirect();
  const { query, expired, restart } = useImportStatus(id);
  const data = query.data;
  const go = (path: string) => () => {
    void navigate(path);
  };

  const queryClient = useQueryClient();
  const applied = data?.status === 'applied';
  const finished = data?.status === 'failed' || applied || isApiError(query.error, 'import_not_found');
  useEffect(() => {
    if (finished) clearImportDraft(id);
    if (applied) void queryClient.invalidateQueries({ queryKey: MENU_KEY });
  }, [finished, applied, id, queryClient]);

  return (
    <Page>
      <ScreenHeader title="Разбор меню" back="/venue/menu" />
      {query.isPending && (
        <ScreenState
          status="loading"
          label="Загружаем импорт"
          skeleton={<Skeleton height={96} count={3} />}
        />
      )}
      {query.isError &&
        (isApiError(query.error, 'import_not_found') ? (
          <ScreenState
            status="empty"
            title="Импорт не найден"
            action={{ label: 'К меню', onClick: go('/venue/menu') }}
          />
        ) : (
          <ScreenState
            status="error"
            title="Не удалось получить статус"
            description={userMessage(query.error)}
            action={{ label: 'Повторить', onClick: restart }}
          />
        ))}
      {data?.status === 'processing' &&
        (expired ? (
          <ScreenState
            status="empty"
            title="Распознавание идёт дольше обычного"
            action={{ label: 'Проверить ещё раз', onClick: restart, loading: query.isFetching }}
          />
        ) : (
          <div className={styles.head} role="status">
            <Spinner size={32} appearance="themed" />
            <p className={styles.muted}>
              Распознаём меню. Фото обычно занимает 15-30 секунд, текст несколько секунд.
            </p>
          </div>
        ))}
      {data?.status === 'failed' && (
        <ScreenState
          status="error"
          title={data.error ?? 'Не удалось распознать меню'}
          action={{ label: 'Попробовать снова', onClick: go('/venue/menu/import') }}
          secondaryAction={{ label: 'Добавить вручную', onClick: go('/venue/menu/new') }}
        />
      )}
      {data?.status === 'applied' && (
        <ScreenState
          status="empty"
          title="Эти позиции уже добавлены в меню"
          action={{ label: 'К меню', onClick: go('/venue/menu') }}
        />
      )}
      {data?.status === 'ready' && venue.data !== undefined && venue.data !== null && (
        <ReviewTable data={data} venueId={venue.data.id} />
      )}
    </Page>
  );
}
