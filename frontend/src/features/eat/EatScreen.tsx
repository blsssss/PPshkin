import { Button } from '@maxhub/max-ui';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { isApiError } from '../../api/errors.ts';
import { api } from '../../api/index.ts';
import { userMessage } from '../../api/messages.ts';
import { plural } from '../../shared/format.ts';
import { Page } from '../../shared/ui/Page.tsx';
import { ScreenHeader } from '../../shared/ui/ScreenHeader.tsx';
import { ScreenState } from '../../shared/ui/ScreenState.tsx';
import { Skeleton } from '../../shared/ui/Skeleton.tsx';
import { useToast } from '../../shared/ui/Toast.tsx';
import { useInsights } from '../diary/queries.ts';
import {
  demoCenterUsed,
  recommendationHeader,
  type RecommendationItem,
  type Recommendations,
} from './model.ts';
import { EatTabs } from './parts.tsx';
import { recommendationsKey, useRecommendations } from './queries.ts';
import { RecommendationCard, type DeclineReason } from './RecommendationCard.tsx';
import { SearchPointBar, useLocator, useSearchPoint, type Locator } from './SearchPoint.tsx';
import styles from './Eat.module.css';

const DECLINED_TEXT: Record<DeclineReason, string> = {
  not_today: 'Не будем предлагать это блюдо 3 дня',
  dislike: 'Учли: не будем предлагать это блюдо месяц',
};

function StatusState({ data, locator }: { data: Recommendations; locator: Locator | null }) {
  const navigate = useNavigate();
  const go = (path: string) => () => {
    void navigate(path);
  };
  if (data.status === 'profile_empty') {
    return (
      <ScreenState
        status="empty"
        title="Запишите хотя бы один приём пищи, и мы подберём блюдо под ваш день"
        action={{ label: 'Сфотографировать еду', onClick: go('/diary?add=1') }}
        secondaryAction={{ label: 'Горящие позиции рядом', onClick: go('/deals') }}
      />
    );
  }
  if (data.status === 'budget_exhausted') {
    return (
      <ScreenState
        status="empty"
        title={`На сегодня ориентир почти выбран: осталось около ${data.remainingKcal} ккал`}
        action={{ label: 'Открыть дневник', onClick: go('/diary') }}
        secondaryAction={{ label: 'Горящие позиции рядом', onClick: go('/deals') }}
      />
    );
  }
  return (
    <ScreenState
      status="empty"
      title="Сейчас рядом нет подходящих блюд: заведения закрыты, далеко или блюда больше остатка калорий"
      action={{ label: 'Горящие позиции рядом', onClick: go('/deals') }}
      secondaryAction={{ label: 'Все заведения', onClick: go('/venues') }}
      tertiaryAction={
        locator === null
          ? undefined
          : { label: 'Указать геопозицию', onClick: locator.locate, loading: locator.requesting }
      }
    />
  );
}

export function EatScreen() {
  const toast = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { source, point } = useSearchPoint();
  const locator = useLocator();
  const requestPoint = source === 'device' ? point : null;
  const recommendations = useRecommendations(requestPoint);
  const insights = useInsights();
  const [hidden, setHidden] = useState<ReadonlySet<number>>(new Set());
  const now = new Date();

  const decline = (item: RecommendationItem, reason: DeclineReason) => {
    const key = recommendationsKey(requestPoint);
    const drop = () => {
      queryClient.setQueryData<Recommendations>(key, (current) =>
        current === undefined
          ? current
          : { ...current, items: current.items.filter((entry) => entry.offerId !== item.offerId) },
      );
    };
    setHidden((current) => new Set(current).add(item.offerId));
    api
      .POST('/api/v1/offers/{id}/decline', { params: { path: { id: item.offerId } }, body: { reason } })
      .then(
        () => {
          drop();
          toast.show(DECLINED_TEXT[reason]);
        },
        (error: unknown) => {
          if (isApiError(error, 'offer_not_found')) {
            drop();
            return;
          }
          if (isApiError(error, 'offer_already_accepted')) {
            drop();
            toast.show('По этому предложению уже есть бронь', {
              action: {
                label: 'Мои брони',
                onClick: () => {
                  void navigate('/bookings');
                },
              },
            });
            return;
          }
          setHidden((current) => {
            const next = new Set(current);
            next.delete(item.offerId);
            return next;
          });
          toast.show(userMessage(error), { tone: 'error' });
        },
      );
  };

  const showOthers = () => {
    void recommendations.refetch().then((result) => {
      if (result.isSuccess) setHidden(new Set());
      else toast.show(userMessage(result.error), { tone: 'error' });
    });
  };

  const data = recommendations.data;
  const visible = data?.items.filter((item) => !hidden.has(item.offerId)) ?? [];
  const collecting = insights.data?.readiness === 'collecting' ? insights.data.mealsUntilReady : null;

  return (
    <Page>
      <ScreenHeader title="Что поесть" />
      <EatTabs current="/eat" />
      <SearchPointBar source={source} demoCenter={demoCenterUsed(data)} locator={locator} />
      {recommendations.isPending && <Skeleton height={220} count={2} />}
      {recommendations.isError && data === undefined && (
        <ScreenState
          status="error"
          title="Не удалось подобрать блюда"
          description={userMessage(recommendations.error)}
          error={recommendations.error}
          action={{
            label: 'Повторить',
            onClick: () => {
              void recommendations.refetch();
            },
            loading: recommendations.isFetching,
          }}
        />
      )}
      {data !== undefined && (
        <>
          <p className={styles.lead}>{recommendationHeader(data)}</p>
          {collecting !== null && collecting > 0 && (
            <p className={styles.muted}>
              Подборка станет точнее после ещё {collecting}{' '}
              {plural(collecting, ['приёма', 'приёмов', 'приёмов'])} пищи.{' '}
              <Link to="/diary" className={styles.inlineAnchor}>
                Открыть дневник
              </Link>
            </p>
          )}
          {data.status !== 'ok' ? (
            <StatusState data={data} locator={source === 'none' ? locator : null} />
          ) : visible.length === 0 ? (
            <ScreenState
              status="empty"
              title="Вы посмотрели всю подборку"
              action={{ label: 'Показать другие', onClick: showOthers, loading: recommendations.isFetching }}
            />
          ) : (
            <div className={styles.cards}>
              {visible.map((item, index) => (
                <RecommendationCard
                  key={item.offerId}
                  item={item}
                  expanded={index === 0}
                  now={now}
                  onDecline={(reason) => {
                    decline(item, reason);
                  }}
                />
              ))}
              <Button
                size="large"
                variant="secondary"
                stretched
                loading={recommendations.isFetching}
                onClick={showOthers}
              >
                Показать другие
              </Button>
            </div>
          )}
          <Link to="/deals" className={styles.footerLink}>
            Все горящие позиции рядом
          </Link>
        </>
      )}
    </Page>
  );
}
