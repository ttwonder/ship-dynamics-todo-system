import React from 'react';
import { appRecoveryReloadUrl } from './appVersionUpdate';
import { repairShipDynamicsResources } from './browserRecovery';

type State = { error: Error | null; recovering:boolean; recoveryError:string };

export default class ErrorBoundary extends React.Component<React.PropsWithChildren, State> {
  state: State = { error: null, recovering:false, recoveryError:'' };

  static getDerivedStateFromError(error: Error): State { return { error, recovering:false, recoveryError:'' }; }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('Ship Dynamics UI error', error, info);
  }

  repair=async()=>{
    if(this.state.recovering)return;
    this.setState({recovering:true,recoveryError:''});
    try{
      await repairShipDynamicsResources({
        appBaseUrl:import.meta.env.BASE_URL,
        origin:window.location.origin,
        cacheStorage:typeof caches==='undefined'?null:caches,
        serviceWorkerContainer:'serviceWorker' in navigator?navigator.serviceWorker:null,
      });
      window.location.assign(appRecoveryReloadUrl(window.location.href,__SHIP_DYNAMICS_BUILD_VERSION__,`crash-${Date.now().toString(36)}`));
    }catch(error){
      this.setState({recovering:false,recoveryError:`安全修復未完成：${error instanceof Error?error.message:String(error)}`});
    }
  };

  render() {
    if (!this.state.error) return this.props.children;
    return <main className="login-page" role="alert"><section className="login-card"><h2>系統畫面載入失敗</h2><p>可先清理本App具名資源並重新取得最新版；不會執行完整本機重設。</p><button className="btn primary" onClick={()=>void this.repair()} disabled={this.state.recovering}>{this.state.recovering?'正在安全修復…':'安全重新載入最新版'}</button>{this.state.recoveryError&&<p className="warn">{this.state.recoveryError}；業務資料未刪除，頁面不會自動重新載入。</p>}<details><summary>技術資訊</summary><pre>{this.state.error.message}</pre></details></section></main>;
  }
}
