import ThemedDateInput from './ThemedDateInput';

type Props = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  min?: string;
  max?: string;
};

export default function DatePickerField({ label, value, onChange, min, max }: Props) {
  return (
    <label className="grid min-w-0 gap-1.5 text-xs text-wave">
      {label}
      <ThemedDateInput
        label={label}
        value={value}
        onChange={onChange}
        min={min}
        max={max}
        className="h-9 px-3 text-xs"
      />
    </label>
  );
}
