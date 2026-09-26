import { useNavigate } from 'react-router';
import { Page } from '../../shared/ui/Page.tsx';
import { ScreenHeader } from '../../shared/ui/ScreenHeader.tsx';
import { ScreenState } from '../../shared/ui/ScreenState.tsx';
import { HOME_PATH } from '../startParam.ts';

export function StubScreen({ title, back }: { title: string; back?: string }) {
  const navigate = useNavigate();
  return (
    <Page>
      <ScreenHeader title={title} back={back} />
      <ScreenState
        status="empty"
        title="Раздел скоро появится"
        description="Мы уже работаем над ним. Пока загляните в другие разделы."
        action={{
          label: 'На главную',
          onClick: () => {
            void navigate(HOME_PATH);
          },
        }}
      />
    </Page>
  );
}

export function NotFoundScreen() {
  const navigate = useNavigate();
  return (
    <Page>
      <ScreenHeader title="Не нашли" />
      <ScreenState
        status="empty"
        title="Такой страницы нет"
        description="Возможно, ссылка устарела."
        action={{
          label: 'На главную',
          onClick: () => {
            void navigate(HOME_PATH);
          },
        }}
      />
    </Page>
  );
}
