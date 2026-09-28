export const ZENITH_TOKENS = {
    colors: {
        brand: {
            primary: '#00F2FE',
            secondary: '#4FACFE',
            gradient: 'linear-gradient(135deg, #00F2FE 0%, #4FACFE 100%)',
            glow: '0 0 25px rgba(0, 242, 254, 0.35)',
            accentHover: '#38bdf8'
        },
        dark: {
            bgMain: '#080B11',
            bgCard: '#0F172A',
            bgCardGlass: 'rgba(15, 23, 42, 0.75)',
            bgSurface: '#1E293B',
            bgInput: '#0B111E',
            borderSubtle: '#334155',
            borderActive: '#00F2FE',
            textPrimary: '#F8FAFC',
            textSecondary: '#94A3B8',
            textMuted: '#64748B'
        },
        light: {
            bgMain: '#F8FAFC',
            bgCard: '#FFFFFF',
            bgCardGlass: 'rgba(255, 255, 255, 0.85)',
            bgSurface: '#F1F5F9',
            bgInput: '#E2E8F0',
            borderSubtle: '#CBD5E1',
            borderActive: '#0284C7',
            textPrimary: '#0F172A',
            textSecondary: '#475569',
            textMuted: '#64748B'
        },
        status: {
            success: '#10B981',
            successGlow: '0 0 15px rgba(16, 185, 129, 0.3)',
            warning: '#F59E0B',
            warningGlow: '0 0 15px rgba(245, 158, 11, 0.3)',
            danger: '#EF4444',
            dangerGlow: '0 0 15px rgba(239, 68, 68, 0.3)',
            info: '#3B82F6'
        }
    },
    typography: {
        fontSans: '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        fontDisplay: '"Outfit", "Inter", sans-serif',
        fontMono: '"JetBrains Mono", "Fira Code", monospace'
    },
    radii: {
        sm: '6px',
        md: '12px',
        lg: '16px',
        xl: '24px',
        full: '9999px'
    },
    shadows: {
        card: '0 10px 30px -10px rgba(0, 0, 0, 0.5)',
        modal: '0 25px 50px -12px rgba(0, 0, 0, 0.75)',
        glowCyan: '0 0 20px rgba(0, 242, 254, 0.25)',
        glowEmerald: '0 0 20px rgba(16, 185, 129, 0.25)'
    },
    motion: {
        transitionFast: '150ms cubic-bezier(0.4, 0, 0.2, 1)',
        transitionNormal: '250ms cubic-bezier(0.4, 0, 0.2, 1)',
        transitionSlow: '400ms cubic-bezier(0.4, 0, 0.2, 1)'
    }
};
