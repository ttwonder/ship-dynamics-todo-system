import { useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { UserAccount } from './types';

type Props = {
  label: string;
  required?: boolean;
  users: UserAccount[];
  departments: string[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
  actions?: ReactNode;
};

export default function MeetingPeoplePicker({ label, required = false, users, departments, selectedIds, onChange, disabled = false, actions }: Props) {
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const [department, setDepartment] = useState('all');
  const [query, setQuery] = useState('');
  const activeUsers = useMemo(() => users.filter(user => user.isActive), [users]);
  const availableDepartments = useMemo(
    () => Array.from(new Set([...departments, ...activeUsers.map(user => user.department)].filter(Boolean))),
    [departments, activeUsers],
  );
  const filteredUsers = activeUsers.filter(user => {
    if (department !== 'all' && user.department !== department) return false;
    const keyword = query.trim().toLowerCase();
    return !keyword || `${user.department} ${user.name} ${user.username}`.toLowerCase().includes(keyword);
  });
  const selectedUsers = selectedIds.map(id => activeUsers.find(user => user.id === id)).filter((user): user is UserAccount => Boolean(user));
  const toggle = (id: string) => onChange(selectedIds.includes(id) ? selectedIds.filter(value => value !== id) : [...selectedIds, id]);
  const remove = (id: string) => onChange(selectedIds.filter(value => value !== id));
  const selectFiltered = () => onChange(Array.from(new Set([...selectedIds, ...filteredUsers.map(user => user.id)])));

  return <div className="field span-3 meeting-people-field">
    <label>{label}{required && <span className="required-mark"> *</span>}</label>
    <details ref={detailsRef} className="meeting-people-picker" aria-disabled={disabled} onToggle={event=>{if(disabled)(event.currentTarget as HTMLDetailsElement).removeAttribute('open');}} onKeyDown={event => {
      if (event.key === 'Escape') {
        detailsRef.current?.removeAttribute('open');
        (detailsRef.current?.querySelector('summary') as HTMLElement | null)?.focus();
      }
    }}>
      <summary aria-label={`${label}下拉多選`} aria-disabled={disabled} tabIndex={disabled?-1:0} onClick={event=>{if(disabled)event.preventDefault();}}>
        <span>{selectedUsers.length ? selectedUsers.map(user => user.name).join('、') : `選擇${label}`}</span>
        <b>{selectedUsers.length} 人</b>
      </summary>
      <div className="meeting-people-menu">
        <div className="meeting-people-tools">
          <select aria-label={`${label}部門篩選`} value={department} onChange={event => setDepartment(event.target.value)}>
            <option value="all">全部部門</option>
            {availableDepartments.map(name => <option value={name} key={name}>{name}</option>)}
          </select>
          <input aria-label={`${label}姓名搜尋`} value={query} onChange={event => setQuery(event.target.value)} placeholder="搜尋姓名或帳號" />
        </div>
        <div className="meeting-people-actions">
          {actions}
          <button type="button" className="btn small ghost" onClick={selectFiltered}>全選目前篩選</button>
          <button type="button" className="btn small ghost" onClick={() => onChange([])}>清空</button>
        </div>
        <div className="meeting-people-options">
          {filteredUsers.map(user => <label key={user.id} className={selectedIds.includes(user.id) ? 'selected' : ''}>
            <input type="checkbox" checked={selectedIds.includes(user.id)} onChange={() => toggle(user.id)} />
            <span><b>{user.name}</b><small>{user.department || '未設定部門'}｜{user.username}</small></span>
          </label>)}
          {!filteredUsers.length && <div className="empty-state compact">此篩選沒有可選人員</div>}
        </div>
      </div>
    </details>
    {selectedUsers.length > 0 && <div className="meeting-people-selected" aria-label={`${label}已選人員`}>{selectedUsers.map(user => <span key={user.id}>{user.name}{!disabled && <button type="button" aria-label={`移除${label}${user.name}`} onClick={() => remove(user.id)}>×</button>}</span>)}</div>}
  </div>;
}
