// Translation resources. Add a new language by adding an entry here and to
// LANGUAGES; add new strings under a section and reference via t('section.key').
// Page-level strings can be migrated to these resources incrementally.

export type Lang = 'en' | 'id' | 'zh';

export const LANGUAGES: { value: Lang; label: string }[] = [
  { value: 'en', label: 'English' },
  { value: 'id', label: 'Bahasa Indonesia' },
  { value: 'zh', label: '简体中文' },
];

type Dict = Record<string, Record<string, string>>;

const en: Dict = {
  common: {
    loading: 'Loading…',
    save: 'Save',
    cancel: 'Cancel',
    search: 'Search',
    clear: 'Clear',
  },
  nav: {
    dashboard: 'Dashboard',
    masterData: 'Master Data',
    inbound: 'Inbound',
    outbound: 'Outbound',
    inventory: 'Inventory',
    discrepancy: 'Discrepancy',
    complaint: 'Complaint',
    settings: 'Settings',
  },
  topbar: {
    warehouse: 'Warehouse',
    signOut: 'Sign out',
    selectWarehouse: 'Select warehouse',
    allSites: 'All sites',
  },
  settings: {
    title: 'Settings',
    subtitle: 'Manage your application preferences.',
    appearance: 'Appearance',
    theme: 'Theme',
    themeHint: 'Choose how the application looks.',
    light: 'Light',
    dark: 'Dark',
    system: 'System',
    language: 'Language',
    languageHint: 'Select your preferred language.',
  },
};

const id: Dict = {
  common: {
    loading: 'Memuat…',
    save: 'Simpan',
    cancel: 'Batal',
    search: 'Cari',
    clear: 'Bersihkan',
  },
  nav: {
    dashboard: 'Dasbor',
    masterData: 'Data Master',
    inbound: 'Inbound',
    outbound: 'Outbound',
    inventory: 'Inventaris',
    discrepancy: 'Diskrepansi',
    complaint: 'Keluhan',
    settings: 'Pengaturan',
  },
  topbar: {
    warehouse: 'Gudang',
    signOut: 'Keluar',
    selectWarehouse: 'Pilih gudang',
    allSites: 'Semua gudang',
  },
  settings: {
    title: 'Pengaturan',
    subtitle: 'Kelola preferensi aplikasi Anda.',
    appearance: 'Tampilan',
    theme: 'Tema',
    themeHint: 'Pilih tampilan aplikasi.',
    light: 'Terang',
    dark: 'Gelap',
    system: 'Sistem',
    language: 'Bahasa',
    languageHint: 'Pilih bahasa yang Anda inginkan.',
  },
};

const zh: Dict = {
  common: {
    loading: '加载中…',
    save: '保存',
    cancel: '取消',
    search: '搜索',
    clear: '清除',
  },
  nav: {
    dashboard: '仪表板',
    masterData: '主数据',
    inbound: '入库',
    outbound: '出库',
    inventory: '库存',
    discrepancy: '差异',
    complaint: '投诉',
    settings: '设置',
  },
  topbar: {
    warehouse: '仓库',
    signOut: '退出登录',
    selectWarehouse: '选择仓库',
    allSites: '所有仓库',
  },
  settings: {
    title: '设置',
    subtitle: '管理您的应用偏好设置。',
    appearance: '外观',
    theme: '主题',
    themeHint: '选择应用的外观。',
    light: '浅色',
    dark: '深色',
    system: '跟随系统',
    language: '语言',
    languageHint: '选择您偏好的语言。',
  },
};

export const RESOURCES: Record<Lang, Dict> = { en, id, zh };
