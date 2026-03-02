/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/**/*.{html,ts}",
  ],
  theme: {
    extend: {},
  },
  plugins: [
    require('daisyui'),
  ],
  daisyui: {
    themes: [
      {
        dracula: {
          "primary": "#a855f7",
          "secondary": "#d946ef",
          "accent": "#22d3ee",
          "neutral": "#1e1e2e",
          "base-100": "#1e1e2e",
          "base-200": "#181825",
          "base-300": "#11111b",
          "info": "#89b4fa",
          "success": "#a6e3a1",
          "warning": "#f9e2af",
          "error": "#f38ba8",
        },
      },
    ],
  },
}
