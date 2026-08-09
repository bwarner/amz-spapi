import * as React from 'react';

type Props = React.SVGProps<SVGSVGElement> & {
  gold?: string;
  cream?: string;
};

export function SellAvantIcon({
  gold = '#D9A441',
  cream = '#F3E4C0',
  ...props
}: Props) {
  return (
    <svg
      viewBox="0 0 72 72"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <rect x="1" y="1" width="70" height="70" rx="18" fill="#152A4A" />
      <rect x="19" y="40" width="8" height="16" rx="2.5" fill={gold} />
      <rect x="32" y="30" width="8" height="26" rx="2.5" fill={gold} />
      <rect x="45" y="18" width="8" height="38" rx="2.5" fill={gold} />
      <polyline
        points="23,40 36,30 49,18"
        stroke={cream}
        strokeWidth="4"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.95"
      />
    </svg>
  );
}
