// Estado de la simulación de «Proyección». Se lee de localStorage al montar (por
// usuario) y se guarda en cada cambio; todo el acceso (con try/catch y valores por
// defecto) vive en simulationStorage.js. No toca stores ni Supabase.
import { useCallback, useEffect, useState } from 'react';
import { loadSimulation, saveSimulation } from './simulationStorage';

export default function useSimulation(userId) {
  const [simulation, setSimulation] = useState(() => loadSimulation(userId));

  useEffect(() => { saveSimulation(simulation, userId); }, [simulation, userId]);

  const update = useCallback((patch) => setSimulation((prev) => ({ ...prev, ...patch })), []);

  return { simulation, update };
}
