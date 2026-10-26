/** − qty + control (Qty Transfer, Qty Return, bin allocation). */
export default function QtyStepper({
  value,
  max,
  allowsDecimal = true,
  disabled,
  invalid,
  onChange,
  onStep,
}: {
  value: number;
  max?: number;
  allowsDecimal?: boolean;
  disabled?: boolean;
  invalid?: boolean;
  onChange: (v: number) => void;
  onStep: (delta: number) => void;
}) {
  return (
    <div
      className={`inline-flex items-center overflow-hidden rounded-lg border ${
        invalid ? 'border-rose-400' : 'border-slate-200'
      } ${disabled ? 'opacity-50' : ''}`}
    >
      <button
        type="button"
        className="px-2.5 py-1 text-slate-500 hover:bg-slate-100 disabled:cursor-not-allowed disabled:hover:bg-transparent"
        disabled={disabled}
        onClick={() => onStep(-1)}
        aria-label="Decrease"
      >
        −
      </button>
      <input
        type="number"
        min={0}
        max={max}
        step={allowsDecimal ? 'any' : '1'}
        className="w-20 border-x border-slate-200 py-1 text-center text-sm outline-none disabled:bg-slate-50"
        disabled={disabled}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <button
        type="button"
        className="px-2.5 py-1 text-slate-500 hover:bg-slate-100 disabled:cursor-not-allowed disabled:hover:bg-transparent"
        disabled={disabled}
        onClick={() => onStep(1)}
        aria-label="Increase"
      >
        +
      </button>
    </div>
  );
}
