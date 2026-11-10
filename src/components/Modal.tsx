import { X } from "lucide-react";
import { useEffect, useId, useRef } from "react";
import type { PropsWithChildren } from "react";

export function Modal({
  title,
  eyebrow,
  subtitle,
  className,
  closeLabel = "Close",
  onClose,
  children,
}: PropsWithChildren<{
  title: string;
  eyebrow?: string;
  subtitle?: string;
  className?: string;
  closeLabel?: string;
  onClose: () => void;
}>) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  return (
    <dialog
      ref={dialog}
      className={`modal${className ? ` ${className}` : ""}`}
      onCancel={onClose}
      aria-labelledby={titleId}
    >
      <div className="modal-header">
        <div>
          {eyebrow && <p className="eyebrow">{eyebrow}</p>}
          <h2 id={titleId}>{title}</h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
        <button
          className="icon-button"
          onClick={onClose}
          aria-label={closeLabel}
        >
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
