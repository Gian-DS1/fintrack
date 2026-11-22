// Interruptor nativo (checkbox con role="switch") y su pista visual. Va DENTRO de un
// <label> del consumidor, que le da el nombre accesible. Encendido = incluido.
export default function SwitchControl({ checked, onChange }) {
  return (
    <>
      <input type="checkbox" role="switch" className="peer sr-only" checked={checked} onChange={onChange} />
      <span
        aria-hidden="true"
        className="relative shrink-0 w-9 h-5 rounded-full border border-border-subtle bg-surface-container-high transition-colors motion-reduce:transition-none peer-checked:bg-primary peer-checked:border-primary peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-primary after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:w-[14px] after:h-[14px] after:rounded-full after:bg-on-surface after:transition-transform motion-reduce:after:transition-none peer-checked:after:translate-x-4 peer-checked:after:bg-on-primary"
      />
    </>
  );
}
