import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './hero.css'
import { HeroDemo } from '@/components/ui/demo-hero'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <HeroDemo />
  </StrictMode>,
)
