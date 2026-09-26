export type Role = 'admin' | 'manager' | 'creator' | 'accountant';
export const ROLES: Role[] = ['admin', 'manager', 'creator', 'accountant'];
export const ROLE_LABEL: Record<Role, string> = { admin: 'Admin', manager: 'Manager', creator: 'Order Creator', accountant: 'Accountant' };
