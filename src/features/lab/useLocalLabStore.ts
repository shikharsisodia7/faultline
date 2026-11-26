import { useState } from 'react'
import type { LabStore, SavedLabScenario } from './ChaosLab'

/** Browser-local scenario store (standalone build, signed-out visitors). */
export function useLocalLabStore(notice: string): LabStore {
  const key = 'faultline:lab-scenarios'
  const read = (): SavedLabScenario[] => {
    try {
      return JSON.parse(localStorage.getItem(key) ?? '[]') as SavedLabScenario[]
    } catch {
      return []
    }
  }
  const [scenarios, setScenarios] = useState<SavedLabScenario[]>(read)
  const persist = (next: SavedLabScenario[]) => {
    setScenarios(next)
    try {
      localStorage.setItem(key, JSON.stringify(next))
    } catch {
      /* storage blocked */
    }
  }
  return {
    notice,
    canSave: true,
    scenarios,
    save: async (name, scenario, id) => {
      const sid = id ?? `lab_${Date.now().toString(36)}`
      persist([{ id: sid, name, scenario, updatedAt: Date.now() }, ...scenarios.filter((s) => s.id !== sid)].slice(0, 30))
      return sid
    },
    remove: async (id) => persist(scenarios.filter((s) => s.id !== id)),
  }
}
