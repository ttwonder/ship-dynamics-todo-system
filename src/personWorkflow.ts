import type { UserRole } from './types';

export const departmentAfterRoleChange = (
  currentDepartment: string,
  nextRole: UserRole,
  departments: string[],
) => {
  if (nextRole === 'vessel') return '船舶帳戶';
  const personnelDepartments = departments.map(department => department.trim()).filter(department => department && department !== '船舶帳戶');
  if (currentDepartment && currentDepartment !== '船舶帳戶' && personnelDepartments.includes(currentDepartment)) return currentDepartment;
  return personnelDepartments[0] || '';
};
