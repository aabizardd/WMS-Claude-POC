interface NumberInputProps {
  value: number;
  onChange: (val: number) => void;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  className?: string;
}

export default function NumberInput({
  value,
  onChange,
  min = 0,
  max,
  step = 1,
  disabled = false,
  className = '',
}: NumberInputProps) {
  return (
    <div className={`inline-flex items-center rounded-md border border-slate-200 bg-white ${disabled ? 'opacity-50' : ''} ${className}`}>
      <button
        type="button"
        className="px-2 py-1 text-slate-500 hover:text-slate-700 disabled:text-slate-300"
        disabled={disabled || value <= min}
        onClick={() => onChange(Math.max(min, value - step))}
      >
        −
      </button>
      <input
        type="number"
        step="any"
        min={min}
        max={max}
        value={value}
        disabled={disabled}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (!isNaN(v)) onChange(v);
        }}
        className="w-16 border-x border-slate-200 py-1 text-center text-sm outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
      />
      <button
        type="button"
        className="px-2 py-1 text-slate-500 hover:text-slate-700 disabled:text-slate-300"
        disabled={disabled || (max != null && value >= max)}
        onClick={() => onChange(Math.min(max ?? Infinity, value + step))}
      >
        +
      </button>
    </div>
  );
}
