/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string
  readonly VITE_SUPABASE_ANON_KEY: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

interface ElectronAPI {
  isElectron: boolean;
  platform: string;
  getVersion: () => Promise<string>;
  isMaximized: () => Promise<boolean>;
  minimize: () => void;
  maximize: () => void;
  close: () => void;
}

interface Window {
  electronAPI?: ElectronAPI;
}
