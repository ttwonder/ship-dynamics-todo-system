import type { AppData, UserAccount } from './types';
import { hasPermission } from './permissions';
import { hasActiveVesselDelegation } from './vesselDelegation';
import { pdfVesselDisplayName, vesselDisplayName } from './vesselDisplay';
import { formatTaipeiDateTime } from './taipeiTime';

export interface AssignmentCell { direct: string[]; delegates: string[] }
export interface AssignmentVesselRow {
  id: string; fleet: string; shipType: string; chineseName: string; englishName: string; cells: AssignmentCell[];
}
export interface AssignmentPersonRow {
  id: string; name: string; department: string; directVessels: string[]; delegateVessels: string[];
}
export interface ManagementAssignmentReport {
  generatedAt: string; revision: number; departments: string[]; vessels: AssignmentVesselRow[]; people: AssignmentPersonRow[];
}

export function canExportManagementAssignments(data: Pick<AppData, 'settings'>, user: UserAccount): boolean {
  return user.isActive && hasPermission(data.settings.rolePermissions, user, 'enterManagement')
    && hasPermission(data.settings.rolePermissions, user, 'exportReports')
    && (hasPermission(data.settings.rolePermissions, user, 'manageUsers') || hasPermission(data.settings.rolePermissions, user, 'manageVessels'));
}

/** A minimal frozen export DTO; no credentials, live references, drafts or attachment data. */
export function buildManagementAssignmentReport(data: Pick<AppData, 'vessels' | 'users' | 'settings' | 'revision'>, generatedAt = new Date().toISOString()): ManagementAssignmentReport {
  const people = [...new Map(data.users.filter(user => user.isActive && (user.role === 'admin' || user.role === 'operator')).map(user => [user.id, user])).values()];
  const activeVessels = data.vessels.filter(vessel => vessel.isActive);
  const department = (user: UserAccount) => user.department.trim() || '未設定部門';
  const name = (user: UserAccount) => user.name.trim() || '未命名人員';
  const direct = (vessel: typeof activeVessels[number], user: UserAccount) => vessel.assignedUserIds.includes(user.id) || user.managedVesselIds.includes(vessel.id);
  const delegated = (vessel: typeof activeVessels[number], user: UserAccount) => !direct(vessel, user) && hasActiveVesselDelegation(vessel, user.id);
  const usedDepartments = new Set(people.filter(user => activeVessels.some(vessel => direct(vessel, user) || delegated(vessel, user))).map(department));
  const departments = [...new Set([...data.settings.departments.map(value => value.trim()), ...usedDepartments])].filter(value => usedDepartments.has(value));
  if (!departments.length) departments.push('分管人員');
  // Group by fleet/type, preserving their existing order and the order within each group.
  const fleetOrder = [...new Set(activeVessels.map(vessel => vessel.fleetCategory))];
  const vessels = fleetOrder.flatMap(fleet => {
    const fleetVessels = activeVessels.filter(vessel => vessel.fleetCategory === fleet);
    return [...new Set(fleetVessels.map(vessel => vessel.shipType))].flatMap(type => fleetVessels.filter(vessel => vessel.shipType === type));
  });
  return {
    generatedAt, revision: data.revision, departments,
    vessels: vessels.map(vessel => {
      const chineseName = /\p{Script=Han}/u.test(vessel.name) ? vessel.name.trim() : '';
      const displayName = vesselDisplayName(vessel);
      return {
        id: vessel.id, fleet: ({ 'tanker fleet': '油輪船隊', 'bulk fleet': '散貨船隊' } as Record<string, string>)[vessel.fleetCategory] || vessel.fleetCategory || '未設定船隊',
        shipType: vessel.shipType || '未設定船型', chineseName,
        englishName: displayName === chineseName ? '' : displayName,
        cells: departments.map(value => ({
          direct: people.filter(user => department(user) === value && direct(vessel, user)).map(name),
          delegates: people.filter(user => department(user) === value && delegated(vessel, user)).map(name),
        })),
      };
    }),
    people: people.map(user => ({
      id: user.id, name: name(user), department: department(user),
      directVessels: vessels.filter(vessel => direct(vessel, user)).map(pdfVesselDisplayName),
      delegateVessels: vessels.filter(vessel => delegated(vessel, user)).map(pdfVesselDisplayName),
    })),
  };
}

export function assignmentCellText(cell: AssignmentCell, separator = '\n'): string {
  return [cell.direct.join('、'), cell.delegates.length ? `（代理：${cell.delegates.join('、')}）` : ''].filter(Boolean).join(separator) || '—';
}

/** Shared relative PDF widths / Excel character widths; keep supervisor names together. */
export function assignmentColumnWidths(departments: string[]): number[] {
  return [9, 7, 9, 16, ...departments.map(department => department.includes('督導') ? 30 : 7)];
}

export function assignmentReportFileName(report: ManagementAssignmentReport, extension: 'pdf' | 'xlsx'): string {
  const stamp = formatTaipeiDateTime(report.generatedAt).replace(/\//g, '-').replace(/:/g, '').replace(/\s+/g, '_');
  return `船舶分管表_${stamp}.${extension}`;
}
