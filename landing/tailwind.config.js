/** @type {import('tailwindcss').Config} */
export default {
  content: ['./public/landing/index.html'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        headline: ['Manrope', 'system-ui', 'sans-serif'],
      },
      colors: { primary: '#0058bc' },
      animation: {
        'aurora-1': 'aurora1 18s ease-in-out infinite',
        'aurora-2': 'aurora2 22s ease-in-out infinite',
        'aurora-3': 'aurora3 26s ease-in-out infinite',
        'pulse-ring': 'pulseRing 3.6s ease-in-out infinite',
        'fade-up': 'fadeUp 0.8s ease-out both',
      },
      keyframes: {
        aurora1: {
          '0%,100%': { transform: 'translate(0,0) scale(1)' },
          '50%': { transform: 'translate(60px,-40px) scale(1.15)' },
        },
        aurora2: {
          '0%,100%': { transform: 'translate(0,0) scale(1)' },
          '50%': { transform: 'translate(-40px,50px) scale(1.2)' },
        },
        aurora3: {
          '0%,100%': { transform: 'translate(0,0) scale(1)' },
          '50%': { transform: 'translate(30px,30px) scale(1.1)' },
        },
        pulseRing: {
          '0%,100%': { transform: 'scale(1)', opacity: '0.35' },
          '50%': { transform: 'scale(1.08)', opacity: '0.15' },
        },
        fadeUp: {
          from: { opacity: '0', transform: 'translateY(24px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
      },
    },
  },
  plugins: [],
}
