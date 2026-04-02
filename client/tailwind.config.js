/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#0f172a",
        mist: "#e2e8f0",
        ember: "#ea580c",
        tide: "#0f766e"
      },
      boxShadow: {
        panel: "0 16px 50px -20px rgba(15, 23, 42, 0.35)"
      },
      fontFamily: {
        heading: ["Space Grotesk", "sans-serif"],
        body: ["Manrope", "sans-serif"],
        mono: ["IBM Plex Mono", "monospace"]
      }
    }
  },
  plugins: []
};
