import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'

// Fonts are bundled with the app so a booth PC without internet looks the same.
// Latin subsets only: the KJV text and the UI need nothing else.
import '@fontsource/ibm-plex-sans/latin-400.css'
import '@fontsource/ibm-plex-sans/latin-500.css'
import '@fontsource/ibm-plex-sans/latin-600.css'
import '@fontsource/ibm-plex-mono/latin-400.css'
import '@fontsource/ibm-plex-mono/latin-500.css'
import '@fontsource/source-serif-4/latin-400.css'
import '@fontsource/source-serif-4/latin-400-italic.css'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
