import type { ButtonHTMLAttributes, ReactNode } from "react";

export function Button({ intent, className, children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { intent?: "primary" | "secondary" | "danger" | "quiet"; className?: string }) {
  return <button className={`button button-${intent ?? "secondary"} ${className ?? ""}`} {...props}>{children}</button>;
}

export function Pill({ tone, children }: { tone?: "neutral" | "info" | "success" | "warning" | "danger" | "accent" | "manual"; children: ReactNode }) {
  return <span className={`pill pill-${tone ?? "neutral"}`}>{children}</span>;
}

export function CopyIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M15 9V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h3" /></svg>;
}

export function CheckIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6" /></svg>;
}
