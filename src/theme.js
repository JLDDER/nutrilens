// The look of the app ("celadon plate", chosen by the owner on 2026-11-26): one place for the palette and the type.
// Used by tailwind.config.js at build time and by the development page (index.html, inside the TAILWIND markers).
// The app's markup keeps Tailwind's palette names, so `slate` here is the green-grey ink and `emerald` the celadon
// accent: renaming every class would touch hundreds of lines for no change in the result.
(function (root) {
  const theme = {
    colors: {
      // Green-grey neutrals: 900 is the ink, 50–100 the table the plates sit on.
      slate: {
        50: '#EDF1EE', 100: '#E1E8E3', 200: '#D0DAD4', 300: '#B3C2BA', 400: '#646F6A', 500: '#5B6C65',
        600: '#4A5A55', 700: '#37453F', 800: '#26322E', 900: '#1E2B27', 950: '#121A17'
      },
      // Celadon glaze: 600 is the accent on light grounds, 400 on dark ones.
      emerald: {
        50: '#EEF5F2', 100: '#D7E8E0', 200: '#B3D2C4', 300: '#8CB9A6', 400: '#76AE98', 500: '#4F8673',
        600: '#3F6E5E', 700: '#33594C', 800: '#2A473E', 900: '#223A33', 950: '#142520'
      },
      // Macro inks, toned to sit with the glaze: protein = brick, carbs = ochre (also warnings), fat = indigo-blue.
      rose: {
        50: '#FBF0EC', 100: '#F5DCD3', 200: '#EBB9A8', 300: '#DD917A', 400: '#CC6E54', 500: '#B5523B',
        600: '#9C4330', 700: '#7F3627', 800: '#622A1F', 900: '#4A2018', 950: '#2C130E'
      },
      amber: {
        50: '#FBF5E6', 100: '#F5E6C2', 200: '#EBCF8C', 300: '#DEB65E', 400: '#D2A23F', 500: '#C08A2B',
        600: '#A06F20', 700: '#80571B', 800: '#634318', 900: '#4B3314', 950: '#2B1D0B'
      },
      sky: {
        50: '#EDF3F8', 100: '#D6E4EF', 200: '#AFCAE0', 300: '#86AECF', 400: '#6195BF', 500: '#3E7CA6',
        600: '#33678B', 700: '#2A5372', 800: '#22425B', 900: '#1B3447', 950: '#0F1F2B'
      }
    },
    // One handwritten family everywhere (LXGW WenKai TC, a Kai-style hand, not 標楷體), numbers included.
    fontFamily: {
      sans: ['"LXGW WenKai TC"', '"PingFang TC"', '"Noto Sans TC"', 'system-ui', 'sans-serif'],
      mono: ['"LXGW WenKai TC"', '"PingFang TC"', 'system-ui', 'sans-serif']
    }
  };
  if (typeof module === 'object' && module.exports) module.exports = theme;
  else root.NUTRILENS_THEME = theme;
})(this);
