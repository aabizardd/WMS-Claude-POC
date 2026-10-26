import SearchableSelect from './SearchableSelect';

/**
 * "Picker for all items": one choice that fills the picker of every line, so
 * a document with many part numbers is not assigned row by row. Rows keep
 * their own picker select for exceptions. Used by Putaway's Assign Pickers
 * (Generate Picking / Putaway have it as the first row of their table).
 */
export default function PickerForAll({
  value,
  onChange,
  pickers,
  placeholder = '— Select picker —',
  className = '',
}: {
  value: string;
  onChange: (pickerId: string) => void;
  pickers: { id: number; name: string }[];
  placeholder?: string;
  className?: string;
}) {
  return (
    <div className={`min-w-[14rem] flex-1 ${className}`}>
      <label className="block text-xs font-medium text-slate-600">Picker for all items</label>
      <SearchableSelect
        className="mt-0.5"
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        searchPlaceholder="Search picker…"
        options={pickers.map((p) => ({ value: String(p.id), label: p.name }))}
      />
      <p className="mt-1 text-[11px] text-slate-500">
        Fills the picker of every item; you can still change a single row below.
      </p>
    </div>
  );
}
