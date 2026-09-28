import { ZENITH_TOKENS } from './tokens';
export type ZenithThemeMode = 'dark' | 'light';
export class ThemeManager {
    private currentMode: ZenithThemeMode = 'dark';
    public getTheme(): ZenithThemeMode {
        return this.currentMode;
    }
    public setTheme(mode: ZenithThemeMode): void {
        this.currentMode = mode;
        if (typeof document !== 'undefined') {
            if (mode === 'dark') {
                document.documentElement.classList.add('dark');
                document.documentElement.classList.remove('light');
                document.documentElement.setAttribute('data-theme', 'dark');
            }
            else {
                document.documentElement.classList.add('light');
                document.documentElement.classList.remove('dark');
                document.documentElement.setAttribute('data-theme', 'light');
            }
        }
    }
    public getColors() {
        return this.currentMode === 'dark' ? ZENITH_TOKENS.colors.dark : ZENITH_TOKENS.colors.light;
    }
}
export const defaultThemeManager = new ThemeManager();
