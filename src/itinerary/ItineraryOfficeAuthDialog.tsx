import { useState, type FormEvent } from 'react';
import type { UserAccount } from '../types';
import { authenticateItineraryOffice } from './itineraryOfficeAuth';
import './itineraryCompact.css';

interface ItineraryOfficeAuthDialogProps {
  user: Pick<UserAccount, 'department' | 'name' | 'username' | 'role'>;
  onAuthenticated: () => void;
  onClose: () => void;
}

export default function ItineraryOfficeAuthDialog({ user, onAuthenticated, onClose }: ItineraryOfficeAuthDialogProps) {
  const [sitePassword, setSitePassword] = useState('');
  const [personalPassword, setPersonalPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState('');

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setMessage('');
    try {
      const result = await authenticateItineraryOffice(user, { sitePassword, personalPassword });
      if (result.status !== 'verified') {
        setPersonalPassword('');
        setMessage(result.message);
        return;
      }
      setSitePassword('');
      setPersonalPassword('');
      onAuthenticated();
    } catch (error) {
      setPersonalPassword('');
      setMessage(error instanceof Error ? error.message : 'Itinerary 身份驗證失敗。');
    } finally {
      setSubmitting(false);
    }
  };

  return <div className="itinerary-auth-backdrop no-print" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget && !submitting) onClose(); }}>
    <form className="itinerary-auth-dialog" role="dialog" aria-modal="true" aria-labelledby="itinerary-auth-title" aria-describedby="itinerary-auth-help" onSubmit={submit}>
      <div className="itinerary-auth-head">
        <div>
          <h2 id="itinerary-auth-title">驗證 Itinerary 雲端身份</h2>
          <p>{user.department}｜{user.username}｜{user.name}</p>
        </div>
        <button type="button" className="btn small" onClick={onClose} disabled={submitting}>關閉</button>
      </div>
      <p id="itinerary-auth-help" className="itinerary-auth-help">僅驗證 Itinerary，不會改變目前網站登入。進站密碼只換取短效 token；密碼不會保存。</p>
      <label>進站密碼<input aria-label="進站密碼" type="password" value={sitePassword} maxLength={256} autoFocus autoComplete="off" onChange={event => setSitePassword(event.target.value)} /></label>
      <label>Itinerary 雲端個人密碼<input aria-label="Itinerary 雲端個人密碼" type="password" value={personalPassword} maxLength={256} autoComplete="current-password" onChange={event => setPersonalPassword(event.target.value)} /></label>
      <small className="itinerary-auth-note">已完成 Supabase 個人密碼啟用的 Owner／管理員使用該密碼；免密帳號可留空。</small>
      {message && <div className="itinerary-auth-message" role="alert">{message}</div>}
      <div className="itinerary-auth-actions">
        <button type="button" className="btn" onClick={onClose} disabled={submitting}>取消</button>
        <button type="submit" className="btn primary" disabled={submitting || !sitePassword}>{submitting ? '驗證中…' : '驗證身份'}</button>
      </div>
    </form>
  </div>;
}
