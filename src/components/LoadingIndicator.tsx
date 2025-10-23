import type { HTMLAttributes } from "react";

interface LoadingIndicatorProps extends HTMLAttributes<HTMLDivElement> {
  message?: string;
}

export default function LoadingIndicator({
  message = "Cargando datos...",
  className = "",
  ...rest
}: LoadingIndicatorProps) {
  return (
    <div
      className={`flex flex-col items-center justify-center gap-4 py-10 text-gray-600 ${className}`}
      role="status"
      aria-live="polite"
      {...rest}
    >
      <div className="h-10 w-10 animate-spin rounded-full border-4 border-blue-500 border-t-transparent" />
      <span className="text-base font-medium">{message}</span>
    </div>
  );
}