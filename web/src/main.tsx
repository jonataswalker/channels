import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

import "./index.css"
import App from "./App.tsx"
import { Boundary } from "@/components/kit"
import { TooltipProvider } from "@/components/ui/tooltip"
import { noteSignInGone } from "@/lib/session"
import { applyStoredAppearance } from "@/lib/theme"
import { initAccessibility } from "@/lib/accessibility"

applyStoredAppearance()
initAccessibility()

// A call nobody caught that failed because the sign-in ended: ask to sign in again, quietly.
window.addEventListener("unhandledrejection", (e) => {
  if (noteSignInGone(e.reason)) e.preventDefault()
})

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Boundary whole>
      <TooltipProvider delay={500}>
        <App />
      </TooltipProvider>
    </Boundary>
  </StrictMode>
)
