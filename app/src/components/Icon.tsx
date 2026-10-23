import type { CSSProperties } from "react";

export type IconName =
  | "house" | "books" | "pencil" | "person" | "camera" | "photo" | "sparkles" | "clock" | "check" | "xmark"
  | "chevron-right" | "chevron-left" | "chevron-down" | "chevron-up" | "plus" | "trash" | "ellipsis" | "bell"
  | "lock" | "export" | "search" | "refresh" | "warning" | "seal" | "target" | "chart" | "book" | "sun" | "info"
  | "viewfinder" | "loop" | "family" | "shield" | "brain"
  | "folder" | "document" | "grid" | "pin" | "printer" | "list" | "xcircle" | "checkcircle" | "alert" | "arrows" | "letters" | "graduation";

const paths: Record<IconName, string> = {
  folder: "M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z",
  document: "M6 3h8l4 4v14H6zM14 3v4h4M9 12h6M9 16h6",
  grid: "M3 3h8v8H3zM13 3h8v8h-8zM3 13h8v8H3zM13 13h8v8h-8z",
  pin: "M12 21s7-5.5 7-11a7 7 0 1 0-14 0c0 5.5 7 11 7 11zM12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z",
  printer: "M6 9V4h12v5M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M6 14h12v7H6z",
  list: "M4 6h16M4 12h10M4 18h7M18 16a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
  xcircle: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM9 9l6 6M15 9l-6 6",
  checkcircle: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM8 12l3 3 5-6",
  alert: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 8v5M12 16h.01",
  arrows: "M4 9h12l-3-3M20 15H8l3 3",
  letters: "M4 7h7M7.5 7v10M13 17l3.5-9 3.5 9M14.5 14h4",
  graduation: "M3 9l9-4 9 4-9 4zM7 11v4c0 1.5 2.5 3 5 3s5-1.5 5-3v-4",
  house: "M3 11.5 12 4l9 7.5M5 10v10h14V10",
  books: "M4 4h4v16H4zM10 4h4v16h-4zM16.5 5l3.5.8-3 14-3.5-.8z",
  pencil: "M4 20h4l10-10-4-4L4 16zM12.5 7.5l4 4",
  person: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0",
  camera: "M4 8h3l2-3h6l2 3h3v11H4zM12 16.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z",
  photo: "M3 5h18v14H3zM3 16l5-5 4 4 3-3 6 6M16 10.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z",
  sparkles: "M12 3l1.8 4.6L18 9l-4.2 1.4L12 15l-1.8-4.6L6 9l4.2-1.4zM19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9z",
  clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2",
  check: "M5 12l5 5 9-10",
  xmark: "M6 6l12 12M18 6L6 18",
  "chevron-right": "M9 6l6 6-6 6",
  "chevron-left": "M15 6l-6 6 6 6",
  "chevron-down": "M6 9l6 6 6-6",
  "chevron-up": "M6 15l6-6 6 6",
  plus: "M12 5v14M5 12h14",
  trash: "M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3",
  ellipsis: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM8 12h.01M12 12h.01M16 12h.01",
  bell: "M6 16V11a6 6 0 0 1 12 0v5l2 2H4zM10 20a2 2 0 0 0 4 0",
  lock: "M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4",
  export: "M12 3v12M7 8l5-5 5 5M5 13v7h14v-7",
  search: "M11 17a6 6 0 1 0 0-12 6 6 0 0 0 0 12zM20 20l-4.5-4.5",
  refresh: "M20 12a8 8 0 0 1-14 5.3M4 12a8 8 0 0 1 14-5.3M18 3v4h-4M6 21v-4h4",
  warning: "M12 8v5M12 16h.01M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z",
  seal: "M12 2.5l2.2 2 3-.3.9 2.8 2.6 1.5-1 2.8 1 2.8-2.6 1.5-.9 2.8-3-.3-2.2 2-2.2-2-3 .3-.9-2.8-2.6-1.5 1-2.8-1-2.8 2.6-1.5.9-2.8 3 .3zM8.5 12l2.5 2.5 4.5-5",
  target: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8z",
  chart: "M4 19V9M10 19V5M16 19v-7M22 19H2",
  book: "M4 4h12a2 2 0 0 1 2 2v14H6a2 2 0 0 1-2-2zM4 18a2 2 0 0 1 2-2h12",
  sun: "M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4",
  info: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v5M12 8h.01",
  viewfinder: "M4 9V5h4M20 9V5h-4M4 15v4h4M20 15v4h-4M12 9v6M9 12h6",
  loop: "M4 12a8 8 0 0 1 14-5l2 2M20 12a8 8 0 0 1-14 5l-2-2M20 4v5h-5M4 20v-5h5",
  family: "M9 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM17 11.2a2.2 2.2 0 1 0 0-4.4 2.2 2.2 0 0 0 0 4.4zM3 20a6 6 0 0 1 12 0M14 20a4 4 0 0 1 7 0",
  shield: "M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z",
  brain: "M9 4a3 3 0 0 0-3 3v1a3 3 0 0 0-2 3 3 3 0 0 0 2 3v1a3 3 0 0 0 3 3h3V4zM15 4a3 3 0 0 1 3 3v1a3 3 0 0 1 2 3 3 3 0 0 1-2 3v1a3 3 0 0 1-3 3h-3V4z",
};

interface Props {
  name: IconName;
  size?: number;
  stroke?: number;
  fill?: boolean;
  className?: string;
  style?: CSSProperties;
  label?: string;
}

export function Icon({ name, size = 22, stroke = 1.8, fill = false, className, style, label }: Props) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={fill ? "currentColor" : "none"}
      stroke={fill ? "none" : "currentColor"}
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={style}
      aria-hidden={label ? undefined : true}
      role={label ? "img" : undefined}
      aria-label={label}
    >
      <path d={paths[name]} />
    </svg>
  );
}
