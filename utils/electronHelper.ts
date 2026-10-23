export const isElectron = (): boolean => {
  if (typeof window === 'undefined') return false;
  return Boolean(window.electronAPI?.isElectron || (window as any).process?.type === 'renderer');
};

export const getDesktopPlatform = (): string | null => {
  if (!isElectron()) return null;
  return window.electronAPI?.platform || null;
};

export const minimizeDesktopWindow = (): void => {
  if (window.electronAPI?.minimize) {
    window.electronAPI.minimize();
  }
};

export const maximizeDesktopWindow = (): void => {
  if (window.electronAPI?.maximize) {
    window.electronAPI.maximize();
  }
};

export const closeDesktopWindow = (): void => {
  if (window.electronAPI?.close) {
    window.electronAPI.close();
  }
};
