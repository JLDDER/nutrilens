// Tailwind settings used by build.mjs.
// `content` lists the files scanned for class names; only those classes are compiled.
module.exports = {
  darkMode: 'class',   // dark mode is toggled by the "dark" class on <html>
  content: ['./index.html', './js/**/*.js'],
  theme: { extend: {} },
  plugins: []
};
