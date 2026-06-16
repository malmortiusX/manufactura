// tailwind.config.ts
import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        sidebar: "#1e2a3b",
        primary: {
          50:  "#fff8eb",
          100: "#feeccc",
          200: "#fdd49a",
          300: "#fcb960",
          400: "#fa9d30",
          500: "#f89520",
          600: "#e07208",
          700: "#b85808",
          800: "#94440d",
          900: "#79390e",
          950: "#451e06",
        },
        secondary: {
          50:  "#f0faf2",
          100: "#dcf5e1",
          200: "#bbe9c6",
          300: "#8dd69e",
          400: "#57be6d",
          500: "#3ab54a",
          600: "#289337",
          700: "#22752e",
          800: "#1e5d28",
          900: "#1a4d22",
          950: "#0d2e13",
        },
      },
      fontFamily: {
        sans: ["Roboto", "ui-sans-serif", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};

export default config;
