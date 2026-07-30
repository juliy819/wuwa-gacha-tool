/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        abyss: {
          DEFAULT: "#1f1f1f",
          50: "#232323",
          100: "#262626",
          200: "#2b2b2b",
          300: "#333333",
        },
        tide: {
          DEFAULT: "#d4d4d4",
          dim: "#b4b4b4",
        },
        wave: {
          DEFAULT: "#8a8a8a",
          dim: "#6b6b6b",
        },
        ember: "#b89968",
        mist: "#5c5c5c",
        foam: "#e8e8e8",
      },
      fontFamily: {
        display: [
          "Exo 2",
          "system-ui",
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "Noto Sans",
          "Helvetica",
          "Arial",
          "sans-serif",
        ],
      },
      animation: {
        "fade-in": "fade-in 0.15s ease-out",
        "slide-up": "slide-up 0.3s cubic-bezier(0.16, 1, 0.3, 1)",
        "number-pulse": "numberPulse 2.5s cubic-bezier(0.16, 1, 0.3, 1)",
      },
      keyframes: {
        "fade-in": {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        "slide-up": {
          "0%": { transform: "translateY(12px)", opacity: "0" },
          "100%": { transform: "translateY(0)", opacity: "1" },
        },
        numberPulse: {
          "0%": { textShadow: "0 0 0 rgba(232, 232, 232, 0)", color: "#d4d4d4", transform: "scale(1)" },
          "8%": { textShadow: "0 0 26px rgba(232, 232, 232, 0.85), 0 0 6px rgba(232, 232, 232, 0.6)", color: "#ffffff", transform: "scale(1.06)" },
          "100%": { textShadow: "0 0 0 rgba(232, 232, 232, 0)", color: "#d4d4d4", transform: "scale(1)" },
        },
      },
    },
  },
  plugins: [],
};
