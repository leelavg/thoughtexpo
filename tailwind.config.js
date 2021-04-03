const defaultTheme = require('tailwindcss/defaultTheme')
const colors = require('tailwindcss/colors')

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
    colors: {
      gray: colors.coolGray,
      blue: colors.blue,
      teal: colors.teal,
      orange: colors.orange,
      green: colors.green,
    },
    extend: {},
  },
  variants: {},
  plugins: [],
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
  darkMode: 'class',
}
