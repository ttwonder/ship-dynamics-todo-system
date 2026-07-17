import React from 'react';

type State = { error: Error | null };

export default class ErrorBoundary extends React.Component<React.PropsWithChildren, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State { return { error }; }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('Ship Dynamics UI error', error, info);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return <main className="login-page" role="alert"><section className="login-card"><h2>系統畫面載入失敗</h2><p>本機或雲端資料可能不完整。系統沒有自動清除或覆寫任何資料。</p><button className="btn primary" onClick={() => window.location.reload()}>重新載入</button><details><summary>技術資訊</summary><pre>{this.state.error.message}</pre></details></section></main>;
  }
}
