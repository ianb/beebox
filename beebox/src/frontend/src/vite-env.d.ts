/// <reference types="vite/client" />

declare namespace JSX {
  interface IntrinsicElements {
    "l-grid": React.DetailedHTMLProps<
      React.HTMLAttributes<HTMLElement> & {
        size?: string;
        color?: string;
        speed?: string;
      },
      HTMLElement
    >;
  }
}
