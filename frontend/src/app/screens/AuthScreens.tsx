import { Button, Spinner } from '@maxhub/max-ui';
import type { ApiError } from '../../api/errors.ts';
import { userMessage } from '../../api/messages.ts';
import { canCloseApp, closeApp } from '../../max/bridge.ts';
import { botLink } from '../startParam.ts';
import { HeroScreen } from './HeroScreen.tsx';

export function SplashScreen() {
  return (
    <HeroScreen title="Входим через MAX" busy>
      <Spinner size={28} appearance="contrast" aria-label="Загрузка" />
    </HeroScreen>
  );
}

export function OpenInMaxScreen() {
  return (
    <HeroScreen
      title="Откройте ППшкин в MAX"
      description="Мини-приложение работает внутри мессенджера MAX: вход проходит автоматически, без логина и пароля."
    >
      <Button asChild size="large" variant="primary-contrast" stretched>
        <a href={botLink()} target="_blank" rel="noopener noreferrer">
          Открыть бота в MAX
        </a>
      </Button>
    </HeroScreen>
  );
}

export function SessionExpiredScreen() {
  return (
    <HeroScreen title="Сессия устарела" description="Закройте мини-приложение и откройте его снова.">
      {canCloseApp() && (
        <Button size="large" variant="primary-contrast" stretched onClick={() => closeApp()}>
          Закрыть
        </Button>
      )}
    </HeroScreen>
  );
}

function failureTitle(error: ApiError): string {
  if (error.code.startsWith('init_data_')) return 'Не удалось войти через MAX';
  return userMessage(error);
}

function failureDescription(error: ApiError): string {
  if (error.code === 'auth_unavailable' || error.status >= 500) return 'Попробуйте ещё раз через минуту.';
  if (error.status === 0) return 'Проверьте интернет и повторите вход.';
  if (error.status === 429) return userMessage(error);
  return 'Повторите вход. Если не получится, закройте и снова откройте мини-приложение.';
}

export function SignInFailedScreen({ error, onRetry }: { error: ApiError; onRetry: () => void }) {
  return (
    <HeroScreen title={failureTitle(error)} description={failureDescription(error)}>
      <Button size="large" variant="primary-contrast" stretched onClick={onRetry}>
        Повторить
      </Button>
    </HeroScreen>
  );
}
