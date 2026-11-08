import { useLayoutEffect, useRef } from "react";
import type {
  PropsWithChildren,
  ReactNode,
  TextareaHTMLAttributes,
} from "react";

export function FormField({
  label,
  hint,
  error,
  optional,
  className = "",
  children,
}: PropsWithChildren<{
  label: string;
  hint?: ReactNode;
  error?: string;
  optional?: boolean;
  className?: string;
}>) {
  return (
    <label className={`form-field ${className}`.trim()}>
      <span className="form-field-label">
        <span>{label}</span>
        {optional && <small>Optional</small>}
      </span>
      {children}
      {error ? (
        <span className="field-error" role="alert">
          {error}
        </span>
      ) : hint ? (
        <span className="field-hint">{hint}</span>
      ) : null}
    </label>
  );
}

export function SegmentedControl<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: ReadonlyArray<{ value: T; label: string }>;
  onChange: (value: T) => void;
}) {
  return (
    <div className="segmented-control" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={option.value === value ? "active" : ""}
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function AutoGrowTextarea({
  value,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { value: string }) {
  const textarea = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const element = textarea.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${element.scrollHeight}px`;
  }, [value]);
  return (
    <textarea
      {...props}
      ref={textarea}
      value={value}
      className={`auto-grow-textarea ${props.className ?? ""}`.trim()}
    />
  );
}
