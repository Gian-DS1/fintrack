// Toast de "borrado + Deshacer". Todas las pantallas que borran algo (tarjetas,
// deudas, metas, categorías, transacciones y sus pagos/aportes) mostraban el
// mismo JSX repetido: mensaje + botón Deshacer que revierte y cierra el toast.
//
// `onUndo` puede ser async (restaurar una deuda reaplica sus pagos, una meta sus
// aportes); el toast se cierra al terminar para que el usuario no lo vea
// desaparecer antes de que la restauración haya ocurrido de verdad.
import toast from 'react-hot-toast';
import { tr } from '../i18n/runtime';

export function toastUndo(message, onUndo, { duration = 6000 } = {}) {
  return toast((tt) => (
    <span className="flex items-center gap-sm">
      {message}
      <button
        onClick={async () => {
          await onUndo();
          toast.dismiss(tt.id);
        }}
        className="text-primary font-bold underline"
      >
        {tr('common.undo')}
      </button>
    </span>
  ), { duration });
}
