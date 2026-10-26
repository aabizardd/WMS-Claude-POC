import SearchableSelect from './SearchableSelect';

/**
 * Chip version of SearchableSelect: picking an option appends it instead of
 * replacing the selection. Used for filter columns with a known value set
 * (status, delivery status), where several values mean "any of these".
 */
export default function MultiValueSelect({
  values,
  onChange,
  options,
  placeholder,
  searchPlaceholder,
  max = 10,
  className = '',
}: {
  values: string[];
  onChange: (values: string[]) => void;
  options: { value: string; label: string }[];
  placeholder?: string;
  searchPlaceholder?: string;
  max?: number;
  className?: string;
}) {
  const chosen = new Set(values);
  const label = (v: string) => options.find((o) => o.value === v)?.label ?? v;

  return (
    <div className={className}>
      <SearchableSelect
        value=""
        onChange={(v) => {
          if (!v || chosen.has(v) || values.length >= max) return;
          onChange([...values, v]);
        }}
        options={options.filter((o) => !chosen.has(o.value))}
        placeholder={values.length >= max ? `Max ${max} values` : (placeholder ?? 'Select…')}
        searchPlaceholder={searchPlaceholder}
        disabled={values.length >= max}
      />
      {values.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1.5">
          {values.map((v) => (
            <span
              key={v}
              className="inline-flex items-center gap-1 rounded bg-brand-50 px-1.5 py-0.5 text-xs font-medium text-brand-700"
            >
              {label(v)}
              <button
                type="button"
                className="text-brand-400 hover:text-brand-700"
                onClick={() => onChange(values.filter((x) => x !== v))}
                aria-label={`Remove ${label(v)}`}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
