import { Button } from '@maxhub/max-ui';
import { useState } from 'react';
import { userMessage } from '../../api/messages.ts';
import type { Schemas } from '../../api/client.ts';
import { haptic } from '../../max/bridge.ts';
import { formatPrice, plural } from '../../shared/format.ts';
import { useOnline } from '../../shared/useOnline.ts';
import { toZonedInput, zonedDate } from '../../shared/zonedTime.ts';
import { Field } from '../../shared/ui/Field.tsx';
import { Notice } from '../../shared/ui/Notice.tsx';
import { ScreenState } from '../../shared/ui/ScreenState.tsx';
import { SegmentedControl } from '../../shared/ui/SegmentedControl.tsx';
import { Skeleton } from '../../shared/ui/Skeleton.tsx';
import { useToast } from '../../shared/ui/Toast.tsx';
import { formatLongDate, shiftDate } from '../diary/dates.ts';
import { formatRate } from './dealModel.ts';
import type { Venue } from './model.ts';
import { defaultReportDay, maxWriteOff, previousWeekStart } from './reportModel.ts';
import { useCloseOut, useExportReport, useVenueReport } from './reportQueries.ts';
import styles from './Venue.module.css';

type Mode = 'day' | 'week';
type Row = Schemas['VenueReportRow'];

const POSITION_FORMS: [string, string, string] = ['позиции', 'позициям', 'позициям'];

function Tile({ title, value, meta }: { title: string; value: string; meta?: string }) {
  return (
    <li className={styles.tile}>
      <span className={styles.meta}>{title}</span>
      <span className={styles.tileValue}>{value}</span>
      {meta !== undefined && <span className={styles.meta}>{meta}</span>}
    </li>
  );
}

function CloseoutEditor({ row, onDone }: { row: Row; onDone: () => void }) {
  const closeOut = useCloseOut();
  const online = useOnline();
  const max = maxWriteOff(row);
  const [value, setValue] = useState(Math.min(row.writtenOff ?? max, max));
  const [error, setError] = useState<string | null>(null);
  return (
    <div className={styles.group}>
      <div className={styles.actions}>
        <Button
          size="medium"
          variant="secondary"
          aria-label="Списать меньше"
          disabled={value <= 0}
          onClick={() => {
            setValue(value - 1);
          }}
        >
          -
        </Button>
        <span aria-live="polite" aria-label="Списано, шт.">
          {value}
        </span>
        <Button
          size="medium"
          variant="secondary"
          aria-label="Списать больше"
          disabled={value >= max}
          onClick={() => {
            setValue(value + 1);
          }}
        >
          +
        </Button>
        <Button
          size="medium"
          loading={closeOut.isPending}
          disabled={!online}
          onClick={() => {
            setError(null);
            closeOut.mutate(
              { dealId: row.dealId, writtenOff: value },
              {
                onSuccess: () => {
                  haptic.success();
                  onDone();
                },
                onError: (failure) => {
                  haptic.error();
                  setError(userMessage(failure));
                },
              },
            );
          }}
        >
          Сохранить
        </Button>
      </div>
      {error !== null && <Notice tone="error">{error}</Notice>}
    </div>
  );
}

function ReportRow({ row }: { row: Row }) {
  const [editing, setEditing] = useState(false);
  const marked = row.writtenOff !== null;
  return (
    <li className={styles.item}>
      <span className={styles.itemMain}>
        <span className={styles.itemName}>{row.itemName}</span>
        <span className={styles.meta}>
          {formatLongDate(row.date)}: выставлено {row.listed}, продано {row.soldViaApp}
          {marked ? `, списано ${String(row.writtenOff)}` : ', списание не отмечено'}
          {row.unaccounted !== null && row.unaccounted > 0 ? `, без учёта ${String(row.unaccounted)}` : ''}
        </span>
        <span className={styles.meta}>
          {formatPrice(row.dealPriceRub)}
          {row.listPriceRub !== null ? ` вместо ${formatPrice(row.listPriceRub)}` : ''}, выручка{' '}
          {formatPrice(row.revenueRub)}
        </span>
        {editing ? (
          <CloseoutEditor
            row={row}
            onDone={() => {
              setEditing(false);
            }}
          />
        ) : (
          <Button
            size="small"
            variant="secondary"
            onClick={() => {
              setEditing(true);
            }}
          >
            {marked ? 'Изменить списание' : 'Отметить списание'}
          </Button>
        )}
      </span>
    </li>
  );
}

export function ReportTab({ venue, week }: { venue: Venue; week: string | null }) {
  const toast = useToast();
  const exportReport = useExportReport();
  const online = useOnline();
  const now = new Date();
  const today = zonedDate(now, venue.timezone);
  const [mode, setMode] = useState<Mode>(week === null ? 'day' : 'week');
  const [day, setDay] = useState(() =>
    defaultReportDay(venue, today, toZonedInput(now, venue.timezone).slice(11)),
  );
  const [weekStart, setWeekStart] = useState(week ?? previousWeekStart(today));
  const range = mode === 'day' ? { from: day, to: day } : { from: weekStart, to: shiftDate(weekStart, 6) };
  const report = useVenueReport(range);
  const data = report.data;

  function send(format: 'csv' | 'pdf') {
    exportReport.mutate(
      { ...range, format },
      {
        onSuccess: () => {
          haptic.success();
          toast.show('Файл придёт в чат с ботом');
        },
        onError: (error) => {
          haptic.error();
          toast.show(userMessage(error), { tone: 'error' });
        },
      },
    );
  }

  return (
    <>
      <div className={styles.group}>
        <SegmentedControl
          label="Период отчёта"
          options={[
            { value: 'day', label: 'День' },
            { value: 'week', label: 'Неделя' },
          ]}
          value={mode}
          onChange={setMode}
        />
      </div>
      {mode === 'day' ? (
        <Field
          label="День отчёта"
          type="date"
          value={day}
          max={today}
          onChange={(event) => {
            if (event.target.value.length > 0) setDay(event.target.value);
          }}
        />
      ) : (
        <div className={styles.actions}>
          <Button
            size="medium"
            variant="secondary"
            onClick={() => {
              setWeekStart(shiftDate(weekStart, -7));
            }}
          >
            Раньше
          </Button>
          <span className={styles.muted}>
            {formatLongDate(range.from)} - {formatLongDate(range.to)}
          </span>
          <Button
            size="medium"
            variant="secondary"
            disabled={shiftDate(weekStart, 7) > today}
            onClick={() => {
              setWeekStart(shiftDate(weekStart, 7));
            }}
          >
            Позже
          </Button>
        </div>
      )}
      {report.isPending && <Skeleton height={72} count={4} />}
      {report.isError && data === undefined && (
        <ScreenState
          status="error"
          title="Не удалось загрузить отчёт"
          description={userMessage(report.error)}
          error={report.error}
          action={{
            label: 'Повторить',
            onClick: () => {
              void report.refetch();
            },
          }}
        />
      )}
      {data?.rows.length === 0 && <p className={styles.muted}>Горящих позиций за этот период не было</p>}
      {data !== undefined && data.rows.length > 0 && (
        <>
          {data.notClosed > 0 && (
            <Notice tone="error">
              Не отмечено списание по {data.notClosed} {plural(data.notClosed, POSITION_FORMS)}
            </Notice>
          )}
          <ul className={styles.tiles}>
            <Tile title="Выставлено" value={`${String(data.listed)} шт.`} />
            <Tile
              title="Продано по броням"
              value={`${String(data.soldViaApp)} шт.`}
              meta={formatRate(data.soldShare, data.listed)}
            />
            <Tile
              title="Списано"
              value={`${String(data.writtenOff)} шт.`}
              meta={`без учёта ${String(data.unaccounted)}`}
            />
            <Tile title="Выручка" value={formatPrice(data.revenueRub)} />
            <Tile
              title="Скидка гостям"
              value={formatPrice(data.discountRub)}
              {...(data.missingListPrice > 0
                ? { meta: `нет цены в меню у ${String(data.missingListPrice)} акций` }
                : {})}
            />
            <Tile title="Новые гости" value={String(data.newGuests)} />
          </ul>
          <h2 className={styles.sectionTitle}>Позиции</h2>
          <ul className={styles.items}>
            {data.rows.map((row) => (
              <ReportRow key={row.dealId} row={row} />
            ))}
          </ul>
          <div className={styles.actions}>
            <Button
              size="large"
              stretched
              variant="secondary"
              loading={exportReport.isPending && exportReport.variables.format === 'csv'}
              disabled={!online}
              onClick={() => {
                send('csv');
              }}
            >
              CSV в чат
            </Button>
            <Button
              size="large"
              stretched
              variant="secondary"
              loading={exportReport.isPending && exportReport.variables.format === 'pdf'}
              disabled={!online}
              onClick={() => {
                send('pdf');
              }}
            >
              PDF в чат
            </Button>
          </div>
        </>
      )}
    </>
  );
}
