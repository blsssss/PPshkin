import { Component, type ReactNode } from 'react';
import { ScreenState } from './ScreenState.tsx';

interface State {
  failed: boolean;
}

export class ErrorBoundary extends Component<{ children: ReactNode; onRestart?: () => void }, State> {
  override state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  private restart = () => {
    if (this.props.onRestart !== undefined) {
      this.setState({ failed: false });
      this.props.onRestart();
      return;
    }
    window.location.reload();
  };

  override render() {
    if (!this.state.failed) return this.props.children;
    return (
      <ScreenState
        status="error"
        title="Что-то пошло не так"
        description="Экран не открылся. Перезапустите приложение, введённые данные на сервере сохранены."
        action={{ label: 'Перезапустить', onClick: this.restart }}
      />
    );
  }
}
