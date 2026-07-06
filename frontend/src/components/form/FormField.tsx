import type { ReactNode } from 'react';

/**
 * Consistent form field wrapper:
 * - red "*" after the label when `required`
 * - red border on the inner `.input` and a red error message below when `error` is set
 *
 * Usage:
 *   <FormField label="Email" required error={errors.email}>
 *     <input className="input" ... />
 *   </FormField>
 */
export default function FormField({
  label,
  required,
  error,
  htmlFor,
  hint,
  children,
}: {
  label: string;
  required?: boolean;
  error?: string;
  htmlFor?: string;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div
      className={
        error
          ? '[&_.input]:border-red-400 [&_.input]:focus:border-red-500 [&_.input]:focus:ring-red-200'
          : undefined
      }
    >
      <label className="label" htmlFor={htmlFor}>
        {label}
        {required && <span className="text-red-500"> *</span>}
        {hint}
      </label>
      {children}
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}

// Build an errors object from a list of [field, value, message] required checks.
// Returns {} when all pass.
export function requiredErrors(
  checks: [field: string, value: unknown, message?: string][],
): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const [field, value, message] of checks) {
    const empty =
      value === undefined ||
      value === null ||
      value === '' ||
      (typeof value === 'string' && value.trim() === '');
    if (empty) errors[field] = message ?? 'This field is required';
  }
  return errors;
}
