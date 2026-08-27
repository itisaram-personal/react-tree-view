import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
// Imported the way a consumer does it (`react-tree-view/styles.css`): the
// bare import inside src/index.ts is tree-shakeable and must not be relied on.
import '../src/styles.css'
import './demo.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
