const defaultTheme = require('tailwindcss/defaultTheme')

module.exports = {
  theme: {
    fontFamily: {
      body: ['Miriam Libre'],
      mono: ['Fira Mono', ...defaultTheme.fontFamily.mono],
      sans: ['Fira Sans', ...defaultTheme.fontFamily.sans],
    },
    listStyleType: {
      square: 'square',
      decimal: 'decimal',
    },
    extend: {},
  },
  variants: {},
  plugins: [require('@tailwindcss/ui')],
  purge: {
    content: ['./hugo_stats.json', './layouts/**/*.html'],
    extractors: [
      {
        extractor: (content) => {
          let els = JSON.parse(content).htmlElements
          return els.tags.concat(els.classes, els.ids)
        },
        extensions: ['json'],
      },
    ],
    mode: 'all',
  },
  darkMode: 'media',
}
