export default {
    content: [
        "./index.html",
        "./src/**/*.{js,ts,jsx,tsx}",
        "../../packages/ui/src/**/*.{js,ts,jsx,tsx}"
    ],
    darkMode: 'class',
    theme: {
        extend: {
            colors: {
                zenith: {
                    cyan: '#00F2FE',
                    indigo: '#4FACFE',
                    darkBg: '#080B11',
                    card: '#0F172A',
                    surface: '#1E293B',
                    input: '#0B111E',
                    border: '#334155'
                }
            },
            fontFamily: {
                sans: ['Inter', 'sans-serif'],
                display: ['Outfit', 'sans-serif'],
                mono: ['JetBrains Mono', 'monospace']
            },
            boxShadow: {
                'glow-cyan': '0 0 25px rgba(0, 242, 254, 0.35)',
                'glow-emerald': '0 0 20px rgba(16, 185, 129, 0.3)',
                'card-glass': '0 10px 30px -10px rgba(0, 0, 0, 0.5)'
            },
            animation: {
                'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
                'spin-slow': 'spin 8s linear infinite',
            }
        },
    },
    plugins: [],
};
