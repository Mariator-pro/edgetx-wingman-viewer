// Stroke icons, sized by font size; decorative unless given a label by the caller.
type IconProps = { size?: number; className?: string };

function Svg({ size = 18, className, children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      {children}
    </svg>
  );
}

export const PathIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="5" cy="18" r="2" />
    <circle cx="19" cy="6" r="2" />
    <path d="M7 18c4 0 3-6 7-6s3-4 3-4" />
  </Svg>
);

export const BagIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3" y="7" width="18" height="13" rx="2" />
    <path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M3 12h18" />
  </Svg>
);

export const ListIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M8 6h12M8 12h12M8 18h12" />
    <circle cx="4" cy="6" r="1" />
    <circle cx="4" cy="12" r="1" />
    <circle cx="4" cy="18" r="1" />
  </Svg>
);

export const MapIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="m3 6 6-2 6 2 6-2v14l-6 2-6-2-6 2z" />
    <path d="M9 4v14M15 6v14" />
  </Svg>
);

export const SettingsIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
  </Svg>
);

export const SunIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </Svg>
);

export const MoonIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
  </Svg>
);

export const UploadIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 16V4M7 9l5-5 5 5" />
    <path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" />
  </Svg>
);

export const MoreIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="5" cy="12" r="1" />
    <circle cx="12" cy="12" r="1" />
    <circle cx="19" cy="12" r="1" />
  </Svg>
);

export const ChevronLeftIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="m15 6-6 6 6 6" />
  </Svg>
);

export const ChevronRightIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="m9 6 6 6-6 6" />
  </Svg>
);

export const DownloadIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 4v12M7 11l5 5 5-5" />
    <path d="M4 20h16" />
  </Svg>
);

export const TrashIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
  </Svg>
);

export const PlayIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M7 5v14l12-7z" fill="currentColor" />
  </Svg>
);

export const PauseIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M8 5v14M16 5v14" strokeWidth="3" />
  </Svg>
);

export const PlusIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
);

export const MinusIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 12h14" />
  </Svg>
);

export const FitIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" />
  </Svg>
);
export const FollowIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="6" />
    <circle cx="12" cy="12" r="1.5" />
    <path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
  </Svg>
);
export const CubeIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3 4 7.5v9L12 21l8-4.5v-9L12 3Z" />
    <path d="m4 7.5 8 4.5 8-4.5M12 12v9" />
  </Svg>
);
export const LayersIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3 3 8l9 5 9-5z" />
    <path d="m3 13 9 5 9-5" />
  </Svg>
);

export const NoteIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 4h14v12l-4 4H5z" />
    <path d="M15 20v-4h4" />
  </Svg>
);

export const SlidersIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 7h10M18 7h2M4 17h4M12 17h8" />
    <circle cx="16" cy="7" r="2" />
    <circle cx="10" cy="17" r="2" />
  </Svg>
);

export const TagIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3H5a2 2 0 0 0-2 2v7l9 9a2 2 0 0 0 2.8 0l6.2-6.2a2 2 0 0 0 0-2.8z" />
    <circle cx="7.5" cy="7.5" r="1" />
  </Svg>
);

export const BatteryIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3" y="7" width="16" height="10" rx="2" />
    <path d="M21 11v2" />
  </Svg>
);

export const SortIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 7h16M7 12h10M10 17h4" />
  </Svg>
);

export const ColumnsIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <path d="M9 5v14M15 5v14" />
  </Svg>
);
