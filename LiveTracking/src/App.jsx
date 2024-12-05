import { useState } from 'react'
import reactLogo from './assets/react.svg'
import viteLogo from '/vite.svg'
import './App.css'
import TrackingSystem from './components/TrackingSystem.jsx'; // if renamed to .jsx


function App() {
  const [count, setCount] = useState(0)

  return (
    <>
      <TrackingSystem/>
    </>
  )
}

export default App
