module.exports = {
  purge: {
    content: [ './hugo_stats.json' ],
    defaultExtractor: (content) => {
        let els = JSON.parse(content).htmlElements;
        return els.tags.concat(els.classes, els.ids);
    }
  },
  theme: {
    extend: {},
  },
  variants: {},
  plugins: [],
}