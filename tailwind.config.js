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
      gray: colors.gray,
      blue: colors.blue,
      teal: colors.teal,
      orange: colors.orange,
      green: colors.green,
    },
  },
  content: {
    files: [
      './hugo_stats.json',
      './layouts/**/*.html',
      './layouts/*.html',
      './assets/js/*.js',
    ],
  },
  darkMode: 'class',
}
