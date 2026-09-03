(() => {
  const allowed = new Set(['cyber-dark', 'amber-neumorphic', 'neo-brutalism'])
  const lightThemes = new Set(['amber-neumorphic', 'neo-brutalism'])
  let theme = 'cyber-dark'

  try {
    const mirrored = localStorage.getItem('chromeHomeTheme')
    if (allowed.has(mirrored)) theme = mirrored
  } catch {
    // The application will reconcile with chrome.storage after startup.
  }

  document.documentElement.dataset.theme = theme
  document.documentElement.style.colorScheme = lightThemes.has(theme) ? 'light' : 'dark'
})()
