import { useNavigate } from 'react-router';
import { Page } from '../../shared/ui/Page.tsx';
import { ScreenState } from '../../shared/ui/ScreenState.tsx';
import { HOME_PATH } from '../startParam.ts';

export function RouteErrorScreen() {
  const navigate = useNavigate();
  return (
    <Page>
      <ScreenState
        status="error"
        title="Что-то пошло не так"
        description="Экран не открылся. Данные на сервере сохранены."
        action={{
          label: 'Перезапустить',
          onClick: () => {
            window.location.reload();
          },
        }}
        secondaryAction={{
          label: 'На главную',
          onClick: () => {
            void navigate(HOME_PATH);
          },
        }}
      />
    </Page>
  );
}
