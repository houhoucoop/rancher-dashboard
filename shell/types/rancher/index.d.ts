declare module '@rancher/auto-import' {
  export function importTypes(ext: any): void;
}

declare module '@shell/store/type-map' {
  export function DSL(store: any, name: string): any;
  export function isAdminUser(getters: any): boolean;
}

declare module '@shell/plugins/dashboard-store';

declare module '@shell/config/query-params' {
  export const _CREATE: string;
  export const _EDIT: string;
  export const _LIST: string;
  export const _CONFIG: string;
  export const _DETAIL: string;
}

declare module '@shell/config/version' {
  export const CURRENT_RANCHER_VERSION: string;
  export function getVersionData(): any;
}
